import assert from "node:assert/strict";
import { test } from "node:test";

import { databasePoolConfig } from "../src/postgres-repository.js";

test("database configuration prefers a complete connection URL", () => {
  assert.deepEqual(databasePoolConfig({ DATABASE_URL: "postgresql://example/database" }), {
    connectionString: "postgresql://example/database",
    max: 10,
  });
});

test("database configuration accepts secret-backed PostgreSQL fields", () => {
  assert.deepEqual(databasePoolConfig({
    PGHOST: "database.internal",
    PGPORT: "5432",
    PGDATABASE: "blooms",
    PGUSER: "blooms_app",
    PGPASSWORD: "generated-secret",
    PGSSLMODE: "require",
  }), {
    host: "database.internal",
    port: 5432,
    database: "blooms",
    user: "blooms_app",
    password: "generated-secret",
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
});

test("database configuration rejects incomplete cloud credentials", () => {
  assert.throws(
    () => databasePoolConfig({ PGHOST: "database.internal" }),
    /PGPORT must be set/,
  );
});
