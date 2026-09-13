import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import {
  type CreateJobInput,
  type CreatedJob,
  type CreateSourceInput,
  type HumanReview,
  type Job,
  type JobRepository,
  type Question,
  type ReviewQuestionInput,
  type SourceDocument,
} from "../src/domain.js";

class FakeRepository implements JobRepository {
  public ready = true;
  public createdJobInput: CreateJobInput | null = null;
  public reviewInput: ReviewQuestionInput | null = null;

  public async checkReadiness(): Promise<void> {
    if (!this.ready) throw new Error("database unavailable");
  }

  public async createSource(input: CreateSourceInput): Promise<SourceDocument> {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      ...input,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  public async createJob(input: CreateJobInput): Promise<CreatedJob> {
    this.createdJobInput = input;
    return { job: exampleJob(), replayed: false };
  }

  public async getJob(id: string): Promise<Job | null> {
    return id === exampleJob().id ? exampleJob() : null;
  }

  public async listQuestions(jobId: string, reviewerId: string): Promise<Question[]> {
    return jobId === exampleJob().id ? [exampleQuestion(reviewerId)] : [];
  }

  public async reviewQuestion(
    _questionId: string,
    input: ReviewQuestionInput,
  ): Promise<HumanReview> {
    this.reviewInput = input;
    return {
      ...input,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  public async close(): Promise<void> {}
}

function exampleQuestion(reviewerId: string): Question {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    jobId: exampleJob().id,
    ordinal: 1,
    targetBloom: "Apply",
    stem: 'Which statement includes a "quoted" phrase?',
    correctAnswer: "Correct answer",
    distractors: ["First distractor", "Second, distractor", "Third distractor"],
    modelName: "test-provider",
    promptVersion: "demo-v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    review: {
      reviewerId,
      decision: "APPROVED",
      assignedBloom: "Apply",
      notes: "Ready for export",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function exampleJob(): Job {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    sourceDocumentId: "00000000-0000-4000-8000-000000000001",
    requestedCount: 2,
    promptVersion: "demo-v1",
    status: "QUEUED",
    itemCounts: { queued: 2, running: 0, retry: 0, succeeded: 0, failed: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("liveness does not depend on PostgreSQL and readiness does", async () => {
  const repository = new FakeRepository();
  const app = buildApp(repository);

  assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
  repository.ready = false;
  assert.equal((await app.inject({ method: "GET", url: "/health/ready" })).statusCode, 503);

  await app.close();
});

test("job submission requires a valid idempotency key and Bloom request", async () => {
  const repository = new FakeRepository();
  const app = buildApp(repository);
  const validBody = {
    sourceDocumentId: "00000000-0000-4000-8000-000000000001",
    requestedCount: 2,
    promptVersion: "demo-v1",
    targetBlooms: ["Remember", "Apply"],
  };

  const missingKey = await app.inject({ method: "POST", url: "/v1/jobs", payload: validBody });
  assert.equal(missingKey.statusCode, 400);

  const invalidBloom = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": "request-0001" },
    payload: { ...validBody, targetBlooms: ["Invent"] },
  });
  assert.equal(invalidBloom.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": "request-0001" },
    payload: validBody,
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(repository.createdJobInput?.targetBlooms, ["Remember", "Apply"]);

  await app.close();
});

test("unknown jobs return 404", async () => {
  const app = buildApp(new FakeRepository());
  const response = await app.inject({
    method: "GET",
    url: "/v1/jobs/00000000-0000-4000-8000-000000000099",
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("researchers can list, review, and export approved questions", async () => {
  const repository = new FakeRepository();
  const app = buildApp(repository);
  const jobId = exampleJob().id;
  const questionId = exampleQuestion("reviewer-1").id;

  const listed = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/questions?reviewerId=reviewer-1`,
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json<Question[]>()[0]?.review?.decision, "APPROVED");

  const invalid = await app.inject({
    method: "PUT",
    url: `/v1/questions/${questionId}/review`,
    payload: {
      reviewerId: "reviewer-1",
      decision: "MAYBE",
      assignedBloom: null,
      notes: null,
    },
  });
  assert.equal(invalid.statusCode, 400);

  const reviewed = await app.inject({
    method: "PUT",
    url: `/v1/questions/${questionId}/review`,
    payload: {
      reviewerId: "reviewer-1",
      decision: "NEEDS_EDIT",
      assignedBloom: "Analyze",
      notes: "Tighten the stem",
    },
  });
  assert.equal(reviewed.statusCode, 200);
  assert.equal(repository.reviewInput?.decision, "NEEDS_EDIT");

  const exported = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/export.csv?reviewerId=reviewer-1`,
  });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.headers["content-type"] ?? "", /^text\/csv/);
  assert.match(exported.headers["content-disposition"] ?? "", /attachment/);
  assert.match(exported.body, /"Which statement includes a ""quoted"" phrase\?"/);
  assert.match(exported.body, /"Second, distractor"/);

  await app.close();
});
