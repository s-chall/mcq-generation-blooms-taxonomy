#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

psql --set=ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
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
        psql --tuples-only --no-align "$DATABASE_URL" \
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
    } | psql --set=ON_ERROR_STOP=1 "$DATABASE_URL"
done
