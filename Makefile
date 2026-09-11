PYTHON ?= python3

.PHONY: setup test validate analyze verify db-test verify-all

setup:
	uv sync --frozen

test:
	$(PYTHON) -m unittest discover -s tests -v

validate:
	$(PYTHON) -m blooms_analysis validate data/demo_questions.csv

analyze:
	$(PYTHON) -m blooms_analysis summarize data/demo_questions.csv

verify: test validate analyze

db-test:
	./scripts/test_database.sh

verify-all: verify db-test
