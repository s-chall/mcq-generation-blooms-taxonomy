# Resume evidence ledger

This ledger prevents the repository and resume from getting ahead of the working
software. A claim becomes `supported` only when the linked code and automated tests
exist on the default branch.

| Claim | Status after this change | Evidence |
| --- | --- | --- |
| Contributed to Bloom-aligned MCQ research presented at the NeurIPS 2023 GAIED workshop | Supported | Authorship and methods are linked in `docs/publications.md`. |
| Reproducible public Python analysis | Supported for the public demo fixture | `make verify`, `blooms_analysis/`, executable notebook tests, and `data/demo_questions.csv`. |
| Node.js API | Planned | No implementation yet. |
| Python task workers | Planned | No worker or queue integration yet. |
| Fault tolerance under retries, duplicate delivery, and worker interruption | Planned | No failure-injection integration tests yet. |
| PostgreSQL schema, migrations, queries, and indexing | Supported | Versioned migration, repeat-safe migration runner, business-rule integration tests, worker claim and research queries, and partial-index rationale in `docs/database.md`. |
| Docker-based local environment | Supported for PostgreSQL verification | `compose.yaml` and `make db-test` create, migrate, test, and remove an isolated PostgreSQL environment. Application images remain planned. |
| Continuous integration | Supported for Python and PostgreSQL checks | `.github/workflows/ci.yml` runs Python verification on two versions and database integration tests against PostgreSQL. |
| Continuous deployment to AWS | Planned | No infrastructure or deployment workflow yet. |
| React/TypeScript researcher workflow | Planned | No web application yet. |
| Exact citation count | Unverified | Do not publish a number without a dated source. |
