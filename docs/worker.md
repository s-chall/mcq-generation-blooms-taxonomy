# Queue publisher and worker

The Python service closes the asynchronous boundary between committed API work and
question output. It has two roles that share the same PostgreSQL repository and
SQS-compatible queue adapter:

- `publisher` leases unpublished outbox rows, sends their per-item events, and
  marks each row published only after SQS accepts it;
- `worker` receives one event, leases the named job item, calls a question
  provider, and commits the output and deduplication record together.

The bundled `DeterministicDemoProvider` makes this pipeline reproducible and
offline-testable. It is intentionally not a production model adapter and its text
must not be presented as research-quality generated output.

## Delivery and recovery contract

SQS provides at-least-once delivery, so the application treats the outbox event ID
as the logical message ID. The system does not claim exactly-once message delivery;
it makes the database effect idempotent.

| Failure window | Durable state | Recovery behavior |
| --- | --- | --- |
| Publisher stops before SQS accepts the event | Outbox event remains unpublished and leased | Another publisher reclaims it after lease expiry. |
| Publisher stops after send but before marking published | SQS has the event; outbox row remains unpublished | Republish can create a duplicate; the consumer deduplicates by event ID. |
| Worker stops during provider execution | Item remains `RUNNING` with a lease; message is unacknowledged | A replacement worker reclaims the expired item lease on redelivery. |
| Provider raises a retryable error | Item moves to `RETRY`, clears its lease, and schedules exponential backoff | A later delivery claims the item when `next_attempt_at` is due. |
| Worker stops after database commit but before SQS delete | Question and processed-event ID are durable; message is unacknowledged | Redelivery is acknowledged without another provider call or question row. |
| Provider reaches the configured final attempt | Item moves to `FAILED` and event ID is recorded | The message is acknowledged; the parent job becomes failed or partially failed. |

The integration tests shorten or explicitly expire leases and set SQS visibility to
zero so these transitions are deterministic. Production values should keep the SQS
visibility timeout and database lease longer than the expected provider call, or
add lease/visibility heartbeats for long generations.

## Run the verification suite

Install locked Python dependencies, then run the fast service tests:

```bash
uv sync --frozen
make worker-test
```

Run the PostgreSQL/SQS failure-injection tests. PostgreSQL runs in an isolated
Docker Compose project and SQS is emulated in process with Moto:

```bash
make worker-integration-test
```

Build the same non-root worker image that CI verifies:

```bash
docker build --file services/worker/Dockerfile --tag blooms-worker:test .
```

## Runtime configuration

Both roles require `DATABASE_URL` and `SQS_QUEUE_URL`. `AWS_REGION` defaults to
`us-east-1`; `AWS_ENDPOINT_URL` is optional for an SQS-compatible local endpoint;
and `INSTANCE_ID` defaults to the container hostname.

Run one publisher or worker iteration with:

```bash
python -m generation_worker publisher --once
python -m generation_worker worker --once
```

Omit `--once` for the long-running process. In an AWS deployment, use IAM-provided
credentials instead of committing access keys. Queue creation, IAM policies, a
dead-letter queue, deployment, and production model credentials are deliberately
outside this change and remain required before claiming an AWS deployment.
