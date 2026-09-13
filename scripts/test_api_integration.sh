#!/bin/sh
set -eu

project_name=blooms-taxonomy-api-test
database_url=postgresql://blooms:blooms-local-only@localhost:${BLOOMS_POSTGRES_PORT:-54329}/blooms

cleanup() {
    docker compose --project-name "$project_name" --profile tools \
        down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose --project-name "$project_name" --profile tools \
    up --detach --wait postgres
docker compose --project-name "$project_name" --profile tools \
    run --rm --no-TTY migrate
DATABASE_URL="$database_url" npm run test:api:integration
