# Researcher portal

The React/TypeScript portal provides one complete staff workflow over the job API:

1. identify the reviewer and an existing source location;
2. select a local copy so the browser can calculate its SHA-256 fingerprint;
3. choose the requested question count and Bloom levels;
4. submit and refresh the generation batch;
5. approve, reject, or mark each generated question as needing edits; and
6. download a CSV containing only that reviewer's approved questions.

The selected file is not uploaded. The browser hashes its bytes locally and sends
the title, existing storage URI, and fingerprint to the API. This makes duplicate
source registration deterministic without implying that this public repository
implements secure document storage.

## Architecture

The portal is a Vite-built React application served by an unprivileged Nginx
container. Nginx serves the compiled static assets and proxies `/api/*` requests to
the TypeScript API over the Compose network. The frontend uses a typed `ResearchApi`
interface, so interaction tests exercise the researcher workflow without requiring
a database while the API integration suite verifies the same review and export
contract against real PostgreSQL.

This separation keeps UI state and HTTP/storage behavior testable independently:

```text
Browser -> Nginx /api proxy -> Fastify API -> PostgreSQL
                                  |
                                  +-> outbox -> SQS-compatible worker
```

## Run locally

Install locked dependencies and verify the portal:

```bash
npm ci
make web-test
make web-build
```

Start the application after applying database migrations:

```bash
docker compose up --detach --wait postgres
docker compose --profile tools run --rm migrate
docker compose --profile application up --build
```

Open `http://localhost:8080`. The application needs the publisher and worker to
produce questions; see `docs/worker.md` for that runtime configuration.

## Tested behavior

The component tests cover required batch inputs, Bloom selection, source and job
creation, progress refresh, reviewer-scoped question loading, a saved approval,
and the approved-export link. API request tests cover invalid review decisions and
CSV escaping. The PostgreSQL integration test proves that updating a review
replaces the prior decision rather than creating a duplicate and that only the
approved state appears in export. `make application-smoke-test` builds the
production API and portal images, applies migrations, waits for all container
health checks, and verifies both the rendered page and Nginx-to-API proxy.

## Deliberate boundary

This is a research workflow, not a production identity or storage system. Reviewer
IDs are caller-supplied, source bytes are not uploaded, and authorization is not
implemented. Question-text editing, IWF evaluation display, retry controls, live
status polling, and browser-to-live-stack end-to-end tests remain future changes.
The portal has an AWS task definition and deployment workflow, but a live AWS run
remains unverified.
