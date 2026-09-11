# Architecture

## Implemented in this repository

The current public foundation has three layers:

1. Versioned CSV fixtures governed by an explicit data contract.
2. A dependency-free Python validation and summary module used by the command
   line, notebooks, tests, and continuous integration.
3. A versioned PostgreSQL schema for generation jobs, question outputs,
   evaluations, human review, the transactional outbox, and consumer deduplication.

Keeping validation outside the notebooks gives every entry point the same rules
for answer uniqueness, Bloom labels, shot counts, and evaluation flags. Database
constraints independently enforce the business rules that must survive retries or
non-API writes. See `docs/database.md` for the operational queries and index
rationale.

## Planned application boundary

The production extension will keep research inference in Python while separating
interactive requests from long-running generation work:

```text
React researcher portal             (planned)
        |
Node.js API                          (planned)
        |
PostgreSQL/outbox                    (implemented)
        |
SQS -- Python workers                (planned)
              |
      generation/evaluation          (planned)
```

This diagram is a target, not a claim about the current implementation. Planned
components will be moved into the implemented section only when their code and
integration tests are merged.
