import Fastify, { type FastifyInstance } from "fastify";

import {
  BLOOM_LEVELS,
  REVIEW_DECISIONS,
  type CreateJobInput,
  type CreateSourceInput,
  type JobRepository,
  type ReviewQuestionInput,
} from "./domain.js";
import { IdempotencyConflictError, NotFoundError } from "./errors.js";
import { approvedQuestionsCsv } from "./csv.js";

const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const sourceBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "storageUri", "contentSha256"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 300 },
    storageUri: { type: "string", minLength: 1, maxLength: 2000 },
    contentSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const;

const jobBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceDocumentId", "requestedCount", "promptVersion", "targetBlooms"],
  properties: {
    sourceDocumentId: { type: "string", pattern: uuidPattern },
    requestedCount: { type: "integer", minimum: 1, maximum: 100 },
    promptVersion: { type: "string", minLength: 1, maxLength: 100 },
    targetBlooms: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
      items: { type: "string", enum: BLOOM_LEVELS },
    },
  },
} as const;

const reviewerQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviewerId"],
  properties: {
    reviewerId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const reviewBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviewerId", "decision", "assignedBloom", "notes"],
  properties: {
    reviewerId: { type: "string", minLength: 1, maxLength: 100 },
    decision: { type: "string", enum: REVIEW_DECISIONS },
    assignedBloom: {
      anyOf: [{ type: "string", enum: BLOOM_LEVELS }, { type: "null" }],
    },
    notes: {
      anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }],
    },
  },
} as const;

export function buildApp(repository: JobRepository, logger = false): FastifyInstance {
  const app = Fastify({ logger });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await repository.checkReadiness();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.post<{ Body: CreateSourceInput }>(
    "/v1/sources",
    { schema: { body: sourceBodySchema } },
    async (request, reply) => reply.code(201).send(await repository.createSource(request.body)),
  );

  app.post<{
    Body: Omit<CreateJobInput, "idempotencyKey">;
    Headers: { "idempotency-key"?: string };
  }>(
    "/v1/jobs",
    {
      schema: {
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: {
            "idempotency-key": { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        body: jobBodySchema,
      },
    },
    async (request, reply) => {
      const result = await repository.createJob({
        ...request.body,
        idempotencyKey: request.headers["idempotency-key"]!,
      });
      if (result.replayed) {
        reply.header("Idempotency-Replayed", "true");
      }
      return reply.code(result.replayed ? 200 : 201).send(result.job);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/jobs/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: uuidPattern } },
        },
      },
    },
    async (request, reply) => {
      const job = await repository.getJob(request.params.id);
      return job ?? reply.code(404).send({ error: "Job not found" });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { reviewerId: string } }>(
    "/v1/jobs/:id/questions",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: uuidPattern } },
        },
        querystring: reviewerQuerySchema,
      },
    },
    async (request, reply) => {
      const job = await repository.getJob(request.params.id);
      if (!job) return reply.code(404).send({ error: "Job not found" });
      return repository.listQuestions(request.params.id, request.query.reviewerId);
    },
  );

  app.put<{ Params: { id: string }; Body: ReviewQuestionInput }>(
    "/v1/questions/:id/review",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: uuidPattern } },
        },
        body: reviewBodySchema,
      },
    },
    async (request) => repository.reviewQuestion(request.params.id, request.body),
  );

  app.get<{ Params: { id: string }; Querystring: { reviewerId: string } }>(
    "/v1/jobs/:id/export.csv",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: uuidPattern } },
        },
        querystring: reviewerQuerySchema,
      },
    },
    async (request, reply) => {
      const job = await repository.getJob(request.params.id);
      if (!job) return reply.code(404).send({ error: "Job not found" });
      const questions = await repository.listQuestions(
        request.params.id,
        request.query.reviewerId,
      );
      const csv = approvedQuestionsCsv(questions);
      return reply
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="job-${job.id}-approved.csv"`)
        .send(csv);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).send({ error: "Invalid request" });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.addHook("onClose", async () => repository.close());
  return app;
}
