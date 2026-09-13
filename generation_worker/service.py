from __future__ import annotations

from collections.abc import Callable
from enum import Enum

from generation_worker.models import (
    GeneratedQuestion,
    QuestionProvider,
    Queue,
    WorkerRepository,
)


class WorkerResult(str, Enum):
    EMPTY = "empty"
    DEFERRED = "deferred"
    SUCCEEDED = "succeeded"
    RETRY = "retry"
    FAILED = "failed"
    DUPLICATE = "duplicate"


class GenerationWorker:
    def __init__(
        self,
        repository: WorkerRepository,
        queue: Queue,
        provider: QuestionProvider,
        worker_id: str,
        *,
        lease_seconds: int = 300,
        visibility_timeout: int = 60,
        wait_time: int = 10,
        max_attempts: int = 3,
        base_retry_seconds: int = 5,
    ) -> None:
        self.repository = repository
        self.queue = queue
        self.provider = provider
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds
        self.visibility_timeout = visibility_timeout
        self.wait_time = wait_time
        self.max_attempts = max_attempts
        self.base_retry_seconds = base_retry_seconds

    def run_once(
        self, after_commit: Callable[[GeneratedQuestion], None] | None = None
    ) -> WorkerResult:
        message = self.queue.receive(
            visibility_timeout=self.visibility_timeout,
            wait_time=self.wait_time,
        )
        if message is None:
            return WorkerResult.EMPTY
        if message.event_type != "generation_job_item.created":
            raise ValueError(f"Unsupported event type: {message.event_type}")
        if self.repository.already_processed(message.event_id):
            self.queue.delete(message.receipt_handle)
            return WorkerResult.DUPLICATE

        item_id = str(message.payload["itemId"])
        item = self.repository.claim_job_item(item_id, self.worker_id, self.lease_seconds)
        if item is None:
            return WorkerResult.DEFERRED

        try:
            question = self.provider.generate(item)
        except Exception as error:
            terminal = self.repository.fail_job_item(
                item,
                message.event_id,
                f"{type(error).__name__}: {error}",
                self.max_attempts,
                self.base_retry_seconds,
            )
            if terminal:
                self.queue.delete(message.receipt_handle)
                return WorkerResult.FAILED
            return WorkerResult.RETRY

        self.repository.complete_job_item(item, question, message.event_id)
        if after_commit is not None:
            after_commit(question)
        self.queue.delete(message.receipt_handle)
        return WorkerResult.SUCCEEDED
