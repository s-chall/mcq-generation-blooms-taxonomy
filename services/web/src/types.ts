export const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];
export type ReviewDecision = "APPROVED" | "REJECTED" | "NEEDS_EDIT";

export interface SourceDocument {
  id: string;
  title: string;
  storageUri: string;
  contentSha256: string;
  createdAt: string;
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

export interface HumanReview {
  reviewerId: string;
  decision: ReviewDecision;
  assignedBloom: BloomLevel | null;
  notes: string | null;
  updatedAt: string;
}

export interface Question {
  id: string;
  jobId: string;
  ordinal: number;
  targetBloom: BloomLevel;
  stem: string;
  correctAnswer: string;
  distractors: [string, string, string];
  modelName: string;
  promptVersion: string;
  createdAt: string;
  review: HumanReview | null;
}

export interface ReviewQuestionInput {
  reviewerId: string;
  decision: ReviewDecision;
  assignedBloom: BloomLevel | null;
  notes: string | null;
}
