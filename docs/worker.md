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

Both roles require `SQS_QUEUE_URL` and either `DATABASE_URL` or the standard
`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` fields. The AWS task
definition uses the field-based form so ECS can inject the RDS-managed username
and password directly from Secrets Manager. `PGSSLMODE=require` enables encrypted
database transport in AWS. `AWS_REGION` defaults to `us-east-1`;
`AWS_ENDPOINT_URL` is optional for an SQS-compatible local endpoint; and
`INSTANCE_ID` defaults to the container hostname.

Run one publisher or worker iteration with:

```bash
python -m generation_worker publisher --once
python -m generation_worker worker --once
```

Omit `--once` for the long-running process. The Terraform deployment uses
IAM-provided task credentials and includes the encrypted queue, bounded redrive to
a dead-letter queue, a dead-letter CloudWatch alarm, and separate publisher and
consumer permissions. No access key is committed or passed to a container.

Those controls are validated as code; live ECS/SQS failure recovery remains
unverified until the AWS deployment workflow has run. The local PostgreSQL/Moto
suite remains the executable evidence for the delivery windows above. Production
model credentials and a provider adapter are still outside the current scope.
