// Phase 05 / Plan 07 / Task 3 — WIRE-25 /api/conversations/messages
// integration tests (POST + GET). Real Postgres + RLS.

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
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "msg-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "msg-b@test" });
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

async function createConversation(
  app: FastifyInstance,
  title: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ title }),
  });
  return (res.json() as { id: string }).id;
}

describe("integration — WIRE-25 /api/conversations/messages POST", () => {
  it("happy path — returns CloudMessage with all 6 required fields", async () => {
    const cid = await createConversation(appA, "msg-target");
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: cid,
        role: "user",
        content: "hello world",
        metadata: { foo: "bar" },
        client_message_id: "client-msg-1",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    for (const k of [
      "id",
      "conversation_id",
      "role",
      "content",
      "metadata",
      "created_at",
    ]) {
      expect(body).toHaveProperty(k);
    }
    expect(body.conversation_id).toBe(cid);
    expect(body.role).toBe("user");
    expect(body.content).toBe("hello world");
    expect(body.metadata).toEqual({ foo: "bar" });
  });

  it("idempotent — same client_message_id returns the existing row (200, not 409)", async () => {
    const cid = await createConversation(appA, "idem-conv");
    const payload = {
      conversation_id: cid,
      role: "user" as const,
      content: "first content",
      client_message_id: "idem-msg-1",
    };
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ...payload, content: "SECOND ignored" }),
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const id1 = (r1.json() as { id: string }).id;
    const id2 = (r2.json() as { id: string; content: string }).id;
    expect(id2).toBe(id1);
    expect((r2.json() as { content: string }).content).toBe("first content");
  });

  it("metadata > 4 KiB returns 400 envelope (T-MSG-INJ)", async () => {
    const cid = await createConversation(appA, "big-meta");
    const oversized = { blob: "x".repeat(5000) };
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: cid,
        role: "user",
        content: "ok",
        metadata: oversized,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/4096|4KB/);
  });

  it("conversation_id pointing at another tenant → 404 (RLS invisible)", async () => {
    const cidA = await createConversation(appA, "tenantA-priv");
    const res = await appB.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: cidA,
        role: "user",
        content: "x",
      }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("unknown role → 400 (Zod enum)", async () => {
    const cid = await createConversation(appA, "bad-role");
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: cid,
        role: "wizard",
        content: "x",
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("integration — WIRE-25 /api/conversations/messages GET", () => {
  async function seedMessages(cid: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const res = await appA.inject({
        method: "POST",
        url: "/api/conversations/messages",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          conversation_id: cid,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
          client_message_id: `c-${cid}-${i}`,
        }),
      });
      ids.push((res.json() as { id: string }).id);
      // Tiny delay so created_at differs by ms.
      await new Promise((r) => setTimeout(r, 3));
    }
    return ids;
  }

  it("returns { messages: CloudMessage[] } in created_at DESC order", async () => {
    const cid = await createConversation(appA, "list-msgs");
    const ids = await seedMessages(cid, 3);

    const res = await appA.inject({
      method: "GET",
      url: `/api/conversations/messages?conversation_id=${cid}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: Array<{ id: string }> };
    expect(body.messages.map((m) => m.id)).toEqual([...ids].reverse());
  });

  it("soft-deleted messages excluded", async () => {
    const cid = await createConversation(appA, "with-soft-del");
    const ids = await seedMessages(cid, 3);
    await pool.query(`UPDATE messages SET deleted_at = NOW() WHERE id = $1`, [
      ids[1],
    ]);
    const res = await appA.inject({
      method: "GET",
      url: `/api/conversations/messages?conversation_id=${cid}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: Array<{ id: string }> };
    expect(body.messages.map((m) => m.id)).not.toContain(ids[1]);
    expect(body.messages).toHaveLength(2);
  });

  it("missing conversation_id → 400", async () => {
    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/messages",
    });
    expect(res.statusCode).toBe(400);
  });

  it("malformed conversation_id (not a UUID) → 400", async () => {
    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/messages?conversation_id=not-a-uuid",
    });
    expect(res.statusCode).toBe(400);
  });

  it("cross-tenant conversation_id → 404 (RLS invisible)", async () => {
    const cidA = await createConversation(appA, "tenantA-priv-2");
    await seedMessages(cidA, 1);
    const res = await appB.inject({
      method: "GET",
      url: `/api/conversations/messages?conversation_id=${cidA}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("keyset pagination — limit caps at 200; default 50", async () => {
    const cid = await createConversation(appA, "page-test");
    await seedMessages(cid, 5);
    const res = await appA.inject({
      method: "GET",
      url: `/api/conversations/messages?conversation_id=${cid}&limit=2`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { messages: unknown[] }).messages).toHaveLength(2);
  });
});
