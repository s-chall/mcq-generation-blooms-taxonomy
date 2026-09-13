import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import type { CreateJobInput, CreateSourceFromFileInput, ResearchApi } from "./api";
import type { HumanReview, Job, Question, ReviewQuestionInput, SourceDocument } from "./types";

const source: SourceDocument = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Cell signaling",
  storageUri: "s3://course/cell-signaling.pdf",
  contentSha256: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
};

const queuedJob: Job = {
  id: "00000000-0000-4000-8000-000000000002",
  sourceDocumentId: source.id,
  requestedCount: 3,
  promptVersion: "researcher-portal-v1",
  status: "QUEUED",
  itemCounts: { queued: 3, running: 0, retry: 0, succeeded: 0, failed: 0 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const completedJob: Job = {
  ...queuedJob,
  status: "SUCCEEDED",
  itemCounts: { queued: 0, running: 0, retry: 0, succeeded: 3, failed: 0 },
};

const question: Question = {
  id: "00000000-0000-4000-8000-000000000003",
  jobId: queuedJob.id,
  ordinal: 1,
  targetBloom: "Apply",
  stem: "Which response applies receptor signaling to a new scenario?",
  correctAnswer: "Trace the pathway from ligand binding to the cellular response",
  distractors: [
    "Name the receptor",
    "Repeat the pathway definition",
    "List unrelated organelles",
  ],
  modelName: "integration-provider",
  promptVersion: "researcher-portal-v1",
  createdAt: "2026-01-01T00:01:00.000Z",
  review: null,
};

class FakeApi implements ResearchApi {
  public createSource = vi.fn(async (_input: CreateSourceFromFileInput) => source);
  public createJob = vi.fn(async (_input: CreateJobInput) => queuedJob);
  public getJob = vi.fn(async (_id: string) => completedJob);
  public listQuestions = vi.fn(async (_jobId: string, _reviewerId: string) => [question]);
  public reviewQuestion = vi.fn(
    async (_questionId: string, input: ReviewQuestionInput): Promise<HumanReview> => ({
      ...input,
      updatedAt: "2026-01-01T00:02:00.000Z",
    }),
  );
  public exportUrl(jobId: string, reviewerId: string): string {
    return `/api/v1/jobs/${jobId}/export.csv?reviewerId=${reviewerId}`;
  }
}

describe("researcher workflow", () => {
  it("submits a batch, monitors output, saves a review, and enables export", async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.clear(screen.getByLabelText("Reviewer ID"));
    await user.type(screen.getByLabelText("Reviewer ID"), "faculty-1");
    await user.type(screen.getByLabelText("Source title"), "Cell signaling");
    await user.type(
      screen.getByLabelText("Existing source location"),
      "s3://course/cell-signaling.pdf",
    );
    await user.upload(
      screen.getByLabelText("Source file for fingerprinting"),
      new File(["cell signaling notes"], "cell-signaling.pdf", {
        type: "application/pdf",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Submit generation batch" }));

    expect(await screen.findByText(/Job 00000000/)).toBeInTheDocument();
    expect(api.createSource).toHaveBeenCalledOnce();
    expect(api.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: 3,
        targetBlooms: ["Remember", "Understand", "Apply"],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Refresh progress" }));
    expect(await screen.findByText(question.stem)).toBeInTheDocument();
    expect(screen.getAllByText("succeeded")).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText("Decision for question 1"), "APPROVED");
    await user.type(
      screen.getByLabelText("Review notes for question 1"),
      "Ready for the item bank",
    );
    await user.click(screen.getByRole("button", { name: "Save review" }));

    await waitFor(() => expect(api.reviewQuestion).toHaveBeenCalledOnce());
    expect(api.reviewQuestion).toHaveBeenCalledWith(
      question.id,
      expect.objectContaining({
        reviewerId: "faculty-1",
        decision: "APPROVED",
        assignedBloom: "Apply",
      }),
    );
    const exportLink = await screen.findByRole("link", {
      name: "Export 1 approved question as CSV",
    });
    expect(exportLink).toHaveAttribute(
      "href",
      `/api/v1/jobs/${queuedJob.id}/export.csv?reviewerId=faculty-1`,
    );
  });

  it("keeps the batch form visible when submission fails", async () => {
    const api = new FakeApi();
    api.createSource.mockRejectedValueOnce(new Error("Source registration failed"));
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.type(screen.getByLabelText("Source title"), "Cell signaling");
    await user.type(screen.getByLabelText("Existing source location"), "s3://course/source.pdf");
    await user.upload(
      screen.getByLabelText("Source file for fingerprinting"),
      new File(["notes"], "source.pdf"),
    );
    await user.click(screen.getByRole("button", { name: "Submit generation batch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Source registration failed");
    expect(screen.getByRole("button", { name: "Submit generation batch" })).toBeInTheDocument();
  });
});
