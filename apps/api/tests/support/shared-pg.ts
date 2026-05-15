// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.2 / Plan 02 / Task 02-02 — shared Postgres testcontainer fixture.
//
// D-03 — memoised `withReuse()` PostgreSqlContainer at module scope. Plans
// 03 + 05 import `getSharedPostgres` from `beforeAll` blocks to replace the
// per-file PostgreSqlContainer boot pattern (one container per test file),
// collapsing N→1 containers and eliminating the port-exhaustion + Ryuk
// reaper failure modes documented in Phase 18.1.2 RESEARCH §2.
//
// Pairs with `TESTCONTAINERS_REUSE_ENABLE=true` in vitest.setup.ts (pitfall
// §1: env MUST be set before any testcontainer module loads). `withReuse()`
// keys on the (image, database, username, password) tuple → a second caller
// inside or across vitest workers attaches to the existing container.
//
// pitfall §2 — Postgres 17 has no `CREATE ROLE IF NOT EXISTS`; the
// `bootstrapSharedRoles` helper wraps role creation in `DO $$ … EXCEPTION
// WHEN duplicate_object THEN NULL` so consecutive test files reusing the
// container do not crash on the second pass.
//
// D-02 — when Plan 01's docker probe sets OPENWHISPR_SKIP_TESTCONTAINERS=1
// the fixture rejects fast so callers can `describe.skip` from beforeAll
// without paying the Docker connection-attempt timeout.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";

let cached: Promise<StartedPostgreSqlContainer> | null = null;

/**
 * Lazily start (or attach to, via `withReuse()`) a Postgres 17-alpine
 * testcontainer with the canonical openwhispr bootstrap credentials.
 *
 * Module-scope memoisation collapses N concurrent callers within the same
 * vitest worker to a single container start; `withReuse()` collapses across
 * workers via the testcontainers daemon-side label hash.
 *
 * Throws synchronously (well, rejects within one microtask) when
 * `OPENWHISPR_SKIP_TESTCONTAINERS=1` so test suites can short-circuit
 * before paying the Docker round-trip.
 */
export async function getSharedPostgres(): Promise<StartedPostgreSqlContainer> {
  if (process.env.OPENWHISPR_SKIP_TESTCONTAINERS === "1") {
    throw new Error(
      "shared-pg disabled — OPENWHISPR_SKIP_TESTCONTAINERS=1 (Plan 01 docker probe set the flag)",
    );
  }
  cached ??= new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .withReuse()
    .start();
  return cached;
}

/**
 * Idempotently create the two constitutional roles + grant the parameter
 * privileges migrations 0003+ rely on, mirroring the shape proven by
 * packages/data/src/__tests__/helpers.ts:94..127 but wrapped in `DO $$ …
 * EXCEPTION WHEN duplicate_object` so a second invocation against the
 * reused container is a no-op.
 *
 * Caller passes a superuser Pool (the container's bootstrap role —
 * `postgres_super`). The grants are scoped to the testcontainer and do not
 * weaken production posture (production roles come from init/00-roles.sql).
 */
export async function bootstrapSharedRoles(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$ BEGIN
      CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'super-pw';
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'super-pw';
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  // GRANT statements are idempotent in Postgres 17 — repeating them is a
  // no-op rather than an error, so no DO-block wrapper is required.
  await pool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await pool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await pool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await pool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
}
