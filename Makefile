PYTHON ?= python3

.PHONY: setup test validate analyze verify api-test api-integration-test db-test worker-test worker-integration-test verify-all

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

api-test:
	npm test

api-integration-test:
	./scripts/test_api_integration.sh

worker-test:
	uv run --frozen python -m unittest worker_tests.service_test -v

worker-integration-test:
	./scripts/test_worker_integration.sh

verify-all: verify api-test worker-test db-test api-integration-test worker-integration-test
