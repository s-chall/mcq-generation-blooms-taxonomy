from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from typing import Iterable, Mapping

BLOOM_LEVELS = (
    "Remember",
    "Understand",
    "Apply",
    "Analyze",
    "Evaluate",
    "Create",
)

REQUIRED_COLUMNS = (
    "question",
    "correct_answer",
    "distractor1",
    "distractor2",
    "distractor3",
    "gpt_taxonomy",
    "classified_taxonomy",
    "shot_num",
)

BOOLEAN_VALUES = {"TRUE", "FALSE"}


class DataValidationError(ValueError):
    """Raised when a CSV does not satisfy the public data contract."""


def load_questions(path: str | Path) -> tuple[list[dict[str, str]], tuple[str, ...]]:
    csv_path = Path(path)
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise DataValidationError(f"{csv_path} has no header row")
        rows = [dict(row) for row in reader]
        return rows, tuple(reader.fieldnames)


def validate_questions(
    rows: Iterable[Mapping[str, str]], fieldnames: Iterable[str]
) -> list[str]:
    columns = set(fieldnames)
    errors: list[str] = []
    missing = sorted(set(REQUIRED_COLUMNS) - columns)
    if missing:
        errors.append(f"missing required columns: {', '.join(missing)}")
        return errors

    boolean_columns = sorted(
        columns
        - set(REQUIRED_COLUMNS)
        - {"", "question_id", "source", "notes"}
    )

    for row_number, row in enumerate(rows, start=2):
        question = (row.get("question") or "").strip()
        if not question:
            errors.append(f"row {row_number}: question must not be empty")

        options = [
            (row.get("correct_answer") or "").strip(),
            (row.get("distractor1") or "").strip(),
            (row.get("distractor2") or "").strip(),
            (row.get("distractor3") or "").strip(),
        ]
        if any(not option for option in options):
            errors.append(f"row {row_number}: all four answer choices are required")
        normalized_options = {option.casefold() for option in options}
        if len(normalized_options) != 4:
            errors.append(f"row {row_number}: answer choices must be unique")

        for column in ("gpt_taxonomy", "classified_taxonomy"):
            value = (row.get(column) or "").strip()
            if value not in BLOOM_LEVELS:
                errors.append(
                    f"row {row_number}: {column} must be one of "
                    f"{', '.join(BLOOM_LEVELS)}"
                )

        try:
            shot_num = int((row.get("shot_num") or "").strip())
            if shot_num < 0:
                raise ValueError
        except ValueError:
            errors.append(f"row {row_number}: shot_num must be a non-negative integer")

        for column in boolean_columns:
            value = (row.get(column) or "").strip().upper()
            if value not in BOOLEAN_VALUES:
                errors.append(
                    f"row {row_number}: {column} must be TRUE or FALSE, got {value!r}"
                )

    return errors


def summarize(
    rows: Iterable[Mapping[str, str]], fieldnames: Iterable[str]
) -> dict[str, object]:
    row_list = list(rows)
    columns = set(fieldnames)
    target_counts = Counter(row["gpt_taxonomy"] for row in row_list)
    predicted_counts = Counter(row["classified_taxonomy"] for row in row_list)
    aligned = sum(
        row["gpt_taxonomy"] == row["classified_taxonomy"] for row in row_list
    )
    boolean_columns = sorted(
        columns
        - set(REQUIRED_COLUMNS)
        - {"", "question_id", "source", "notes"}
    )
    guideline_pass_rates = {
        column: (
            sum((row.get(column) or "").upper() == "TRUE" for row in row_list)
            / len(row_list)
            if row_list
            else 0.0
        )
        for column in boolean_columns
    }
    return {
        "row_count": len(row_list),
        "aligned_count": aligned,
        "alignment_rate": aligned / len(row_list) if row_list else 0.0,
        "target_counts": {
            level: target_counts[level] for level in BLOOM_LEVELS if target_counts[level]
        },
        "predicted_counts": {
            level: predicted_counts[level]
            for level in BLOOM_LEVELS
            if predicted_counts[level]
        },
        "guideline_pass_rates": guideline_pass_rates,
    }
