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
//
// Plan 03 retry #4 — image pinned to `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1`
// (built locally via compose/postgres/Dockerfile). Migration 0014 invokes
// partman.create_parent, which requires pg_partman 5.x installed in the
// `partman` schema. Plan 02 originally shipped this fixture pinned to
// `postgres:17-alpine` — incomplete; forward-corrected here. The
// `provisionPgPartman()` helper mirrors the grant chain proven by
// packages/data/src/__tests__/helpers.ts so integration tests invoke a
// single bootstrap to make the full migration set runnable.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";

let cached: Promise<StartedPostgreSqlContainer> | null = null;

/**
 * Image tag for the custom Postgres 17.5 build that bundles pg_partman
 * 5.2.4 (compose/postgres/Dockerfile). Migration 0014 requires it; pinning
 * the shared container to this image guarantees the full migration set is
 * runnable in any integration test that attaches via `getSharedPostgres()`.
 *
 * D-22 — this is a LOCAL image, not a registry pull. CI builds it via
 * `make build-pg-partman`; developers run the same target on first use.
 */
export const SHARED_POSTGRES_IMAGE =
  "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";

/**
 * Lazily start (or attach to, via `withReuse()`) a Postgres 17.5 +
 * pg_partman testcontainer with the canonical openwhispr bootstrap
 * credentials.
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
  cached ??= new PostgreSqlContainer(SHARED_POSTGRES_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .withReuse()
    .start();
  return cached;
}

/**
 * Idempotently provision the `partman` schema + pg_partman extension on
 * the shared container, and grant `openwhispr_owner` the privileges
 * pg_partman 5.x needs to drive `create_parent` / `run_maintenance_proc`
 * (CREATE on schema, all on tables/sequences, EXECUTE on funcs+procs).
 *
 * Mirrors the canonical grant chain from
 * `packages/data/src/__tests__/helpers.ts::bootMigratedPostgres()` so any
 * integration test that runs the full migration set (0000..0014+) against
 * the shared container can call this once after `bootstrapSharedRoles()`
 * to land the production privilege model.
 *
 * Caller passes the superuser Pool (the container's bootstrap role —
 * `postgres_super`). All statements are idempotent so a second invocation
 * against a reused container is a no-op.
 */
export async function provisionPgPartman(
  superPool: Pool,
  ownerRole = "openwhispr_owner",
): Promise<void> {
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(`GRANT ALL ON SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO ${ownerRole}`);
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
