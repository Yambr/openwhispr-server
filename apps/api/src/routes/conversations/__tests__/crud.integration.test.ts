// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 07 / Task 1 — conversations CRUD integration tests
// against real Postgres + RLS. Mirrors notes & folders CRUD tests.
//
// Covers: create (happy + idempotency D-24 + null-client-id),
//         update (200 + 404 cross-tenant), delete (soft + 404),
//         list (basic — no include=messages branch — that's Task 2),
//         cross-tenant RLS isolation (T-05-07).

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
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "conv-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "conv-b@test" });
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

describe("integration — conversations CRUD (real Postgres + RLS)", () => {
  it("create — happy path returns CloudConversation shape (7 fields)", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_conversation_id: "client-conv-001",
        title: "Quarterly Roadmap",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const required = [
      "id",
      "client_conversation_id",
      "title",
      "archived_at",
      "deleted_at",
      "created_at",
      "updated_at",
    ];
    for (const k of required) expect(body).toHaveProperty(k);
    expect(body.client_conversation_id).toBe("client-conv-001");
    expect(body.title).toBe("Quarterly Roadmap");
    expect(body.archived_at).toBeNull();
    expect(body.deleted_at).toBeNull();
  });

  it("create — same client_conversation_id on retry returns EXISTING row (200, D-24)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_conversation_id: "idem-c", title: "first" }),
    });
    expect(r1.statusCode).toBe(200);
    const id1 = (r1.json() as { id: string }).id;

    const r2 = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_conversation_id: "idem-c",
        title: "SECOND — ignored",
      }),
    });
    expect(r2.statusCode).toBe(200);
    const body2 = r2.json() as { id: string; title: string };
    expect(body2.id).toBe(id1);
    expect(body2.title).toBe("first");
  });

  it("create — null client_conversation_id ALWAYS inserts (Pitfall #2)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "no-client-id-A" }),
    });
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "no-client-id-B" }),
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect((r1.json() as { id: string }).id).not.toBe(
      (r2.json() as { id: string }).id,
    );
  });

  it("update — happy path advances updated_at and returns CloudConversation", async () => {
    const c = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "before-update" }),
    });
    const { id, updated_at: before } = c.json() as {
      id: string;
      updated_at: string;
    };
    await new Promise((r) => setTimeout(r, 25));
    const u = await appA.inject({
      method: "PATCH",
      url: "/api/conversations/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, title: "after-update" }),
    });
    expect(u.statusCode).toBe(200);
    const body = u.json() as { id: string; title: string; updated_at: string };
    expect(body.id).toBe(id);
    expect(body.title).toBe("after-update");
    expect(new Date(body.updated_at).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });

  it("update — unknown id → 404", async () => {
    const res = await appA.inject({
      method: "PATCH",
      url: "/api/conversations/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        title: "nope",
      }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete — soft-deletes and subsequent list excludes the row", async () => {
    const c = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "to-delete" }),
    });
    const { id } = c.json() as { id: string };
    const d = await appA.inject({
      method: "DELETE",
      url: "/api/conversations/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toEqual({ ok: true });
    // Row still exists physically.
    const { rows } = await pool.query<{ deleted_at: Date }>(
      `SELECT deleted_at FROM conversations WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.deleted_at).not.toBeNull();
    // But list does not see it.
    const l = await appA.inject({ method: "GET", url: "/api/conversations/list" });
    expect(l.statusCode).toBe(200);
    expect((l.json() as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it("delete — unknown id → 404", async () => {
    const res = await appA.inject({
      method: "DELETE",
      url: "/api/conversations/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
      }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("list — basic ordering created_at DESC", async () => {
    for (let i = 0; i < 3; i++) {
      await appA.inject({
        method: "POST",
        url: "/api/conversations/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ title: `c-${i}` }),
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await appA.inject({ method: "GET", url: "/api/conversations/list" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversations: { title: string }[] };
    expect(body.conversations).toHaveLength(3);
    expect(body.conversations.map((c) => c.title)).toEqual(["c-2", "c-1", "c-0"]);
  });

  it("RLS — cross-tenant invisibility: tenant B cannot see/mutate/delete tenant A's conversation", async () => {
    const cA = await appA.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_conversation_id: "a-private",
        title: "TenantA-secret",
      }),
    });
    const { id: idA } = cA.json() as { id: string };

    // Tenant B can use the SAME client_conversation_id (T-05-07).
    const cB = await appB.inject({
      method: "POST",
      url: "/api/conversations/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_conversation_id: "a-private",
        title: "TenantB-own",
      }),
    });
    expect(cB.statusCode).toBe(200);
    expect((cB.json() as { id: string }).id).not.toBe(idA);

    // Tenant B's list does not see Tenant A's conversation.
    const lB = await appB.inject({
      method: "GET",
      url: "/api/conversations/list",
    });
    expect(lB.statusCode).toBe(200);
    const titlesB = (lB.json() as { conversations: { title: string }[] }).conversations
      .map((c) => c.title);
    expect(titlesB).not.toContain("TenantA-secret");

    // Tenant B's update on Tenant A's id → 404 (RLS invisible).
    const uB = await appB.inject({
      method: "PATCH",
      url: "/api/conversations/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: idA, title: "hijack" }),
    });
    expect(uB.statusCode).toBe(404);

    // Tenant B's delete on Tenant A's id → 404.
    const dB = await appB.inject({
      method: "DELETE",
      url: "/api/conversations/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: idA }),
    });
    expect(dB.statusCode).toBe(404);

    // Tenant A's conversation is intact.
    const { rows } = await pool.query<{ title: string; deleted_at: Date | null }>(
      `SELECT title, deleted_at FROM conversations WHERE id = $1`,
      [idA],
    );
    expect(rows[0]!.title).toBe("TenantA-secret");
    expect(rows[0]!.deleted_at).toBeNull();
  });
});
