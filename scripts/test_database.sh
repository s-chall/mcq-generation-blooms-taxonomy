#!/bin/sh
set -eu

project_name=blooms-taxonomy-db-test

cleanup() {
    docker compose --project-name "$project_name" --profile tools \
        down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose --project-name "$project_name" --profile tools \
    up --detach --wait postgres
docker compose --project-name "$project_name" --profile tools \
    run --rm --no-TTY migrate
docker compose --project-name "$project_name" --profile tools \
    run --rm --no-TTY migrate
docker compose --project-name "$project_name" --profile tools \
    run --rm --no-TTY db-test
