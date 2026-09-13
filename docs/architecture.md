# Architecture

## Implemented in this repository

The current public foundation has four layers:

1. Versioned CSV fixtures governed by an explicit data contract.
2. A dependency-free Python validation and summary module used by the command
   line, notebooks, tests, and continuous integration.
3. A versioned PostgreSQL schema for generation jobs, question outputs,
   evaluations, human review, the transactional outbox, and consumer deduplication.
4. A TypeScript/Fastify API that registers source metadata, creates generation
   jobs, and reports job progress.

Keeping validation outside the notebooks gives every entry point the same rules
for answer uniqueness, Bloom labels, shot counts, and evaluation flags. Database
constraints independently enforce the business rules that must survive retries or
non-API writes. The API creates each job, all requested work items, and its outbox
event in one transaction. A request fingerprint makes idempotent retries safe while
rejecting accidental key reuse with a different payload. See `docs/api.md` and
`docs/database.md` for the HTTP contract, operational queries, and index rationale.

## Planned application boundary

The production extension will keep research inference in Python while separating
interactive requests from long-running generation work:

```text
React researcher portal             (planned)
        |
Node.js/TypeScript API               (implemented)
        |
PostgreSQL/outbox                    (implemented)
        |
SQS -- Python workers                (planned)
              |
      generation/evaluation          (planned)
```

The API currently ends at the transactional outbox. The queue publisher, worker,
portal, and cloud runtime remain target components and will move to the implemented
boundary only with code and integration tests.
