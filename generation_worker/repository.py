from __future__ import annotations

import json
from datetime import timedelta

import psycopg
from psycopg.rows import dict_row

from generation_worker.models import GeneratedQuestion, OutboxEvent, WorkItem


class PostgresRepository:
    consumer_name = "generation-worker"

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def claim_outbox_events(
        self, publisher_id: str, batch_size: int, lease_seconds: int
    ) -> list[OutboxEvent]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            rows = connection.execute(
                "SELECT * FROM claim_outbox_events(%s, %s, %s)",
                (batch_size, publisher_id, timedelta(seconds=lease_seconds)),
            ).fetchall()
        return [
            OutboxEvent(
                id=str(row["id"]),
                event_type=str(row["event_type"]),
                payload=dict(row["payload"]),
                attempt_count=int(row["attempt_count"]),
            )
            for row in rows
        ]

    def mark_outbox_event_published(self, event_id: str, publisher_id: str) -> None:
        with psycopg.connect(self.database_url) as connection:
            result = connection.execute(
                """
                UPDATE outbox_events
                SET published_at = now(),
                    lease_owner = NULL,
                    lease_expires_at = NULL
                WHERE id = %s
                  AND lease_owner = %s
                  AND published_at IS NULL
                """,
                (event_id, publisher_id),
            )
            if result.rowcount != 1:
                raise RuntimeError("Outbox lease was lost before publication completed")

    def already_processed(self, event_id: str) -> bool:
        with psycopg.connect(self.database_url) as connection:
            row = connection.execute(
                """
                SELECT 1
                FROM processed_messages
                WHERE consumer_name = %s AND message_id = %s
                """,
                (self.consumer_name, event_id),
            ).fetchone()
        return row is not None

    def claim_job_item(
        self, item_id: str, worker_id: str, lease_seconds: int
    ) -> WorkItem | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            row = connection.execute(
                """
                SELECT
                    item.id,
                    item.job_id,
                    item.target_bloom,
                    item.attempt_count,
                    item.lease_owner,
                    job.prompt_version,
                    source.title AS source_title
                FROM claim_job_item(%s, %s, %s) AS item
                JOIN generation_jobs AS job ON job.id = item.job_id
                JOIN source_documents AS source ON source.id = job.source_document_id
                """,
                (item_id, worker_id, timedelta(seconds=lease_seconds)),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                "UPDATE generation_jobs SET status = 'RUNNING' WHERE id = %s",
                (row["job_id"],),
            )
        return WorkItem(
            id=str(row["id"]),
            job_id=str(row["job_id"]),
            target_bloom=str(row["target_bloom"]),
            prompt_version=str(row["prompt_version"]),
            source_title=str(row["source_title"]),
            attempt_count=int(row["attempt_count"]),
            lease_owner=str(row["lease_owner"]),
        )

    def complete_job_item(
        self, item: WorkItem, question: GeneratedQuestion, event_id: str
    ) -> None:
        with psycopg.connect(self.database_url) as connection:
            inserted = connection.execute(
                """
                INSERT INTO questions (
                    job_item_id,
                    generation_version,
                    stem,
                    correct_answer,
                    distractors,
                    model_name,
                    prompt_version
                )
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
                RETURNING id
                """,
                (
                    item.id,
                    item.attempt_count,
                    question.stem,
                    question.correct_answer,
                    json.dumps(question.distractors),
                    question.model_name,
                    item.prompt_version,
                ),
            ).fetchone()
            if inserted is None:
                raise RuntimeError("Question insert did not return an identifier")

            updated = connection.execute(
                """
                UPDATE job_items
                SET status = 'SUCCEEDED',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    last_error = NULL
                WHERE id = %s AND status = 'RUNNING' AND lease_owner = %s
                """,
                (item.id, item.lease_owner),
            )
            if updated.rowcount != 1:
                raise RuntimeError("Worker lease was lost before completion")

            connection.execute(
                """
                INSERT INTO processed_messages (consumer_name, message_id)
                VALUES (%s, %s)
                """,
                (self.consumer_name, event_id),
            )
            connection.execute("SELECT refresh_generation_job_status(%s)", (item.job_id,))

    def fail_job_item(
        self,
        item: WorkItem,
        event_id: str,
        error: str,
        max_attempts: int,
        base_retry_seconds: int,
    ) -> bool:
        terminal = item.attempt_count >= max_attempts
        retry_seconds = base_retry_seconds * (2 ** max(item.attempt_count - 1, 0))
        next_status = "FAILED" if terminal else "RETRY"

        with psycopg.connect(self.database_url) as connection:
            updated = connection.execute(
                """
                UPDATE job_items
                SET status = %s,
                    next_attempt_at = now() + %s,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    last_error = %s
                WHERE id = %s AND status = 'RUNNING' AND lease_owner = %s
                """,
                (
                    next_status,
                    timedelta(seconds=retry_seconds),
                    error[:2000],
                    item.id,
                    item.lease_owner,
                ),
            )
            if updated.rowcount != 1:
                raise RuntimeError("Worker lease was lost while recording failure")
            if terminal:
                connection.execute(
                    """
                    INSERT INTO processed_messages (consumer_name, message_id)
                    VALUES (%s, %s)
                    """,
                    (self.consumer_name, event_id),
                )
            connection.execute("SELECT refresh_generation_job_status(%s)", (item.job_id,))
        return terminal
