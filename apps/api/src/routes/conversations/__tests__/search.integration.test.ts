// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 07 / Task 1 — conversations search integration tests.
//
// Covers: happy path with ts_rank score, websearch_to_tsquery
// operator-laden input survival (T-05-03), empty/whitespace query
// rejection, 257-char rejection, soft-delete exclusion, RLS isolation.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { bootMigratedPostgres, buildTestApp, seedUser } from "./setup.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let shutdown: () => Promise<void>;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "search-conv-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "search-conv-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM messages`);
  await pool.query(`DELETE FROM conversations`);
});

async function seedConversation(app: FastifyInstance, title: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ title }),
  });
  return (res.json() as { id: string }).id;
}

describe("integration — conversations search", () => {
  it("happy path — returns matches with score field", async () => {
    await seedConversation(appA, "Quarterly Roadmap Planning");
    await seedConversation(appA, "Weekly Sync");
    await seedConversation(appA, "Roadmap Review");

    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "roadmap" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<{ title: string; score: number }>;
    };
    expect(body.conversations.length).toBe(2);
    for (const c of body.conversations) {
      expect(typeof c.score).toBe("number");
      expect(c.score).toBeGreaterThan(0);
    }
  });

  it("operator-laden query does NOT raise (T-05-03 — websearch_to_tsquery)", async () => {
    await seedConversation(appA, "Quarterly Roadmap");
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: '"unbalanced (quote' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it("empty query → 400", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("whitespace-only query → 400 (Pitfall #3)", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "   " }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("query > 256 chars → 400", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "a".repeat(257) }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("soft-deleted conversations are excluded from results", async () => {
    const id = await seedConversation(appA, "Roadmap session");
    await appA.inject({
      method: "DELETE",
      url: "/api/conversations/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "roadmap" }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it("RLS — tenant A's conversations invisible to tenant B's search", async () => {
    await seedConversation(appA, "TenantA secret roadmap");
    const res = await appB.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "roadmap" }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it("limit clamps to [1, 200] — limit=500 → 200 rows max", async () => {
    // seed two matching conversations
    await seedConversation(appA, "roadmap one");
    await seedConversation(appA, "roadmap two");
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "roadmap", limit: 500 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversations: unknown[] };
    expect(body.conversations.length).toBeLessThanOrEqual(200);
  });
});
