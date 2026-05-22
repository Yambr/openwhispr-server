// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 2 — GET /api/usage integration test.
//
// Real Postgres 17.5 + pg_partman testcontainer + production Drizzle
// migrations. Boots Fastify with the usage route mounted on a real Drizzle
// node-postgres handle, then asserts:
//   - new user with no ledger entries -> wordsUsed=0
//   - SUM(units) reflects all rows for the user across kinds (D-14)
//   - cross-user isolation — user A's wordsUsed excludes user B's units
//     (RLS-enforced via app.tenant_id GUC inside withTenant)
//   - 401 when req.user is absent
//   - response shape: plan='unlimited', wordsRemaining=999_999_999
//
// Phase 18.1.2 / Plan 03 — migrated from per-file PostgreSqlContainer boot
// to the shared `getSharedPostgres()` fixture (RESEARCH §3 cluster #1
// container-reduction). Per-file isolation is preserved via Option A
// (CLAUDE.md hard rule — no production code edits): shared `public`
// schema + drizzle migrate (idempotent via `_meta.__drizzle_migrations`)
// + TRUNCATE per-file + unique user emails. The Drizzle migrator no-ops on
// the second file because all migration rows are already present in
// `_meta.__drizzle_migrations`.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildUsageRoutes } from "../../../../src/routes/usage.js";
import {
  bootstrapSharedRoles,
  getSharedPostgres,
  provisionPgPartman,
} from "../../../support/shared-pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/tests/unit/routes/__tests__ -> repo root -> packages/data/migrations
// __tests__ (0) / routes (1) / unit (2) / tests (3) / api (4) / apps (5) / root (6)
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let userA: string;
let userB: string;

// Two apps so we can stub onRequest with different user identities to
// prove cross-user isolation without re-registering the route.
let appA: FastifyInstance;
let appB: FastifyInstance;
let appUnauthed: FastifyInstance;

async function buildAppForUser(
  pool_: Pool,
  user: { id: string; email: string } | null,
): Promise<FastifyInstance> {
  const db = drizzle(pool_);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  if (user) {
    app.addHook("onRequest", async (req) => {
      req.user = user;
      req.tenant = DEFAULT_TENANT_ID;
    });
  }
  await app.register(
    buildUsageRoutes({
      db: db as unknown as Parameters<typeof buildUsageRoutes>[0]["db"],
    }),
  );
  await app.ready();
  return app;
}

// Plan 03 Option A — unique user emails per file so the shared `public`
// schema does not collide with sibling integration tests sharing the same
// container. `usage-route-a` / `usage-route-b` are file-local; the
// streaming-usage suite uses a different scheme.
const EMAIL_A = "usage-route-a@example.com";
const EMAIL_B = "usage-route-b@example.com";

beforeAll(async () => {
  container = await getSharedPostgres();

  // Idempotent role bootstrap + pg_partman provisioning. Both helpers are
  // safe to re-invoke against a reused container; Plan 03 retry #4 added
  // pg_partman provisioning so migration 0014 (audit_log partitioning)
  // succeeds.
  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await bootstrapSharedRoles(superPool);
  await provisionPgPartman(superPool);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:super-pw@${host}:${port}/openwhispr`;

  // Drizzle migrate is idempotent — when another suite already ran the
  // full migration set against this shared container, `_meta.__drizzle_migrations`
  // contains every hash and this call returns without applying anything.
  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  pool = new Pool({ connectionString: ownerUri });

  // Per-file isolation: re-create the file's users via ON CONFLICT DO
  // UPDATE so re-running the suite (vitest watch / retries) is safe.
  const a = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, EMAIL_A],
  );
  const b = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, EMAIL_B],
  );
  userA = a.rows[0]?.id;
  userB = b.rows[0]?.id;

  appA = await buildAppForUser(pool, { id: userA, email: EMAIL_A });
  appB = await buildAppForUser(pool, { id: userB, email: EMAIL_B });
  appUnauthed = await buildAppForUser(pool, null);
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (appUnauthed) await appUnauthed.close();
  if (pool) await pool.end();
  // NOTE: do NOT stop the shared container here — it is owned by the
  // shared-pg module-scope cache and the testcontainers reuse daemon.
}, 60_000);

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE usage_ledger`);
});

describe("integration — GET /api/usage (real Postgres)", () => {
  it("returns wordsUsed=0 for a new user with no ledger entries", async () => {
    const res = await appA.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      wordsUsed: number;
      wordsRemaining: number;
      plan: string;
      limitReached: boolean;
      isSubscribed: boolean;
      isTrial: boolean;
    };
    expect(body.wordsUsed).toBe(0);
    expect(body.wordsRemaining).toBe(999_999_999);
    expect(body.plan).toBe("unlimited");
    expect(body.limitReached).toBe(false);
    // R34 — the immutable desktop client's useUsage hook reads
    // `isSubscribed` / `isTrial` off the /api/usage response and gates
    // SyncService.canSync() on `isSubscribed`. The corporate `unlimited`
    // plan is fully-entitled, so isSubscribed MUST be true (else cloud
    // sync of transcriptions/notes/conversations never starts and the
    // web dashboard stays empty). It is not a trial.
    expect(body.isSubscribed).toBe(true);
    expect(body.isTrial).toBe(false);
  });

  it("SUM(units) reflects all kinds (D-14): transcribe + reason + streaming + web-search", async () => {
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, 'r-1', 'transcribe_minutes', 10),
                ($1, $2, 'r-2', 'reason_tokens', 5),
                ($1, $2, 'r-3', 'streaming-stt', 15),
                ($1, $2, 'r-4', 'web-search.tavily', 1)`,
      [DEFAULT_TENANT_ID, userA],
    );
    const res = await appA.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { wordsUsed: number }).wordsUsed).toBe(31);
  });

  it("cross-user isolation — userA's wordsUsed excludes userB's units", async () => {
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, 'a-1', 'transcribe_minutes', 100),
                ($1, $3, 'b-1', 'transcribe_minutes', 999)`,
      [DEFAULT_TENANT_ID, userA, userB],
    );
    const resA = await appA.inject({ method: "GET", url: "/api/usage" });
    const resB = await appB.inject({ method: "GET", url: "/api/usage" });
    expect((resA.json() as { wordsUsed: number }).wordsUsed).toBe(100);
    expect((resB.json() as { wordsUsed: number }).wordsUsed).toBe(999);
  });

  it("returns 401 envelope when req.user is absent (defensive auth guard)", async () => {
    const res = await appUnauthed.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});
