from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from blooms_analysis import load_questions, summarize, validate_questions


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class DataValidationTests(unittest.TestCase):
    def test_demo_dataset_satisfies_contract(self) -> None:
        rows, fieldnames = load_questions(
            REPOSITORY_ROOT / "data" / "demo_questions.csv"
        )

        self.assertEqual(validate_questions(rows, fieldnames), [])
        self.assertEqual(summarize(rows, fieldnames)["row_count"], 6)
        self.assertEqual(summarize(rows, fieldnames)["alignment_rate"], 1.0)

    def test_legacy_sample_exposes_duplicate_answer_defect(self) -> None:
        rows, fieldnames = load_questions(
            REPOSITORY_ROOT / "data" / "sample_generated_questions.csv"
        )

        errors = validate_questions(rows, fieldnames)
        duplicate_errors = [
            error for error in errors if "answer choices must be unique" in error
        ]
        self.assertEqual(len(duplicate_errors), 8)

    def test_missing_required_column_is_reported(self) -> None:
        with TemporaryDirectory() as directory:
            csv_path = Path(directory) / "invalid.csv"
            csv_path.write_text("question,correct_answer\nWhat?,Answer\n")
            rows, fieldnames = load_questions(csv_path)

        errors = validate_questions(rows, fieldnames)

        self.assertEqual(len(errors), 1)
        self.assertIn("missing required columns", errors[0])
        self.assertIn("distractor1", errors[0])

    def test_invalid_bloom_level_is_reported(self) -> None:
        rows, fieldnames = load_questions(
            REPOSITORY_ROOT / "data" / "demo_questions.csv"
        )
        rows[0]["classified_taxonomy"] = "Advanced"

        errors = validate_questions(rows, fieldnames)

        self.assertTrue(
            any("classified_taxonomy must be one of" in error for error in errors)
        )


if __name__ == "__main__":
    unittest.main()
