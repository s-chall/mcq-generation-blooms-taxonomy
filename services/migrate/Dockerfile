FROM postgres:17.6-bookworm

WORKDIR /workspace
COPY --chown=postgres:postgres db/migrations db/migrations
COPY --chown=postgres:postgres scripts/migrate.sh scripts/migrate.sh

USER postgres
CMD ["sh", "scripts/migrate.sh"]
