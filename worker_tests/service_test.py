from __future__ import annotations

import unittest

from generation_worker.models import GeneratedQuestion, OutboxEvent, QueueMessage, WorkItem
from generation_worker.service import GenerationWorker, WorkerResult


class FakeQueue:
    def __init__(self, message: QueueMessage | None) -> None:
        self.message = message
        self.deleted: list[str] = []

    def send(self, event: OutboxEvent) -> str:
        return event.id

    def receive(self, *, visibility_timeout: int, wait_time: int) -> QueueMessage | None:
        return self.message

    def delete(self, receipt_handle: str) -> None:
        self.deleted.append(receipt_handle)


class FakeRepository:
    def __init__(self, *, processed: bool = False, terminal: bool = False) -> None:
        self.processed = processed
        self.terminal = terminal
        self.completed = False
        self.failed = False

    def already_processed(self, event_id: str) -> bool:
        return self.processed

    def claim_job_item(
        self, item_id: str, worker_id: str, lease_seconds: int
    ) -> WorkItem | None:
        return WorkItem(
            id=item_id,
            job_id="job-1",
            target_bloom="Apply",
            prompt_version="prompt-v1",
            source_title="Cell biology",
            attempt_count=1,
            lease_owner=worker_id,
        )

    def complete_job_item(
        self, item: WorkItem, question: GeneratedQuestion, event_id: str
    ) -> None:
        self.completed = True

    def fail_job_item(
        self,
        item: WorkItem,
        event_id: str,
        error: str,
        max_attempts: int,
        base_retry_seconds: int,
    ) -> bool:
        self.failed = True
        return self.terminal


class SuccessfulProvider:
    def generate(self, item: WorkItem) -> GeneratedQuestion:
        return GeneratedQuestion("Stem", "Correct", ("A", "B", "C"), "test")


class FailingProvider:
    def generate(self, item: WorkItem) -> GeneratedQuestion:
        raise RuntimeError("provider unavailable")


def message() -> QueueMessage:
    return QueueMessage(
        event_id="event-1",
        event_type="generation_job_item.created",
        payload={"itemId": "item-1"},
        receipt_handle="receipt-1",
    )


class WorkerServiceTests(unittest.TestCase):
    def test_duplicate_is_acknowledged_without_generation(self) -> None:
        queue = FakeQueue(message())
        repository = FakeRepository(processed=True)
        result = GenerationWorker(
            repository, queue, SuccessfulProvider(), "worker-1"
        ).run_once()
        self.assertEqual(result, WorkerResult.DUPLICATE)
        self.assertEqual(queue.deleted, ["receipt-1"])
        self.assertFalse(repository.completed)

    def test_retryable_failure_is_recorded_without_acknowledgement(self) -> None:
        queue = FakeQueue(message())
        repository = FakeRepository(terminal=False)
        result = GenerationWorker(
            repository, queue, FailingProvider(), "worker-1"
        ).run_once()
        self.assertEqual(result, WorkerResult.RETRY)
        self.assertTrue(repository.failed)
        self.assertEqual(queue.deleted, [])

    def test_terminal_failure_is_recorded_and_acknowledged(self) -> None:
        queue = FakeQueue(message())
        repository = FakeRepository(terminal=True)
        result = GenerationWorker(
            repository, queue, FailingProvider(), "worker-1"
        ).run_once()
        self.assertEqual(result, WorkerResult.FAILED)
        self.assertEqual(queue.deleted, ["receipt-1"])


if __name__ == "__main__":
    unittest.main()
