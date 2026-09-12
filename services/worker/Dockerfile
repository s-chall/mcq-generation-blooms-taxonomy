FROM python:3.13.7-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH
WORKDIR /app

RUN pip install --no-cache-dir uv==0.11.33 \
    && useradd --create-home --uid 10001 app

COPY --chown=app:app pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev

COPY --chown=app:app generation_worker generation_worker

USER app
CMD ["python", "-m", "generation_worker", "worker"]
