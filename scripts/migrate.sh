#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
    : "${PGHOST:?PGHOST must be set when DATABASE_URL is absent}"
    : "${PGPORT:?PGPORT must be set when DATABASE_URL is absent}"
    : "${PGDATABASE:?PGDATABASE must be set when DATABASE_URL is absent}"
    : "${PGUSER:?PGUSER must be set when DATABASE_URL is absent}"
    : "${PGPASSWORD:?PGPASSWORD must be set when DATABASE_URL is absent}"
fi

run_psql() {
    if [ -n "${DATABASE_URL:-}" ]; then
        psql "$@" "$DATABASE_URL"
    else
        psql "$@"
    fi
}

run_psql --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in db/migrations/*.sql; do
    version=$(basename "$migration")
    case "$version" in
        [0-9][0-9][0-9]_[a-z0-9_]*.sql) ;;
        *)
            echo "Invalid migration filename: $version" >&2
            exit 1
            ;;
    esac

    applied=$(
        run_psql --tuples-only --no-align \
            --command="SELECT 1 FROM schema_migrations WHERE version = '$version'"
    )
    if [ "$applied" = "1" ]; then
        echo "Skipping already-applied migration $version"
        continue
    fi

    echo "Applying migration $version"
    {
        printf 'BEGIN;\n'
        sed -e '$a\' "$migration"
        printf "INSERT INTO schema_migrations (version) VALUES ('%s');\n" "$version"
        printf 'COMMIT;\n'
    } | run_psql --set=ON_ERROR_STOP=1
done
