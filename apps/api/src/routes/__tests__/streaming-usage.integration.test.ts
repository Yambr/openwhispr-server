// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 02 / Task 1 — POST /api/streaming-usage integration test.
//
// CLAUDE.md mandate: DB-touching code MUST run testcontainer integration
// tests against real Postgres + PgBouncer + Valkey. This file boots a
// real Postgres 17-alpine container via @testcontainers/postgresql,
// applies the production Drizzle migrations (0000..0010), then mounts
// the streaming-usage route on a Fastify app wired to a real Drizzle
// node-postgres handle.
//
// Asserts the production end-to-end behavior:
//   - first POST lands a usage_ledger row (kind='streaming-stt')
//   - second POST with the SAME sessionId is idempotent (one row)
//   - SUM(units) is the wordsUsed echoed in the response
//   - body.text is NEVER persisted in usage_ledger (D-13 / T-05-08 PII)
//   - Math.round semantics applied at insert time

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../error-handler.js";
import { zodTypeProvider } from "../../plugins/zod-type-provider.js";
import { buildStreamingUsageRoutes } from "../streaming-usage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/__tests__ -> packages/data/migrations
const MIGRATIONS_FOLDER = resolve(
  __dirname,
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
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(
    `GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`,
  );
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:${ownerPw}@${container.getHost()}:${container.getMappedPort(5432)}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  pool = new Pool({ connectionString: ownerUri });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
    [DEFAULT_TENANT_ID, TEST_USER_EMAIL],
  );
  userId = rows[0]!.id;

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
  if (container) await container.stop();
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
    }>(
      `SELECT kind, units FROM usage_ledger WHERE request_id = $1`,
      ["real-session-1"],
    );
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
