# Architecture

## Implemented in this repository

The current public foundation has two layers:

1. Versioned CSV fixtures governed by an explicit data contract.
2. A dependency-free Python validation and summary module used by the command
   line, notebooks, tests, and continuous integration.

Keeping validation outside the notebooks gives every entry point the same rules
for answer uniqueness, Bloom labels, shot counts, and evaluation flags.

## Planned application boundary

The production extension will keep research inference in Python while separating
interactive requests from long-running generation work:

```text
React researcher portal
        |
Node.js API -- PostgreSQL/outbox -- SQS -- Python workers
                                              |
                                      generation/evaluation
```

This diagram is a target, not a claim about the current implementation. Planned
components will be moved into the implemented section only when their code and
integration tests are merged.
