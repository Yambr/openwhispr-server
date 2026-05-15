// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 1 — POST /api/streaming-usage integration test.
//
// CLAUDE.md mandate: DB-touching code MUST run testcontainer integration
// tests against real Postgres + PgBouncer + Valkey. This file attaches to
// the shared Postgres 17.5 + pg_partman container, applies the production
// Drizzle migrations (0000..0014+), then mounts the streaming-usage route
// on a Fastify app wired to a real Drizzle node-postgres handle.
//
// Asserts the production end-to-end behavior:
//   - first POST lands a usage_ledger row (kind='streaming-stt')
//   - second POST with the SAME sessionId is idempotent (one row)
//   - SUM(units) is the wordsUsed echoed in the response
//   - body.text is NEVER persisted in usage_ledger (D-13 / T-05-08 PII)
//   - Math.round semantics applied at insert time
//
// Phase 18.1.2 / Plan 03 — migrated from per-file PostgreSqlContainer
// boot to the shared `getSharedPostgres()` fixture (RESEARCH §3 cluster #1).
// Option A isolation per CLAUDE.md hard rule (no production code edits):
// shared `public` schema + idempotent drizzle migrate + TRUNCATE per-file
// + unique user email per file.

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
import { buildStreamingUsageRoutes } from "../../../../src/routes/streaming-usage.js";
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
const TEST_USER_EMAIL = "streaming-usage-route@example.com";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  container = await getSharedPostgres();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await bootstrapSharedRoles(superPool);
  await provisionPgPartman(superPool);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:super-pw@${host}:${port}/openwhispr`;

  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  pool = new Pool({ connectionString: ownerUri });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, TEST_USER_EMAIL],
  );
  userId = rows[0]?.id;

  const db = drizzle(pool);
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: userId, email: TEST_USER_EMAIL };
    req.tenant = DEFAULT_TENANT_ID;
  });
  await app.register(
    buildStreamingUsageRoutes({
      db: db as unknown as Parameters<typeof buildStreamingUsageRoutes>[0]["db"],
    }),
  );
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  // NOTE: do NOT stop the shared container here — owned by shared-pg
  // module-scope cache + testcontainers reuse daemon (Plan 03).
}, 60_000);

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE usage_ledger`);
});

describe("integration — POST /api/streaming-usage (real Postgres)", () => {
  it("happy path — lands a usage_ledger row with kind='streaming-stt'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "real-session-1",
        audioDurationSeconds: 60,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      wordsUsed: number;
      wordsRemaining: number;
      plan: string;
      limitReached: boolean;
    };
    expect(body.wordsUsed).toBe(60);
    expect(body.wordsRemaining).toBe(999_999_999);
    expect(body.plan).toBe("unlimited");
    expect(body.limitReached).toBe(false);

    const { rows } = await pool.query<{
      kind: string;
      units: number;
    }>(`SELECT kind, units FROM usage_ledger WHERE request_id = $1`, ["real-session-1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("streaming-stt");
    expect(rows[0]?.units).toBe(60);
  });

  it("idempotent — same sessionId on retry returns 200 with one ledger row (D-10)", async () => {
    const payload = JSON.stringify({
      sessionId: "real-session-idem",
      audioDurationSeconds: 30,
    });
    const r1 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload,
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    // NOT 409 — same sessionId is idempotent, not conflict.
    expect(r2.statusCode).not.toBe(409);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM usage_ledger WHERE request_id = $1`,
      ["real-session-idem"],
    );
    expect(rows[0]?.count).toBe("1");
    expect((r1.json() as { wordsUsed: number }).wordsUsed).toBe(30);
    expect((r2.json() as { wordsUsed: number }).wordsUsed).toBe(30);
  });

  it("Math.round semantics — audioDurationSeconds=120.51 stores units=121", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "real-session-round",
        audioDurationSeconds: 120.51,
      }),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query<{ units: number }>(
      `SELECT units FROM usage_ledger WHERE request_id = $1`,
      ["real-session-round"],
    );
    expect(rows[0]?.units).toBe(121);
  });

  it("D-13 — body.text NEVER persisted in usage_ledger (PII mitigation)", async () => {
    const secret = "SECRET PII transcript that must never reach the ledger";
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "real-session-pii",
        audioDurationSeconds: 5,
        text: secret,
      }),
    });
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM usage_ledger WHERE request_id = $1`,
      ["real-session-pii"],
    );
    expect(rows).toHaveLength(1);
    for (const col of Object.values(rows[0] ?? {})) {
      if (typeof col === "string") {
        expect(col).not.toContain(secret);
      }
    }
  });

  it("SUM(units) reflects all ledger entries for the user across kinds (D-14)", async () => {
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, 'prior-1', 'transcribe_minutes', 10),
                ($1, $2, 'prior-2', 'reason_tokens', 25),
                ($1, $2, 'prior-3', 'web-search.tavily', 1)`,
      [DEFAULT_TENANT_ID, userId],
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "real-session-sum",
        audioDurationSeconds: 4,
      }),
    });
    expect(res.statusCode).toBe(200);
    // 10 + 25 + 1 + 4 = 40
    expect((res.json() as { wordsUsed: number }).wordsUsed).toBe(40);
  });
});
