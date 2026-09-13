from __future__ import annotations

import argparse
import os
import socket
import time

import boto3

from generation_worker.provider import DeterministicDemoProvider
from generation_worker.publisher import OutboxPublisher
from generation_worker.queue import SqsQueue
from generation_worker.repository import PostgresRepository
from generation_worker.service import GenerationWorker


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def build_queue() -> SqsQueue:
    client = boto3.client(
        "sqs",
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    return SqsQueue(required("SQS_QUEUE_URL"), client)


def run(role: str, once: bool) -> None:
    repository = PostgresRepository(required("DATABASE_URL"))
    queue = build_queue()
    identity = os.environ.get("INSTANCE_ID", socket.gethostname())

    while True:
        if role == "publisher":
            count = OutboxPublisher(repository, queue, identity).publish_once()
            if count == 0:
                time.sleep(1)
        else:
            GenerationWorker(
                repository,
                queue,
                DeterministicDemoProvider(),
                identity,
            ).run_once()
        if once:
            return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=("publisher", "worker"))
    parser.add_argument("--once", action="store_true")
    arguments = parser.parse_args()
    run(arguments.role, arguments.once)


if __name__ == "__main__":
    main()
