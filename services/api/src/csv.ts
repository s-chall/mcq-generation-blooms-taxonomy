import type { Question } from "./domain.js";

function cell(value: string | number): string {
  const normalized = String(value);
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

export function approvedQuestionsCsv(questions: Question[]): string {
  const rows: Array<Array<string | number>> = [
    [
      "ordinal",
      "target_bloom",
      "assigned_bloom",
      "stem",
      "correct_answer",
      "distractor_1",
      "distractor_2",
      "distractor_3",
      "reviewer_id",
      "review_notes",
    ],
  ];

  for (const question of questions) {
    if (question.review?.decision !== "APPROVED") continue;
    rows.push([
      question.ordinal,
      question.targetBloom,
      question.review.assignedBloom ?? "",
      question.stem,
      question.correctAnswer,
      ...question.distractors,
      question.review.reviewerId,
      question.review.notes ?? "",
    ]);
  }

  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
