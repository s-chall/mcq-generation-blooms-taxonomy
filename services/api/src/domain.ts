export const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export interface SourceDocument {
  id: string;
  title: string;
  storageUri: string;
  contentSha256: string;
  createdAt: string;
}

export interface CreateSourceInput {
  title: string;
  storageUri: string;
  contentSha256: string;
}

export interface CreateJobInput {
  idempotencyKey: string;
  sourceDocumentId: string;
  requestedCount: number;
  promptVersion: string;
  targetBlooms: BloomLevel[];
}

export interface Job {
  id: string;
  sourceDocumentId: string;
  requestedCount: number;
  promptVersion: string;
  status: string;
  itemCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedJob {
  job: Job;
  replayed: boolean;
}

export interface JobRepository {
  checkReadiness(): Promise<void>;
  createSource(input: CreateSourceInput): Promise<SourceDocument>;
  createJob(input: CreateJobInput): Promise<CreatedJob>;
  getJob(id: string): Promise<Job | null>;
  close(): Promise<void>;
}
