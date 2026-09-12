# Resume evidence ledger

This ledger prevents the repository and resume from getting ahead of the working
software. A claim becomes `supported` only when the linked code and automated tests
exist on the default branch.

| Claim | Status after this change | Evidence |
| --- | --- | --- |
| Contributed to Bloom-aligned MCQ research presented at the NeurIPS 2023 GAIED workshop | Supported | Authorship and methods are linked in `docs/publications.md`. |
| Reproducible public Python analysis | Supported for the public demo fixture | `make verify`, `blooms_analysis/`, executable notebook tests, and `data/demo_questions.csv`. |
| Node.js/TypeScript API | Supported for job submission | `services/api/` provides health, source registration, idempotent job creation, and job-status endpoints. Request-level and real-PostgreSQL tests cover validation, concurrent retries, key conflicts, work-item creation, and the transactional outbox. Review/export routes remain planned. |
| Python task workers | Planned | No worker or queue integration yet. |
| Fault tolerance under retries, duplicate delivery, and worker interruption | Planned | No failure-injection integration tests yet. |
| PostgreSQL schema, migrations, queries, and indexing | Supported | Versioned migration, repeat-safe migration runner, business-rule integration tests, worker claim and research queries, and partial-index rationale in `docs/database.md`. |
| Docker-based local environment | Supported for PostgreSQL and the API | `compose.yaml`, the API `Dockerfile`, and the Make targets provide isolated database verification, API integration testing, and a non-root production API image. Worker images remain planned. |
| Continuous integration | Supported for Python, PostgreSQL, and the Node.js API | `.github/workflows/ci.yml` compiles TypeScript, runs request and database integration tests, builds the production API image, audits production dependencies, and retains the Python and schema checks. Deployment remains planned. |
| Continuous deployment to AWS | Planned | No infrastructure or deployment workflow yet. |
| React/TypeScript researcher workflow | Planned | No web application yet. |
| Exact citation count | Unverified | Do not publish a number without a dated source. |
