#!/bin/sh
set -eu

project_name=blooms-taxonomy-application-test
export BLOOMS_WEB_PORT=${BLOOMS_WEB_PORT:-18080}

cleanup() {
    docker compose --project-name "$project_name" --profile application \
        down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose --project-name "$project_name" --profile application \
    up --detach --wait --build postgres
docker compose --project-name "$project_name" --profile tools \
    run --rm --no-TTY migrate
docker compose --project-name "$project_name" --profile application \
    up --detach --wait --build api web

curl --fail --silent --show-error "http://127.0.0.1:${BLOOMS_WEB_PORT}/" \
    | grep --quiet "Bloom Lab"
test "$(curl --fail --silent --show-error \
    "http://127.0.0.1:${BLOOMS_WEB_PORT}/api/health/ready")" = '{"status":"ready"}'
