from __future__ import annotations

import argparse
import json
from pathlib import Path

from .data import load_questions, summarize, validate_questions


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate or summarize a Bloom-aligned MCQ CSV."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "summarize"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("csv_path", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    rows, fieldnames = load_questions(args.csv_path)
    errors = validate_questions(rows, fieldnames)
    if errors:
        for error in errors:
            print(error)
        return 1

    if args.command == "validate":
        print(f"Validated {len(rows)} questions in {args.csv_path}")
    else:
        print(json.dumps(summarize(rows, fieldnames), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
