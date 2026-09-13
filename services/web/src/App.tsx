import { useMemo, useState, type FormEvent } from "react";

import { HttpResearchApi, type ResearchApi } from "./api";
import {
  BLOOM_LEVELS,
  type BloomLevel,
  type Job,
  type Question,
  type ReviewDecision,
} from "./types";

interface AppProps {
  api?: ResearchApi;
}

interface ReviewCardProps {
  api: ResearchApi;
  question: Question;
  reviewerId: string;
  onSaved: (question: Question) => void;
}

function statusLabel(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

function ReviewCard({ api, question, reviewerId, onSaved }: ReviewCardProps) {
  const [decision, setDecision] = useState<ReviewDecision>(
    question.review?.decision ?? "NEEDS_EDIT",
  );
  const [assignedBloom, setAssignedBloom] = useState<BloomLevel>(
    question.review?.assignedBloom ?? question.targetBloom,
  );
  const [notes, setNotes] = useState(question.review?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const review = await api.reviewQuestion(question.id, {
        reviewerId,
        decision,
        assignedBloom,
        notes: notes.trim() || null,
      });
      onSaved({ ...question, review });
      setMessage("Review saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save review");
    } finally {
      setSaving(false);
    }
  }

  const choices = [question.correctAnswer, ...question.distractors];
  return (
    <article className="question-card">
      <div className="question-card__header">
        <span className="question-number">Question {question.ordinal}</span>
        <span className="bloom-badge">{question.targetBloom}</span>
      </div>
      <h3>{question.stem}</h3>
      <ol className="answers" type="A">
        {choices.map((choice, index) => (
          <li className={index === 0 ? "correct-answer" : ""} key={choice}>
            {choice}
            {index === 0 && <span>Correct</span>}
          </li>
        ))}
      </ol>
      <form className="review-form" onSubmit={saveReview}>
        <label>
          Decision
          <select
            aria-label={`Decision for question ${question.ordinal}`}
            value={decision}
            onChange={(event) => setDecision(event.target.value as ReviewDecision)}
          >
            <option value="APPROVED">Approve</option>
            <option value="NEEDS_EDIT">Needs edit</option>
            <option value="REJECTED">Reject</option>
          </select>
        </label>
        <label>
          Assigned Bloom level
          <select
            aria-label={`Assigned Bloom level for question ${question.ordinal}`}
            value={assignedBloom}
            onChange={(event) => setAssignedBloom(event.target.value as BloomLevel)}
          >
            {BLOOM_LEVELS.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="review-notes">
          Review notes
          <textarea
            aria-label={`Review notes for question ${question.ordinal}`}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Explain edits or rejection criteria"
          />
        </label>
        <div className="review-actions">
          <button className="button button--secondary" disabled={saving} type="submit">
            {saving ? "Saving…" : "Save review"}
          </button>
          <span className="save-message" role="status">{message}</span>
        </div>
      </form>
    </article>
  );
}

export default function App({ api = new HttpResearchApi() }: AppProps) {
  const [reviewerId, setReviewerId] = useState("researcher-demo");
  const [sourceTitle, setSourceTitle] = useState("");
  const [storageUri, setStorageUri] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [requestedCount, setRequestedCount] = useState(3);
  const [selectedBlooms, setSelectedBlooms] = useState<BloomLevel[]>([
    "Remember",
    "Understand",
    "Apply",
  ]);
  const [job, setJob] = useState<Job | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const approvedCount = useMemo(
    () => questions.filter((question) => question.review?.decision === "APPROVED").length,
    [questions],
  );

  function toggleBloom(level: BloomLevel) {
    setSelectedBlooms((current) =>
      current.includes(level)
        ? current.filter((value) => value !== level)
        : [...current, level],
    );
  }

  async function submitBatch(event: FormEvent) {
    event.preventDefault();
    if (!sourceFile || selectedBlooms.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const source = await api.createSource({
        title: sourceTitle,
        storageUri,
        file: sourceFile,
      });
      const created = await api.createJob({
        sourceDocumentId: source.id,
        requestedCount,
        promptVersion: "researcher-portal-v1",
        targetBlooms: selectedBlooms,
      });
      setJob(created);
      setQuestions([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit the batch");
    } finally {
      setBusy(false);
    }
  }

  async function refreshJob() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const [updatedJob, updatedQuestions] = await Promise.all([
        api.getJob(job.id),
        api.listQuestions(job.id, reviewerId),
      ]);
      setJob(updatedJob);
      setQuestions(updatedQuestions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh the batch");
    } finally {
      setBusy(false);
    }
  }

  function resetBatch() {
    setJob(null);
    setQuestions([]);
    setError("");
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bloom Lab home">
          <span className="brand-mark">B</span>
          <span>Bloom Lab</span>
        </a>
        <div className="researcher-pill">
          <span>Reviewer</span>
          <strong>{reviewerId || "Not set"}</strong>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Question generation workspace</p>
          <h1>From source material to reviewed question bank.</h1>
          <p className="hero-copy">
            Configure a Bloom-aligned batch, follow generation progress, and export only the
            questions a researcher has approved.
          </p>
        </div>
        <div className="hero-stat">
          <strong>{job ? job.requestedCount : "01"}</strong>
          <span>{job ? "items in this batch" : "guided workflow"}</span>
        </div>
      </section>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {!job ? (
        <section className="workspace-card">
          <div className="section-heading">
            <span className="step-number">01</span>
            <div>
              <p className="eyebrow">Create a batch</p>
              <h2>Source and learning targets</h2>
            </div>
          </div>
          <form className="batch-form" onSubmit={submitBatch}>
            <div className="form-grid">
              <label htmlFor="reviewer-id">
                Reviewer ID
                <input
                  id="reviewer-id"
                  required
                  maxLength={100}
                  value={reviewerId}
                  onChange={(event) => setReviewerId(event.target.value)}
                  placeholder="faculty-name"
                />
              </label>
              <label htmlFor="source-title">
                Source title
                <input
                  id="source-title"
                  required
                  maxLength={300}
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder="Atomic structure notes"
                />
              </label>
              <div className="field form-grid__wide">
                <label htmlFor="storage-uri">Existing source location</label>
                <input
                  id="storage-uri"
                  aria-describedby="storage-uri-help"
                  required
                  maxLength={2000}
                  value={storageUri}
                  onChange={(event) => setStorageUri(event.target.value)}
                  placeholder="s3://course-materials/unit-01.pdf"
                />
                <small id="storage-uri-help">The source stays in your configured storage; this portal records its location.</small>
              </div>
              <div className="field file-field form-grid__wide">
                <label htmlFor="source-file">Source file for fingerprinting</label>
                <input
                  id="source-file"
                  aria-describedby="source-file-help"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSourceFile(file);
                    if (file && !sourceTitle) setSourceTitle(file.name);
                  }}
                />
                <small id="source-file-help">The browser calculates SHA-256 locally; it does not upload the file bytes.</small>
              </div>
              <label htmlFor="question-count">
                Question count
                <input
                  id="question-count"
                  required
                  type="number"
                  min={1}
                  max={100}
                  value={requestedCount}
                  onChange={(event) => setRequestedCount(Number(event.target.value))}
                />
              </label>
            </div>

            <fieldset>
              <legend>Target Bloom levels</legend>
              <div className="bloom-options">
                {BLOOM_LEVELS.map((level) => (
                  <label className={selectedBlooms.includes(level) ? "selected" : ""} key={level}>
                    <input
                      type="checkbox"
                      checked={selectedBlooms.includes(level)}
                      onChange={() => toggleBloom(level)}
                    />
                    <span>{level}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              className="button button--primary"
              disabled={busy || !sourceFile || selectedBlooms.length === 0}
              type="submit"
            >
              {busy ? "Submitting…" : "Submit generation batch"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="workspace-card status-panel">
            <div className="section-heading">
              <span className="step-number">02</span>
              <div>
                <p className="eyebrow">Monitor the batch</p>
                <h2>Job {job.id.slice(0, 8)}</h2>
              </div>
              <span className={`status status--${job.status.toLowerCase()}`}>
                {statusLabel(job.status)}
              </span>
            </div>
            <div className="status-grid">
              {(["queued", "running", "retry", "succeeded", "failed"] as const).map((status) => (
                <div key={status}>
                  <strong>{job.itemCounts[status] ?? 0}</strong>
                  <span>{statusLabel(status)}</span>
                </div>
              ))}
            </div>
            <div className="panel-actions">
              <button className="button button--primary" disabled={busy} onClick={refreshJob}>
                {busy ? "Refreshing…" : "Refresh progress"}
              </button>
              <button className="button button--ghost" onClick={resetBatch}>New batch</button>
            </div>
          </section>

          <section className="review-section">
            <div className="section-heading">
              <span className="step-number">03</span>
              <div>
                <p className="eyebrow">Human review</p>
                <h2>{questions.length ? `${questions.length} generated questions` : "Waiting for output"}</h2>
              </div>
              {questions.length > 0 && (
                <div className="approval-summary">
                  <strong>{approvedCount}</strong>
                  <span>approved</span>
                </div>
              )}
            </div>

            {questions.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state__mark">⌁</span>
                <h3>No questions are ready yet.</h3>
                <p>Refresh progress after a worker completes at least one item.</p>
              </div>
            ) : (
              <div className="question-list">
                {questions.map((question) => (
                  <ReviewCard
                    api={api}
                    key={`${question.id}-${question.review?.updatedAt ?? "new"}`}
                    question={question}
                    reviewerId={reviewerId}
                    onSaved={(updated) =>
                      setQuestions((current) =>
                        current.map((item) => (item.id === updated.id ? updated : item)),
                      )
                    }
                  />
                ))}
              </div>
            )}

            {approvedCount > 0 && (
              <a className="button button--export" href={api.exportUrl(job.id, reviewerId)}>
                Export {approvedCount} approved {approvedCount === 1 ? "question" : "questions"} as CSV
              </a>
            )}
          </section>
        </>
      )}
    </main>
  );
}
