from __future__ import annotations

from collections.abc import Callable

from generation_worker.models import OutboxEvent, PublisherRepository, Queue


class OutboxPublisher:
    def __init__(
        self,
        repository: PublisherRepository,
        queue: Queue,
        publisher_id: str,
        *,
        batch_size: int = 10,
        lease_seconds: int = 60,
    ) -> None:
        self.repository = repository
        self.queue = queue
        self.publisher_id = publisher_id
        self.batch_size = batch_size
        self.lease_seconds = lease_seconds

    def publish_once(
        self, after_send: Callable[[OutboxEvent], None] | None = None
    ) -> int:
        events = self.repository.claim_outbox_events(
            self.publisher_id, self.batch_size, self.lease_seconds
        )
        published = 0
        for event in events:
            self.queue.send(event)
            if after_send is not None:
                after_send(event)
            self.repository.mark_outbox_event_published(event.id, self.publisher_id)
            published += 1
        return published
