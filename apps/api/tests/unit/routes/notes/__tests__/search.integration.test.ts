// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 05 / Task 3 — search integration tests against real
// Postgres (tsvector GIN + websearch_to_tsquery + ts_rank scoring).

import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../../src/plugins/zod-type-provider.js";
import {
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
  seedUser,
} from "../../../../../src/routes/notes/__tests__/setup.js";
import { buildNotesSearchRoutes } from "../../../../../src/routes/notes/search.js";

let pool: Pool;
let shutdown: () => Promise<void>;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

const TENANT_B = "00000000-0000-0000-0000-00000000000c";

async function buildSearchApp(opts: {
  pool: Pool;
  userId: string;
  tenantId?: string;
}): Promise<FastifyInstance> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const db = drizzle(opts.pool);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: opts.userId, email: "search@test" };
    req.tenant = tenantId;
  });
  await app.register(
    buildNotesSearchRoutes({
      db: db as unknown as Parameters<typeof buildNotesSearchRoutes>[0]["db"],
    }),
  );
  await app.ready();
  return app;
}

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B-search') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  userA = await seedUser(pool, { email: "search-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "search-b@test" });
  appA = await buildSearchApp({ pool, userId: userA });
  appB = await buildSearchApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes`);
});

async function seedSearchCorpus(): Promise<void> {
  await pool.query(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content) VALUES
      ($1, $2, 'q-1', 'Hello world',     'A friendly greeting to the world'),
      ($1, $2, 'q-2', 'Quarterly review', 'Q3 numbers exceeded expectations'),
      ($1, $2, 'q-3', 'Lunch',           'Pizza is the perfect lunch food'),
      ($1, $2, 'q-4', 'Roadmap 2027',    'Plans for next year roadmap')`,
    [DEFAULT_TENANT_ID, userA],
  );
}

describe("integration — POST /api/notes/search", () => {
  it("returns matching notes with a numeric score, ordered by ts_rank DESC", async () => {
    await seedSearchCorpus();
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "world" }),
    });
    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as {
      notes: { title: string; score: number }[];
    };
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0]?.title).toBe("Hello world");
    expect(typeof notes[0]?.score).toBe("number");
  });

  it("uses websearch_to_tsquery — multi-word OR query 'quarterly OR roadmap' does not error", async () => {
    await seedSearchCorpus();
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      // websearch_to_tsquery default semantics is AND between terms.
      // Use the explicit "or" operator to match any-of (corpus has
      // quarterly in note q-2 and roadmap in note q-4 separately).
      payload: JSON.stringify({ query: "quarterly or roadmap" }),
    });
    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { title: string }[] };
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it("websearch_to_tsquery sanitizes operator-laden input (no 400, no SQL error)", async () => {
    await seedSearchCorpus();
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: '("quarterly") OR "world" -lunch' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it("Pitfall #3 — empty query string returns 400 envelope", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("Pitfall #3 — whitespace-only query returns 400", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "    " }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects query > 256 chars (T-05-03 mitigation surface)", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "a".repeat(257) }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("excludes soft-deleted rows", async () => {
    await seedSearchCorpus();
    await pool.query(
      `UPDATE notes SET deleted_at = NOW() WHERE user_id = $1 AND title = 'Hello world'`,
      [userA],
    );
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "world" }),
    });
    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { title: string }[] };
    expect(notes.find((n) => n.title === "Hello world")).toBeUndefined();
  });

  it("Cross-tenant — tenant B's search NEVER returns tenant A's notes", async () => {
    await seedSearchCorpus(); // for userA
    const res = await appB.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "world" }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { notes: unknown[] }).notes).toEqual([]);
  });

  it("respects limit (clamped to [1, 200], default 50)", async () => {
    // Seed 10 notes that all match "lunch".
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const base = i * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(DEFAULT_TENANT_ID, userA, `lim-${i}`, `lunch ${i}`);
    }
    await pool.query(
      `INSERT INTO notes (tenant_id, user_id, client_note_id, title) VALUES ${values.join(", ")}`,
      params,
    );
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "lunch", limit: 3 }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { notes: unknown[] }).notes).toHaveLength(3);
  });
});
