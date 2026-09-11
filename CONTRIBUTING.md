# Contributing

All changes should be developed on a focused branch and merged through a pull
request. Keep each pull request small enough that its behavior and evidence can be
reviewed independently.

## Before opening a pull request

1. Run `make verify` from the repository root.
2. Update documentation when behavior or the architecture boundary changes.
3. Add a test for every business rule or corrected defect.
4. Update `docs/resume-evidence.md` only when working code and passing tests support
   a claim.

Do not describe planned components as implemented. Pull-request descriptions
should distinguish unit tests, integration tests, and manually verified behavior.
