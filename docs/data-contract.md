# Public MCQ data contract

The runnable public sample uses UTF-8 CSV with one header row and one question per
subsequent row. It is intentionally small and illustrative; it is not the full
research dataset used to calculate the paper's reported metrics.

## Required question fields

| Field | Meaning |
| --- | --- |
| `question` | Non-empty MCQ stem. |
| `correct_answer` | The single correct answer. |
| `distractor1`–`distractor3` | Three incorrect answers. All four choices must be unique after case normalization. |
| `gpt_taxonomy` | Bloom level requested during generation. |
| `classified_taxonomy` | Bloom level assigned by the automated evaluator. |
| `shot_num` | Non-negative number of examples supplied to the generator. |

Taxonomy values use the revised labels `Remember`, `Understand`, `Apply`,
`Analyze`, `Evaluate`, and `Create`.

## Item-writing-guideline fields

Additional columns are interpreted as boolean item-writing-guideline checks.
`TRUE` means the question passed the named check and `FALSE` means it failed.
Values must be explicit uppercase `TRUE` or `FALSE` strings so their meaning is
stable across CSV readers.

## Public datasets

- `demo_questions.csv` is a hand-authored, valid fixture for setup verification,
  documentation, and automated tests.
- `sample_generated_questions.csv` is the original repository sample. It is kept
  unchanged for provenance. The validator identifies that its correct answers are
  duplicated in the `distractor1` column, so it must not be presented as a valid
  production fixture.

Human usability ratings and the full set of 19 IWF outputs used in the publication
are not currently public. Analyses that require those fields cannot be reproduced
from this repository and should not silently substitute invented data.
