import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Pool } from "pg";

import { buildApp } from "../src/app.js";
import { IdempotencyConflictError } from "../src/errors.js";
import { PostgresJobRepository } from "../src/postgres-repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set for integration tests");
}

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PostgresJobRepository(pool);
const app = buildApp(repository);

before(async () => {
  await pool.query(`
    TRUNCATE TABLE
      processed_messages,
      outbox_events,
      human_reviews,
      automated_evaluations,
      questions,
      job_items,
      generation_jobs,
      source_documents
    RESTART IDENTITY CASCADE
  `);
});

after(async () => app.close());

test("creates a job, work items, and outbox event in one transaction", async () => {
  const sourceResponse = await app.inject({
    method: "POST",
    url: "/v1/sources",
    payload: {
      title: "Atomic structure notes",
      storageUri: "s3://test/atomic-structure.txt",
      contentSha256: "a".repeat(64),
    },
  });
  assert.equal(sourceResponse.statusCode, 201);
  const source = sourceResponse.json<{ id: string }>();
  const input = {
    idempotencyKey: "integration-request-0001",
    sourceDocumentId: source.id,
    requestedCount: 3,
    promptVersion: "demo-v1",
    targetBlooms: ["Remember", "Apply"] as const,
  };

  const firstResponse = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": input.idempotencyKey },
    payload: {
      sourceDocumentId: input.sourceDocumentId,
      requestedCount: input.requestedCount,
      promptVersion: input.promptVersion,
      targetBlooms: input.targetBlooms,
    },
  });
  assert.equal(firstResponse.statusCode, 201);
  const first = firstResponse.json<{ id: string; itemCounts: { queued: number } }>();
  assert.equal(first.itemCounts.queued, 3);

  const storedItems = await pool.query<{ ordinal: number; target_bloom: string }>(`
    SELECT ordinal, target_bloom
    FROM job_items
    WHERE job_id = $1
    ORDER BY ordinal
  `, [first.id]);
  assert.deepEqual(storedItems.rows, [
    { ordinal: 1, target_bloom: "Remember" },
    { ordinal: 2, target_bloom: "Apply" },
    { ordinal: 3, target_bloom: "Remember" },
  ]);

  const outbox = await pool.query<{ count: string }>(`
    SELECT count(*) AS count
    FROM outbox_events
    WHERE aggregate_id = $1 AND event_type = 'generation_job.created'
  `, [first.id]);
  assert.equal(Number(outbox.rows[0]!.count), 1);

  const [retryA, retryB] = await Promise.all([
    repository.createJob({ ...input, targetBlooms: [...input.targetBlooms] }),
    repository.createJob({ ...input, targetBlooms: [...input.targetBlooms] }),
  ]);
  assert.equal(retryA.job.id, first.id);
  assert.equal(retryB.job.id, first.id);
  assert.equal(retryA.replayed, true);
  assert.equal(retryB.replayed, true);

  await assert.rejects(
    repository.createJob({
      ...input,
      requestedCount: 4,
      targetBlooms: [...input.targetBlooms],
    }),
    IdempotencyConflictError,
  );

  const fetched = await app.inject({ method: "GET", url: `/v1/jobs/${first.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json<{ itemCounts: { queued: number } }>().itemCounts.queued, 3);

  const replayed = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": input.idempotencyKey },
    payload: {
      sourceDocumentId: input.sourceDocumentId,
      requestedCount: input.requestedCount,
      promptVersion: input.promptVersion,
      targetBlooms: input.targetBlooms,
    },
  });
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.headers["idempotency-replayed"], "true");

  const conflict = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": input.idempotencyKey },
    payload: {
      sourceDocumentId: input.sourceDocumentId,
      requestedCount: 4,
      promptVersion: input.promptVersion,
      targetBlooms: input.targetBlooms,
    },
  });
  assert.equal(conflict.statusCode, 409);

  const totals = await pool.query<{ jobs: string; items: string; events: string }>(`
    SELECT
      (SELECT count(*) FROM generation_jobs) AS jobs,
      (SELECT count(*) FROM job_items) AS items,
      (SELECT count(*) FROM outbox_events) AS events
  `);
  assert.deepEqual(totals.rows[0], { jobs: "1", items: "3", events: "1" });
});
