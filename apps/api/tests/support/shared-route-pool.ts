// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.2 / Plan 05 / Task 05-01..03 — shared Postgres pool for route
// integration tests (Cluster #2 container reduction).
//
// Wraps `getSharedPostgres()` + `bootstrapSharedRoles()` + `provisionPgPartman()`
// + Drizzle `migrate()` into a single idempotent boot that returns a ready
// `openwhispr_owner`-scoped Pool. Memoised at module scope so the second-and-
// onward callers within the same vitest worker attach to the existing pool
// without re-running the migration set (`_meta.__drizzle_migrations` no-ops
// anyway, but this saves the round-trip).
//
// CLAUDE.md hard rule — ZERO production-code edits in this plan. This helper
// lives entirely under `tests/`, so the per-domain `apps/api/src/routes/.../
// __tests__/setup.ts` files stay UNTOUCHED. Test files swap their call to
// `bootMigratedPostgres()` for `getSharedRoutePool()` while still importing
// the pool-agnostic `buildTestApp` / `seedUser` helpers from the production-
// tree setup.ts.
//
// Plan 03 canonical pattern (Option A — shared `public` schema + per-file
// TRUNCATE + unique per-file user emails). Per-file isolation comes from each
// test file's own `beforeEach` truncating its domain tables (`notes`,
// `conversations`, `folders`, …) and from per-file email suffixes that bypass
// the `(tenant_id, lower(email))` functional unique index on users.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { bootstrapSharedRoles, getSharedPostgres, provisionPgPartman } from "./shared-pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/tests/support → repo root → packages/data/migrations.
// support (0) / tests (1) / api (2) / apps (3) / root (4). Five `..` segments.
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

let cached: Promise<Pool> | null = null;

/**
 * Lazily boot (or reuse) the shared Postgres testcontainer with the full
 * migration set applied, returning an `openwhispr_owner`-scoped Pool ready
 * for route-level integration tests. Idempotent under `.withReuse()`:
 * second-and-onward callers within the same vitest worker get the cached
 * Pool; Drizzle migrate is a no-op via `_meta.__drizzle_migrations`.
 *
 * Caller MUST NOT call `pool.end()` in `afterAll` — the Pool is owned by
 * this module's cache and remains live for the duration of the vitest
 * worker process so sibling suites can reuse it.
 */
export async function getSharedRoutePool(): Promise<Pool> {
  cached ??= (async () => {
    const container = await getSharedPostgres();

    // Idempotent bootstrap. Both helpers wrap their statements in DO blocks
    // / IF NOT EXISTS so re-invocation against a reused container is a no-op.
    const superPool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      await bootstrapSharedRoles(superPool);
      await provisionPgPartman(superPool);
    } finally {
      await superPool.end();
    }

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const ownerUri = `postgres://openwhispr_owner:super-pw@${host}:${port}/openwhispr`;

    // Drizzle migrate — idempotent via `_meta.__drizzle_migrations`. First
    // suite to arrive applies the full migration set (0000..0014+); every
    // subsequent suite finds the hashes already present and returns without
    // applying anything.
    const ownerPool = new Pool({ connectionString: ownerUri });
    try {
      await migrate(drizzle(ownerPool), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: "_meta",
        migrationsTable: "__drizzle_migrations",
      });
    } finally {
      await ownerPool.end();
    }

    return new Pool({ connectionString: ownerUri });
  })();

  return cached;
}
