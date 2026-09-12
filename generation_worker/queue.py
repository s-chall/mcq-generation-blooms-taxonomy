from __future__ import annotations

import json
from typing import Any

import boto3

from generation_worker.models import OutboxEvent, QueueMessage


class SqsQueue:
    def __init__(self, queue_url: str, client: Any | None = None) -> None:
        self.queue_url = queue_url
        self.client = client or boto3.client("sqs")

    def send(self, event: OutboxEvent) -> str:
        response = self.client.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(
                {
                    "eventId": event.id,
                    "eventType": event.event_type,
                    "payload": event.payload,
                    "schemaVersion": 1,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        )
        return str(response["MessageId"])

    def receive(self, *, visibility_timeout: int, wait_time: int) -> QueueMessage | None:
        response = self.client.receive_message(
            QueueUrl=self.queue_url,
            MaxNumberOfMessages=1,
            VisibilityTimeout=visibility_timeout,
            WaitTimeSeconds=wait_time,
        )
        messages = response.get("Messages", [])
        if not messages:
            return None

        raw = messages[0]
        body = json.loads(raw["Body"])
        if body.get("schemaVersion") != 1:
            raise ValueError("Unsupported queue message schema version")
        return QueueMessage(
            event_id=str(body["eventId"]),
            event_type=str(body["eventType"]),
            payload=dict(body["payload"]),
            receipt_handle=str(raw["ReceiptHandle"]),
        )

    def delete(self, receipt_handle: str) -> None:
        self.client.delete_message(QueueUrl=self.queue_url, ReceiptHandle=receipt_handle)
