from __future__ import annotations

import json
import os
import unittest
from typing import Any

import boto3
import psycopg
from moto import mock_aws

from generation_worker.models import GeneratedQuestion, WorkItem
from generation_worker.provider import DeterministicDemoProvider
from generation_worker.publisher import OutboxPublisher
from generation_worker.queue import SqsQueue
from generation_worker.repository import PostgresRepository
from generation_worker.service import GenerationWorker, WorkerResult


class PublisherInterrupted(RuntimeError):
    pass


class WorkerInterrupted(BaseException):
    pass


class InterruptingProvider:
    def generate(self, item: WorkItem) -> GeneratedQuestion:
        raise WorkerInterrupted("simulated process termination")


class FailingProvider:
    def generate(self, item: WorkItem) -> GeneratedQuestion:
        raise RuntimeError("simulated provider timeout")


class PipelineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_url = os.environ["DATABASE_URL"]

    def setUp(self) -> None:
        with psycopg.connect(self.database_url) as connection:
            connection.execute(
                """
                TRUNCATE TABLE
                    processed_messages,
                    outbox_events,
                    human_reviews,
                    automated_evaluations,
                    questions,
                    job_items,
                    generation_jobs,
                    source_documents
                CASCADE
                """
            )

        self.aws = mock_aws()
        self.aws.start()
        self.sqs_client = boto3.client("sqs", region_name="us-east-1")
        queue_url = self.sqs_client.create_queue(QueueName="generation-jobs")["QueueUrl"]
        self.queue = SqsQueue(queue_url, self.sqs_client)
        self.repository = PostgresRepository(self.database_url)

    def tearDown(self) -> None:
        self.aws.stop()

    def seed_item(self, suffix: str) -> tuple[str, str, str]:
        with psycopg.connect(self.database_url) as connection:
            source_id = connection.execute(
                """
                INSERT INTO source_documents (title, storage_uri, content_sha256)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (f"Source {suffix}", f"s3://test/{suffix}.txt", suffix[0] * 64),
            ).fetchone()[0]
            job_id = connection.execute(
                """
                INSERT INTO generation_jobs (
                    source_document_id,
                    idempotency_key,
                    request_fingerprint,
                    requested_count,
                    prompt_version
                )
                VALUES (%s, %s, %s, 1, 'integration-v1')
                RETURNING id
                """,
                (source_id, f"integration-{suffix}", f"fingerprint-{suffix}"),
            ).fetchone()[0]
            item_id = connection.execute(
                """
                INSERT INTO job_items (job_id, ordinal, target_bloom)
                VALUES (%s, 1, 'Apply')
                RETURNING id
                """,
                (job_id,),
            ).fetchone()[0]
            event_id = connection.execute(
                """
                INSERT INTO outbox_events (
                    aggregate_type,
                    aggregate_id,
                    event_type,
                    payload
                )
                VALUES ('job_item', %s, 'generation_job_item.created', %s::jsonb)
                RETURNING id
                """,
                (item_id, json.dumps({"itemId": str(item_id), "jobId": str(job_id)})),
            ).fetchone()[0]
        return str(job_id), str(item_id), str(event_id)

    def worker(self, provider: Any, worker_id: str) -> GenerationWorker:
        return GenerationWorker(
            self.repository,
            self.queue,
            provider,
            worker_id,
            lease_seconds=30,
            visibility_timeout=0,
            wait_time=0,
            max_attempts=3,
            base_retry_seconds=0,
        )

    def row(self, query: str, parameters: tuple[Any, ...]) -> tuple[Any, ...]:
        with psycopg.connect(self.database_url) as connection:
            return connection.execute(query, parameters).fetchone()

    def test_duplicate_publication_and_commit_before_ack_are_idempotent(self) -> None:
        _, item_id, event_id = self.seed_item("a-duplicate")
        publisher = OutboxPublisher(self.repository, self.queue, "publisher-1")

        def interrupt_after_send(_event: Any) -> None:
            raise PublisherInterrupted("simulated crash after SQS accepted message")

        with self.assertRaises(PublisherInterrupted):
            publisher.publish_once(after_send=interrupt_after_send)

        with psycopg.connect(self.database_url) as connection:
            connection.execute(
                """
                UPDATE outbox_events
                SET lease_expires_at = now() - interval '1 second'
                WHERE id = %s
                """,
                (event_id,),
            )
        self.assertEqual(
            OutboxPublisher(self.repository, self.queue, "publisher-2").publish_once(), 1
        )

        worker = self.worker(DeterministicDemoProvider(), "worker-1")
        with self.assertRaises(WorkerInterrupted):
            worker.run_once(
                after_commit=lambda _question: (_ for _ in ()).throw(
                    WorkerInterrupted("simulated crash after database commit")
                )
            )
        self.assertEqual(worker.run_once(), WorkerResult.DUPLICATE)

        counts = self.row(
            """
            SELECT
                (SELECT count(*) FROM questions WHERE job_item_id = %s),
                (SELECT count(*) FROM processed_messages WHERE message_id = %s),
                (SELECT attempt_count FROM outbox_events WHERE id = %s)
            """,
            (item_id, event_id, event_id),
        )
        self.assertEqual(counts, (1, 1, 2))

    def test_expired_worker_lease_is_reclaimed_after_interruption(self) -> None:
        _, item_id, _ = self.seed_item("b-interrupted")
        self.assertEqual(
            OutboxPublisher(self.repository, self.queue, "publisher-1").publish_once(), 1
        )

        with self.assertRaises(WorkerInterrupted):
            self.worker(InterruptingProvider(), "worker-dead").run_once()

        running = self.row(
            "SELECT status::text, attempt_count FROM job_items WHERE id = %s",
            (item_id,),
        )
        self.assertEqual(running, ("RUNNING", 1))

        with psycopg.connect(self.database_url) as connection:
            connection.execute(
                """
                UPDATE job_items
                SET lease_expires_at = now() - interval '1 second'
                WHERE id = %s
                """,
                (item_id,),
            )

        result = self.worker(DeterministicDemoProvider(), "worker-replacement").run_once()
        self.assertEqual(result, WorkerResult.SUCCEEDED)
        completed = self.row(
            """
            SELECT item.status::text, item.attempt_count, question.generation_version
            FROM job_items AS item
            JOIN questions AS question ON question.job_item_id = item.id
            WHERE item.id = %s
            """,
            (item_id,),
        )
        self.assertEqual(completed, ("SUCCEEDED", 2, 2))

    def test_provider_failure_retries_then_succeeds(self) -> None:
        job_id, item_id, _ = self.seed_item("c-retry")
        self.assertEqual(
            OutboxPublisher(self.repository, self.queue, "publisher-1").publish_once(), 1
        )

        first = self.worker(FailingProvider(), "worker-1").run_once()
        self.assertEqual(first, WorkerResult.RETRY)
        retrying = self.row(
            "SELECT status::text, attempt_count FROM job_items WHERE id = %s",
            (item_id,),
        )
        self.assertEqual(retrying, ("RETRY", 1))

        second = self.worker(DeterministicDemoProvider(), "worker-2").run_once()
        self.assertEqual(second, WorkerResult.SUCCEEDED)
        final = self.row(
            """
            SELECT item.status::text, item.attempt_count, job.status::text
            FROM job_items AS item
            JOIN generation_jobs AS job ON job.id = item.job_id
            WHERE item.id = %s AND job.id = %s
            """,
            (item_id, job_id),
        )
        self.assertEqual(final, ("SUCCEEDED", 2, "SUCCEEDED"))


if __name__ == "__main__":
    unittest.main()
