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

test("persists an idempotent job and reviewer-scoped approved export", async () => {
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
    WHERE payload->>'jobId' = $1 AND event_type = 'generation_job_item.created'
  `, [first.id]);
  assert.equal(Number(outbox.rows[0]!.count), 3);

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
  assert.deepEqual(totals.rows[0], { jobs: "1", items: "3", events: "3" });

  const question = await pool.query<{ id: string }>(`
    INSERT INTO questions (
      job_item_id,
      stem,
      correct_answer,
      distractors,
      model_name,
      prompt_version
    )
    SELECT
      id,
      'Which electron configuration matches sodium?',
      '1s2 2s2 2p6 3s1',
      '["1s2 2s2 2p5 3s2", "1s2 2s2 2p6", "1s2 2s2 2p6 3s2"]'::jsonb,
      'integration-provider',
      'demo-v1'
    FROM job_items
    WHERE job_id = $1 AND ordinal = 1
    RETURNING id
  `, [first.id]);
  const questionId = question.rows[0]!.id;

  const initialQuestions = await app.inject({
    method: "GET",
    url: `/v1/jobs/${first.id}/questions?reviewerId=faculty-1`,
  });
  assert.equal(initialQuestions.statusCode, 200);
  assert.equal(initialQuestions.json<Array<{ review: unknown }>>()[0]?.review, null);

  const firstReview = await app.inject({
    method: "PUT",
    url: `/v1/questions/${questionId}/review`,
    payload: {
      reviewerId: "faculty-1",
      decision: "NEEDS_EDIT",
      assignedBloom: "Understand",
      notes: "Use a more diagnostic distractor.",
    },
  });
  assert.equal(firstReview.statusCode, 200);

  const approved = await app.inject({
    method: "PUT",
    url: `/v1/questions/${questionId}/review`,
    payload: {
      reviewerId: "faculty-1",
      decision: "APPROVED",
      assignedBloom: "Remember",
      notes: "Ready for the item bank.",
    },
  });
  assert.equal(approved.statusCode, 200);

  const rejectedQuestion = await pool.query<{ id: string }>(`
    INSERT INTO questions (
      job_item_id,
      stem,
      correct_answer,
      distractors,
      model_name,
      prompt_version
    )
    SELECT
      id,
      'This rejected question must not be exported',
      'Correct answer',
      '["Distractor one", "Distractor two", "Distractor three"]'::jsonb,
      'integration-provider',
      'demo-v1'
    FROM job_items
    WHERE job_id = $1 AND ordinal = 2
    RETURNING id
  `, [first.id]);
  const rejected = await app.inject({
    method: "PUT",
    url: `/v1/questions/${rejectedQuestion.rows[0]!.id}/review`,
    payload: {
      reviewerId: "faculty-1",
      decision: "REJECTED",
      assignedBloom: "Apply",
      notes: "Not suitable for the item bank.",
    },
  });
  assert.equal(rejected.statusCode, 200);

  const storedReview = await pool.query<{
    review_count: string;
    decision: string;
    assigned_bloom: string;
  }>(`
    SELECT
      count(*) AS review_count,
      max(decision::text) AS decision,
      max(assigned_bloom::text) AS assigned_bloom
    FROM human_reviews
    WHERE question_id = $1 AND reviewer_id = 'faculty-1'
  `, [questionId]);
  assert.deepEqual(storedReview.rows[0], {
    review_count: "1",
    decision: "APPROVED",
    assigned_bloom: "Remember",
  });

  const exported = await app.inject({
    method: "GET",
    url: `/v1/jobs/${first.id}/export.csv?reviewerId=faculty-1`,
  });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.body, /Which electron configuration matches sodium\?/);
  assert.match(exported.body, /Ready for the item bank\./);
  assert.doesNotMatch(exported.body, /This rejected question must not be exported/);
});
