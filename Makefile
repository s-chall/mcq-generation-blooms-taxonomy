PYTHON ?= python3

.PHONY: setup test validate analyze verify

setup:
	uv sync --frozen

test:
	$(PYTHON) -m unittest discover -s tests -v

validate:
	$(PYTHON) -m blooms_analysis validate data/demo_questions.csv

analyze:
	$(PYTHON) -m blooms_analysis summarize data/demo_questions.csv

verify: test validate analyze
