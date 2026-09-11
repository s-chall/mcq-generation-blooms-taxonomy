# Bloom's Taxonomy Question Generation and Evaluation

Research artifacts and a reproducible public analysis foundation for generating
and evaluating Bloom's-Taxonomy-aligned multiple-choice questions in introductory
chemistry and biology.

> **Current status:** This repository can validate and summarize its public demo
> dataset. The API, asynchronous workers, message queue, web interface, and cloud
> deployment described in the roadmap are not implemented yet.

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

## Repository contents

- `blooms_analysis/` — shared CSV validation and summary logic.
- `data/demo_questions.csv` — valid hand-authored fixture used by tests and CI.
- `data/sample_generated_questions.csv` — unchanged legacy research sample.
- `db/migrations/` — versioned PostgreSQL schema changes.
- `db/queries/` — worker-safe operational SQL and research summary queries.
- `db/tests/` — constraint, deduplication, index, and query integration tests.
- `notebooks/` — local, repository-relative examples without private Drive paths.
- `tests/` — contract and regression tests, including detection of the duplicated
  answer choices in the legacy sample.
- `docs/data-contract.md` — field definitions and public-data limitations.
- `docs/architecture.md` — implemented boundary and planned application design.
- `docs/database.md` — schema decisions, query behavior, and index rationale.
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

The versioned PostgreSQL job model and transactional outbox schema are now
implemented. The intended product extension will let a researcher submit source material,
generate batches asynchronously, inspect Bloom and IWF evaluations, review or edit
questions, retry failed work, and export approved questions. The target system is
a React/TypeScript portal, Node.js API, PostgreSQL job store, message queue, and
idempotent Python workers deployed as containers.

Planned features are documented as plans until working code and integration tests
are merged. See the [architecture note](docs/architecture.md).

## Authors

Kevin Hwang, Sai Challagundla, Maryam Alomair, Fow-Sen Choa, and Lujie Karen Chen
