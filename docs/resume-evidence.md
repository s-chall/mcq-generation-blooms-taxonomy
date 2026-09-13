# Resume evidence ledger

This ledger prevents the repository and resume from getting ahead of the working
software. A claim becomes `supported` only when the linked code and automated tests
exist on the default branch.

| Claim | Status after this change | Evidence |
| --- | --- | --- |
| Contributed to Bloom-aligned MCQ research presented at the NeurIPS 2023 GAIED workshop | Supported | Authorship and methods are linked in `docs/publications.md`. |
| Reproducible public Python analysis | Supported for the public demo fixture | `make verify`, `blooms_analysis/`, executable notebook tests, and `data/demo_questions.csv`. |
| Node.js/TypeScript API | Supported for submission and review | `services/api/` provides health, source registration, idempotent job creation, status, reviewer-scoped question listing, review upsert, and approved CSV export. Request-level and real-PostgreSQL tests cover validation, concurrent retries, key conflicts, work-item creation, the transactional outbox, review persistence, and export filtering. |
| Python task workers | Supported for queue orchestration | `generation_worker/` publishes transactional outbox events to an SQS-compatible queue, leases named work items, persists one question per successful item, and updates aggregate job state. Unit and PostgreSQL/Moto integration tests exercise it. The included deterministic provider is not a production generation model. |
| Fault tolerance under retries, duplicate delivery, and worker interruption | Supported for the tested delivery windows | `worker_tests/pipeline_integration_test.py` injects a publisher stop after SQS accepts an event, a worker stop during generation, a worker stop after its database commit but before acknowledgement, duplicate delivery, and a retryable provider failure. Lease reclamation, logical-event deduplication, and atomic completion assertions prevent lost or duplicate output in those scenarios. AWS deployment behavior remains unverified. |
| PostgreSQL schema, migrations, queries, and indexing | Supported | Versioned migrations, repeat-safe migration runner, business-rule integration tests, leased publisher/worker claims, research queries, and partial-index rationale in `docs/database.md`. |
| Docker-based local environment | Supported for PostgreSQL, API, worker, and portal builds | `compose.yaml`, service Dockerfiles, and Make targets provide isolated database verification, API/worker integration testing, and non-root production images. Nginx serves the portal and proxies API calls inside the Compose network. |
| Continuous integration | Supported for Python, PostgreSQL, TypeScript application, and worker | `.github/workflows/ci.yml` compiles the API and React portal, runs interaction, request, database, live-stack health/proxy, and failure-recovery integration tests, builds three production images, audits all locked Node dependencies, and retains the public-data checks. Deployment remains planned. |
| Continuous deployment to AWS | Planned | No infrastructure or deployment workflow yet. |
| React/TypeScript researcher workflow | Supported for the tested review path | `services/web/` lets a researcher register source metadata, submit a Bloom-targeted batch, monitor progress, review generated questions, and export approved results. Testing Library exercises that workflow through a typed API boundary; API/PostgreSQL integration tests independently verify review persistence and filtering. Browser-to-live-stack end-to-end testing and authentication remain planned. |
| Exact citation count | Unverified | Do not publish a number without a dated source. |
