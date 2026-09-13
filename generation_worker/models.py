from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class OutboxEvent:
    id: str
    event_type: str
    payload: dict[str, Any]
    attempt_count: int


@dataclass(frozen=True)
class QueueMessage:
    event_id: str
    event_type: str
    payload: dict[str, Any]
    receipt_handle: str


@dataclass(frozen=True)
class WorkItem:
    id: str
    job_id: str
    target_bloom: str
    prompt_version: str
    source_title: str
    attempt_count: int
    lease_owner: str


@dataclass(frozen=True)
class GeneratedQuestion:
    stem: str
    correct_answer: str
    distractors: tuple[str, str, str]
    model_name: str


class Queue(Protocol):
    def send(self, event: OutboxEvent) -> str: ...

    def receive(self, *, visibility_timeout: int, wait_time: int) -> QueueMessage | None: ...

    def delete(self, receipt_handle: str) -> None: ...


class PublisherRepository(Protocol):
    def claim_outbox_events(
        self, publisher_id: str, batch_size: int, lease_seconds: int
    ) -> list[OutboxEvent]: ...

    def mark_outbox_event_published(self, event_id: str, publisher_id: str) -> None: ...


class WorkerRepository(Protocol):
    def already_processed(self, event_id: str) -> bool: ...

    def claim_job_item(
        self, item_id: str, worker_id: str, lease_seconds: int
    ) -> WorkItem | None: ...

    def complete_job_item(
        self, item: WorkItem, question: GeneratedQuestion, event_id: str
    ) -> None: ...

    def fail_job_item(
        self,
        item: WorkItem,
        event_id: str,
        error: str,
        max_attempts: int,
        base_retry_seconds: int,
    ) -> bool: ...


class QuestionProvider(Protocol):
    def generate(self, item: WorkItem) -> GeneratedQuestion: ...
