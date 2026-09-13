import type {
  BloomLevel,
  HumanReview,
  Job,
  Question,
  ReviewQuestionInput,
  SourceDocument,
} from "./types";

export interface CreateSourceFromFileInput {
  title: string;
  storageUri: string;
  file: File;
}

export interface CreateJobInput {
  sourceDocumentId: string;
  requestedCount: number;
  promptVersion: string;
  targetBlooms: BloomLevel[];
}

export interface ResearchApi {
  createSource(input: CreateSourceFromFileInput): Promise<SourceDocument>;
  createJob(input: CreateJobInput): Promise<Job>;
  getJob(id: string): Promise<Job>;
  listQuestions(jobId: string, reviewerId: string): Promise<Question[]>;
  reviewQuestion(questionId: string, input: ReviewQuestionInput): Promise<HumanReview>;
  exportUrl(jobId: string, reviewerId: string): string;
}

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class HttpResearchApi implements ResearchApi {
  public constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api") {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  public async createSource(input: CreateSourceFromFileInput): Promise<SourceDocument> {
    return this.request<SourceDocument>("/v1/sources", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        storageUri: input.storageUri,
        contentSha256: await sha256(input.file),
      }),
    });
  }

  public async createJob(input: CreateJobInput): Promise<Job> {
    return this.request<Job>("/v1/jobs", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
  }

  public async getJob(id: string): Promise<Job> {
    return this.request<Job>(`/v1/jobs/${encodeURIComponent(id)}`);
  }

  public async listQuestions(jobId: string, reviewerId: string): Promise<Question[]> {
    return this.request<Question[]>(
      `/v1/jobs/${encodeURIComponent(jobId)}/questions?reviewerId=${encodeURIComponent(reviewerId)}`,
    );
  }

  public async reviewQuestion(
    questionId: string,
    input: ReviewQuestionInput,
  ): Promise<HumanReview> {
    return this.request<HumanReview>(`/v1/questions/${encodeURIComponent(questionId)}/review`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  public exportUrl(jobId: string, reviewerId: string): string {
    return `${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/export.csv?reviewerId=${encodeURIComponent(reviewerId)}`;
  }
}
