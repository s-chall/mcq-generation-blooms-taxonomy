import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  type CreateJobInput,
  type CreatedJob,
  type CreateSourceInput,
  type Job,
  type JobRepository,
  type SourceDocument,
} from "./domain.js";
import { IdempotencyConflictError, NotFoundError } from "./errors.js";

interface SourceRow extends QueryResultRow {
  id: string;
  title: string;
  storage_uri: string;
  content_sha256: string;
  created_at: Date;
}

interface JobRow extends QueryResultRow {
  id: string;
  source_document_id: string;
  requested_count: number;
  prompt_version: string;
  request_fingerprint: string;
  status: string;
  queued_count: string;
  running_count: string;
  retry_count: string;
  succeeded_count: string;
  failed_count: string;
  created_at: Date;
  updated_at: Date;
}

const JOB_SELECT = `
  SELECT
    job.id,
    job.source_document_id,
    job.requested_count,
    job.prompt_version,
    job.request_fingerprint,
    job.status,
    count(item.id) FILTER (WHERE item.status = 'QUEUED') AS queued_count,
    count(item.id) FILTER (WHERE item.status = 'RUNNING') AS running_count,
    count(item.id) FILTER (WHERE item.status = 'RETRY') AS retry_count,
    count(item.id) FILTER (WHERE item.status = 'SUCCEEDED') AS succeeded_count,
    count(item.id) FILTER (WHERE item.status = 'FAILED') AS failed_count,
    job.created_at,
    job.updated_at
  FROM generation_jobs AS job
  LEFT JOIN job_items AS item ON item.job_id = job.id
`;

function fingerprint(input: CreateJobInput): string {
  const normalized = JSON.stringify({
    promptVersion: input.promptVersion,
    requestedCount: input.requestedCount,
    sourceDocumentId: input.sourceDocumentId,
    targetBlooms: input.targetBlooms,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

function mapSource(row: SourceRow): SourceDocument {
  return {
    id: row.id,
    title: row.title,
    storageUri: row.storage_uri,
    contentSha256: row.content_sha256,
    createdAt: row.created_at.toISOString(),
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    requestedCount: row.requested_count,
    promptVersion: row.prompt_version,
    status: row.status,
    itemCounts: {
      queued: Number(row.queued_count),
      running: Number(row.running_count),
      retry: Number(row.retry_count),
      succeeded: Number(row.succeeded_count),
      failed: Number(row.failed_count),
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function selectJob(client: Pool | PoolClient, id: string): Promise<JobRow | null> {
  const result = await client.query<JobRow>(`${JOB_SELECT}
    WHERE job.id = $1
    GROUP BY job.id
  `, [id]);
  return result.rows[0] ?? null;
}

export class PostgresJobRepository implements JobRepository {
  public constructor(private readonly pool: Pool) {}

  public static fromConnectionString(connectionString: string): PostgresJobRepository {
    return new PostgresJobRepository(new Pool({ connectionString, max: 10 }));
  }

  public async checkReadiness(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  public async createSource(input: CreateSourceInput): Promise<SourceDocument> {
    const result = await this.pool.query<SourceRow>(`
      INSERT INTO source_documents (title, storage_uri, content_sha256)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_sha256) DO UPDATE
      SET content_sha256 = EXCLUDED.content_sha256
      RETURNING id, title, storage_uri, content_sha256, created_at
    `, [input.title, input.storageUri, input.contentSha256]);
    return mapSource(result.rows[0]!);
  }

  public async createJob(input: CreateJobInput): Promise<CreatedJob> {
    const client = await this.pool.connect();
    const requestFingerprint = fingerprint(input);

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.idempotencyKey,
      ]);

      const existing = await client.query<JobRow>(`${JOB_SELECT}
        WHERE job.idempotency_key = $1
        GROUP BY job.id
      `, [input.idempotencyKey]);

      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== requestFingerprint) {
          throw new IdempotencyConflictError(
            "Idempotency-Key was already used for a different job request",
          );
        }
        await client.query("COMMIT");
        return { job: mapJob(existing.rows[0]), replayed: true };
      }

      const source = await client.query("SELECT id FROM source_documents WHERE id = $1", [
        input.sourceDocumentId,
      ]);
      if (source.rowCount === 0) {
        throw new NotFoundError("Source document not found");
      }

      const inserted = await client.query<{ id: string }>(`
        INSERT INTO generation_jobs (
          source_document_id,
          idempotency_key,
          request_fingerprint,
          requested_count,
          prompt_version
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        input.sourceDocumentId,
        input.idempotencyKey,
        requestFingerprint,
        input.requestedCount,
        input.promptVersion,
      ]);
      const jobId = inserted.rows[0]!.id;

      const levels = Array.from(
        { length: input.requestedCount },
        (_, index) => input.targetBlooms[index % input.targetBlooms.length]!,
      );
      await client.query(`
        INSERT INTO job_items (job_id, ordinal, target_bloom)
        SELECT $1, item.ordinality, item.target_bloom::bloom_level
        FROM unnest($2::text[]) WITH ORDINALITY AS item(target_bloom, ordinality)
      `, [jobId, levels]);

      await client.query(`
        INSERT INTO outbox_events (
          aggregate_type,
          aggregate_id,
          event_type,
          payload
        )
        VALUES ('generation_job', $1, 'generation_job.created', $2::jsonb)
      `, [jobId, JSON.stringify({ jobId, itemCount: input.requestedCount })]);

      const job = await selectJob(client, jobId);
      await client.query("COMMIT");
      return { job: mapJob(job!), replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getJob(id: string): Promise<Job | null> {
    const job = await selectJob(this.pool, id);
    return job ? mapJob(job) : null;
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
