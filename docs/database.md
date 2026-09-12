# PostgreSQL design

The database is both the durable system of record and part of the correctness
boundary for asynchronous work. Migration `001_create_generation_schema.sql`
creates source documents, batch jobs, individual work items, questions, automated
evaluations, human reviews, transactional outbox events, and processed-message
deduplication records.

Migration `002_add_job_request_fingerprint.sql` adds the normalized-request hash
used by the API. The globally unique idempotency key identifies a logical request;
the fingerprint distinguishes a legitimate retry from accidental reuse of that key
for different work.

Migration `003_add_delivery_leases.sql` adds outbox publisher leases and two
single-item recovery functions. `claim_outbox_events` lets another publisher
reclaim an unpublished event after an interrupted publisher's lease expires.
`claim_job_item` claims the item named by an SQS event or reclaims an expired
`RUNNING` lease. `refresh_generation_job_status` derives the parent state after an
item succeeds or fails.

## Business rules enforced by the database

- A job requests between 1 and 1,000 questions and has a unique idempotency key.
- Each job-item ordinal is unique within its job.
- A running item must have both a lease owner and expiration; a non-running item
  cannot retain a lease.
- A generated question has exactly three non-empty distractors, none equal to the
  correct answer after case and whitespace normalization.
- Evaluators may record at most one result per question and evaluator version.
- A consumer can record a logical outbox event ID only once.

These constraints complement API validation. They protect the data even when a
retrying worker or a future administrative script writes directly to PostgreSQL.

## Worker claim queries

The `claim_job_items` database function locks only the rows selected by one worker
and uses `FOR UPDATE SKIP LOCKED`. Concurrent workers can therefore claim different
ready items without waiting on or duplicating one another. The update records the
worker lease and increments the attempt count in the same statement.

`db/queries/claim_job_items.sql` is the parameterized application call to this
function. Keeping the multi-step claim operation inside PostgreSQL makes its
transaction boundary explicit and allows integration tests to exercise it directly.

The queue consumer uses `claim_job_item` because each message names one work item.
The generated question, successful item transition, processed-event record, and
parent-job refresh commit in one transaction. If the process stops after that
commit but before deleting the SQS message, the next delivery finds the processed
event ID and acknowledges it without generating another question.

Failures clear the worker lease and move the item to `RETRY` with exponential
backoff. The final configured attempt moves it to `FAILED` and records the event as
processed. An interrupted process does neither, so a replacement worker can claim
the expired `RUNNING` lease.

## Partial indexes

`idx_job_items_ready` indexes `(next_attempt_at, created_at, id)` only for `QUEUED`
and `RETRY` items. The worker claim query filters on exactly those statuses and
orders by the same leading columns. Completed, failed, and currently running rows
do not consume space in this hot-path index.

`idx_outbox_events_unpublished` applies the same principle to unpublished outbox
events. Once published, an event leaves the index while remaining available for
audit.

Inspect the worker plan after loading representative data with:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM job_items
WHERE status IN ('QUEUED', 'RETRY')
  AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, id
LIMIT 10;
```

Do not quote a performance improvement on a resume until this plan is measured
against representative data and the before/after output is committed.

## Analytical query

`db/queries/bloom_quality_summary.sql` reports evaluated question count, exact
Bloom alignment, alignment percentage, and average IWF pass count for each target
Bloom level. The database integration test executes this query against controlled
records so schema changes cannot silently break it.

## Verification

Run the migrations twice and then execute the PostgreSQL integration tests:

```bash
make db-test
```

The second migration pass verifies that the migration ledger prevents accidental
reapplication. The test environment uses an isolated Docker Compose project and
removes its containers and volumes when the run finishes.

Run the end-to-end lease and deduplication scenarios with:

```bash
make worker-integration-test
```
