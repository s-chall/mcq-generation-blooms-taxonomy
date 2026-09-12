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
| `POST` | `/v1/jobs` | Creates a queued generation job, work items, and an outbox event. |
| `GET` | `/v1/jobs/:id` | Returns job metadata and work-item counts by status. |

`POST /v1/jobs` requires an `Idempotency-Key` header between 8 and 128
characters. The API hashes the normalized request and stores that fingerprint
with the key:

- retrying the same key and body returns the original job with status `200` and
  `Idempotency-Replayed: true`;
- reusing the key with a different body returns `409`;
- concurrent identical submissions are serialized with a transaction-scoped
  PostgreSQL advisory lock.

The job, its requested work items, and the `generation_job.created` outbox event
are committed in one transaction. A queue publisher added in a later change can
therefore retry publication without losing a committed job or publishing work
for a rolled-back job.

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
docker compose --profile application up --build api
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

## Deliberate boundary

This API does not yet publish outbox events, run Python generation workers,
authenticate researchers, accept file bytes, or expose question review and export
routes. Those remain planned and are not represented as implemented features.
