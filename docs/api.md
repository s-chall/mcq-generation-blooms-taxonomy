# Job API

The TypeScript API implements the synchronous boundary of the generation system.
It validates researcher requests, stores durable work in PostgreSQL, and returns
before any model inference begins.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health/live` | Process liveness; does not depend on PostgreSQL. |
| `GET` | `/health/ready` | Returns `200` only when PostgreSQL accepts a query. |
| `POST` | `/v1/sources` | Registers or reuses a source by its SHA-256 content hash. |
| `POST` | `/v1/jobs` | Creates a queued generation job, work items, and one outbox event per item. |
| `GET` | `/v1/jobs/:id` | Returns job metadata and work-item counts by status. |
| `GET` | `/v1/jobs/:id/questions?reviewerId=...` | Returns the latest generated question for each completed item and that researcher's review. |
| `PUT` | `/v1/questions/:id/review` | Creates or replaces one researcher's decision, assigned Bloom level, and notes. |
| `GET` | `/v1/jobs/:id/export.csv?reviewerId=...` | Downloads only questions approved by that researcher. |

`POST /v1/jobs` requires an `Idempotency-Key` header between 8 and 128
characters. The API hashes the normalized request and stores that fingerprint
with the key:

- retrying the same key and body returns the original job with status `200` and
  `Idempotency-Replayed: true`;
- reusing the key with a different body returns `409`;
- concurrent identical submissions are serialized with a transaction-scoped
  PostgreSQL advisory lock.

The job, its requested work items, and their `generation_job_item.created` outbox
events are committed in one transaction. The publisher can therefore retry
publication without losing a committed item or publishing work for a rolled-back
job. Each event carries its logical event ID to SQS so the worker can deduplicate a
redelivery.

Reviews are an idempotent upsert keyed by question and reviewer. A reviewer can
choose `APPROVED`, `NEEDS_EDIT`, or `REJECTED`, assign a Bloom level, and record
optional notes. The export endpoint applies the same reviewer scope and excludes
unreviewed, rejected, and needs-edit questions. CSV fields are escaped so commas,
quotes, and line breaks in question text remain valid.

## Run locally

Install the locked Node.js dependencies and run the request-level tests:

```bash
npm ci
make api-test
```

Run the repository and HTTP integration test against an isolated PostgreSQL
container:

```bash
make api-integration-test
```

Start the application stack after applying migrations:

```bash
docker compose up --detach --wait postgres
docker compose --profile tools run --rm migrate
docker compose --profile application up --build api web
```

Register a source document:

```bash
curl --request POST http://localhost:3000/v1/sources \
  --header 'content-type: application/json' \
  --data '{
    "title": "Atomic structure notes",
    "storageUri": "s3://local-demo/atomic-structure.txt",
    "contentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

Use the returned source ID to submit a job:

```bash
curl --request POST http://localhost:3000/v1/jobs \
  --header 'content-type: application/json' \
  --header 'idempotency-key: local-demo-0001' \
  --data '{
    "sourceDocumentId": "REPLACE_WITH_SOURCE_ID",
    "requestedCount": 6,
    "promptVersion": "demo-v1",
    "targetBlooms": ["Remember", "Understand", "Apply"]
  }'
```

The API accepts either `DATABASE_URL` or the standard `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD` fields. The latter lets the AWS task
definition inject RDS-managed credentials from Secrets Manager without assembling
or storing a connection URL. `PGSSLMODE=require` enables encrypted transport in
that environment.

## Deliberate boundary

The adjacent Python service publishes these outbox events and processes them with
an SQS-compatible queue. The API does not authenticate researchers or accept file
bytes; `reviewerId` is currently caller-supplied and source registration records
an existing storage URI plus a SHA-256 fingerprint. The worker uses a local
deterministic provider rather than a production model. Authentication, direct
upload, and production inference remain planned and are not represented as
implemented features.
