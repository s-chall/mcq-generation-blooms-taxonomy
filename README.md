# Bloom's Taxonomy Question Generation and Evaluation

Research artifacts and a reproducible public analysis foundation for generating
and evaluating Bloom's-Taxonomy-aligned multiple-choice questions in introductory
chemistry and biology.

> **Current status:** This repository validates and summarizes its public demo
> dataset and implements a tested TypeScript job API plus an SQS-compatible Python
> worker backed by PostgreSQL. A React/TypeScript portal supports batch submission,
> progress monitoring, question review, and approved-question export. The worker
> uses a deterministic offline provider; a production model adapter and cloud
> deployment remain planned.

## Research question

Writing high-quality MCQs by hand is slow, while repeated questions can weaken
assessment reliability and test security. The associated study investigated
whether GPT-3.5 could generate MCQs at requested Bloom levels and whether automated
Bloom classification and item-writing-guideline checks agreed with an experienced
teacher.

The study reported 83.79% held-out accuracy and an 83.69% weighted F1 score for
its Bloom classifier. Of 57 questions reviewed by a subject-matter expert, 12 were
rated suitable for classroom use while the automated IWF evaluation rated 24 as
high quality. These are publication results, not results recalculated from the
small public fixture in this repository.

See [publication provenance](docs/publications.md) for the paper and related work.

## Run the public analysis

Prerequisites:

- Python 3.11 or newer
- GNU Make
- Optional: [`uv`](https://docs.astral.sh/uv/) for an isolated environment
- Docker with Compose for PostgreSQL verification
- Node.js 24 for the API and portal builds and tests

Verify the repository with the system Python:

```bash
make verify
```

Or create a locked environment first:

```bash
make setup
uv run make verify PYTHON=python
```

Generate a JSON summary:

```bash
python3 -m blooms_analysis summarize data/demo_questions.csv
```

The validation command exits unsuccessfully when a dataset violates the public
contract:

```bash
python3 -m blooms_analysis validate data/demo_questions.csv
```

Apply the PostgreSQL migrations twice and run the database integration tests:

```bash
make db-test
```

Install locked API dependencies, compile TypeScript, and run request-level tests:

```bash
npm ci
make api-test
```

Run the API against an isolated PostgreSQL instance:

```bash
make api-integration-test
```

Run the worker unit tests and the PostgreSQL/SQS failure-injection suite:

```bash
make worker-test
make worker-integration-test
```

The integration suite deliberately interrupts the publisher after queue delivery,
interrupts a worker after its database commit, expires a dead worker's lease, and
replays a failed provider call. See the [worker guide](docs/worker.md) for the
delivery contract and local runtime configuration.

See the [job API guide](docs/api.md) for the endpoint contract, idempotency
behavior, container startup, and example requests.

Build and test the researcher portal:

```bash
make web-test
make web-build
```

Start PostgreSQL, the API, and the portal at `http://localhost:8080`:

```bash
docker compose up --detach --wait postgres
docker compose --profile tools run --rm migrate
docker compose --profile application up --build
```

See the [researcher portal guide](docs/researcher-portal.md) for the complete
workflow and its current security and storage boundaries.

## Repository contents

- `blooms_analysis/` — shared CSV validation and summary logic.
- `data/demo_questions.csv` — valid hand-authored fixture used by tests and CI.
- `data/sample_generated_questions.csv` — unchanged legacy research sample.
- `db/migrations/` — versioned PostgreSQL schema changes.
- `db/queries/` — worker-safe operational SQL and research summary queries.
- `db/tests/` — constraint, deduplication, index, and query integration tests.
- `services/api/` — TypeScript HTTP API, PostgreSQL repository, and tests.
- `services/web/` — React/TypeScript researcher workflow, interaction tests, and
  non-root production web image.
- `generation_worker/` — Python outbox publisher, SQS consumer, leased work-item
  processor, and deterministic local provider.
- `services/worker/` — non-root production worker image.
- `worker_tests/` — unit and PostgreSQL/SQS failure-injection tests.
- `notebooks/` — local, repository-relative examples without private Drive paths.
- `tests/` — contract and regression tests, including detection of the duplicated
  answer choices in the legacy sample.
- `docs/data-contract.md` — field definitions and public-data limitations.
- `docs/architecture.md` — implemented boundary and planned application design.
- `docs/database.md` — schema decisions, query behavior, and index rationale.
- `docs/api.md` — endpoints, transaction and idempotency rules, and local use.
- `docs/researcher-portal.md` — portal workflow, component boundary, and local use.
- `docs/worker.md` — queue delivery, leases, retries, deduplication, and failure
  recovery.
- `docs/resume-evidence.md` — claim-by-claim evidence ledger updated with each PR.
- `poster/poster.png` — conference poster associated with the research.

## Data limitations

The full training data, complete generated-question dataset, model artifacts, and
human-evaluation file used by the paper are not included. The public analysis does
not claim to reproduce the paper's metrics. The legacy sample also contains an
export defect in which each correct answer is repeated as `distractor1`; it is
retained unchanged for provenance and covered by a regression test.

See the [data contract](docs/data-contract.md) before adding or consuming a new
dataset.

## Application roadmap

The versioned PostgreSQL model, transactional outbox, Node.js/TypeScript API,
React/TypeScript review portal, SQS-compatible publisher, and idempotent Python
worker are implemented. The worker currently proves orchestration and recovery
with a deterministic provider; connecting a production generation/evaluation
model is a separate change. Authentication, direct source upload, question-text
editing, failed-item retry controls, IWF evaluation screens, and AWS deployment
remain planned.

Planned features are documented as plans until working code and integration tests
are merged. See the [architecture note](docs/architecture.md).

## Authors

Kevin Hwang, Sai Challagundla, Maryam Alomair, Fow-Sen Choa, and Lujie Karen Chen
