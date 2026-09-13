# Architecture

## Implemented in this repository

The current public foundation has six layers:

1. Versioned CSV fixtures governed by an explicit data contract.
2. A dependency-free Python validation and summary module used by the command
   line, notebooks, tests, and continuous integration.
3. A versioned PostgreSQL schema for generation jobs, question outputs,
   evaluations, human review, the transactional outbox, and consumer deduplication.
4. A TypeScript/Fastify API that registers source metadata, creates generation
   jobs, and reports job progress.
5. A Python publisher and SQS-compatible worker that deliver per-item outbox
   events, lease work, persist outputs, and recover from duplicate delivery or
   interrupted processes.
6. A React/TypeScript portal that registers source metadata, submits Bloom-targeted
   batches, monitors progress, records researcher decisions, and exports approved
   questions.

Keeping validation outside the notebooks gives every entry point the same rules
for answer uniqueness, Bloom labels, shot counts, and evaluation flags. Database
constraints independently enforce the business rules that must survive retries or
non-API writes. The API creates each job, all requested work items, and one outbox
event per item in one transaction. A request fingerprint makes idempotent retries
safe while rejecting accidental key reuse with a different payload. The publisher
and worker use expiring database leases; the worker records the logical outbox event
ID in the same transaction as the generated question so a redelivery cannot create
a second result. The portal hashes selected files locally and sends only metadata;
Nginx serves its static bundle and proxies `/api` to the TypeScript service. See
`docs/api.md`, `docs/database.md`, `docs/worker.md`, and
`docs/researcher-portal.md` for the contracts and failure behavior.

## Planned application boundary

The production extension will keep research inference in Python while separating
interactive requests from long-running generation work:

```text
React researcher portal             (implemented and interaction tested)
        |
Node.js/TypeScript API               (implemented)
        |
PostgreSQL/outbox                    (implemented)
        |
SQS-compatible queue -- Python worker (implemented and integration tested)
              |
      production model adapter        (planned)
```

The repository tests SQS semantics locally with Moto; it does not provision an AWS
queue or deploy a worker. The deterministic provider validates orchestration and
recovery without claiming production-quality question generation. Authentication,
direct source upload, a production model adapter, the evaluation pipeline, and the
AWS runtime remain target components and will move to the implemented boundary
only with code and integration tests.
