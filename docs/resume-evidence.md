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
| PostgreSQL schema, migrations, queries, and indexing | Planned | No database implementation yet. |
| Docker-based local environment | Planned | No Docker configuration yet. |
| Continuous integration | Supported for public data and Python notebook checks | `.github/workflows/ci.yml` runs the verification suite on two Python versions. |
| Continuous deployment to AWS | Planned | No infrastructure or deployment workflow yet. |
| React/TypeScript researcher workflow | Planned | No web application yet. |
| Exact citation count | Unverified | Do not publish a number without a dated source. |
