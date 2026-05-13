// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 06 / Task 1 — folders CRUD integration tests against
// real Postgres + RLS. Mirrors notes/__tests__/crud.integration.test.ts.
//
// Covers all 5 endpoints (create, batch-create, update, delete, list) +
// cross-tenant RLS isolation + per-tenant client_folder_id collision
// isolation (T-05-07) + idempotency (D-24) + null-client-id path
// (Pitfall #2) + soft-delete exclusion.

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
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "folder-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "folder-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM folders`);
});

describe("integration — folders CRUD (real Postgres + RLS)", () => {
  it("create — happy path returns CloudFolder shape (8 fields)", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_folder_id: "client-folder-001",
        name: "Work",
        is_default: true,
        sort_order: 5,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const required = [
      "id",
      "client_folder_id",
      "name",
      "is_default",
      "sort_order",
      "deleted_at",
      "created_at",
      "updated_at",
    ];
    for (const k of required) expect(body).toHaveProperty(k);
    expect(body.client_folder_id).toBe("client-folder-001");
    expect(body.name).toBe("Work");
    expect(body.is_default).toBe(true);
    expect(body.sort_order).toBe(5);
    expect(body.deleted_at).toBeNull();
    // parent_folder_id must NOT leak into the wire shape (D-22 upstream
    // CloudFolder does not expose it).
    expect(body).not.toHaveProperty("parent_folder_id");
  });

  it("create — same client_folder_id on retry returns EXISTING row (200, D-24)", async () => {
    const payload = JSON.stringify({ client_folder_id: "idem-f", name: "first" });
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    const id1 = (r1.json() as { id: string }).id;

    const r2 = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_folder_id: "idem-f", name: "SECOND — ignored" }),
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.statusCode).not.toBe(409);
    const body2 = r2.json() as { id: string; name: string };
    expect(body2.id).toBe(id1);
    expect(body2.name).toBe("first");
  });

  it("create — null/absent client_folder_id ALWAYS inserts (Pitfall #2)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "untitled-A" }),
    });
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "untitled-B" }),
    });
    const id1 = (r1.json() as { id: string }).id;
    const id2 = (r2.json() as { id: string }).id;
    expect(id1).not.toBe(id2);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM folders WHERE user_id = $1 AND client_folder_id IS NULL`,
      [userA],
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("batch-create — { folders: [...] } returns { created: CloudFolder[] }", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/folders/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        folders: [
          { client_folder_id: "bf-1", name: "alpha", sort_order: 1 },
          { client_folder_id: "bf-2", name: "beta", sort_order: 2 },
          { client_folder_id: "bf-3", name: "gamma", sort_order: 3 },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      created: { id: string; name: string; client_folder_id: string }[];
    };
    expect(body.created).toHaveLength(3);
    expect(body.created[0]!.name).toBe("alpha");
    expect(body.created[2]!.name).toBe("gamma");
    // Verify full CloudFolder shape (not the minimal {client_folder_id, id} pair).
    expect(body.created[0]).toHaveProperty("is_default");
    expect(body.created[0]).toHaveProperty("sort_order");
    expect(body.created[0]).toHaveProperty("created_at");
  });

  it("batch-create — bare array body also accepted", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/folders/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        { client_folder_id: "bare-1", name: "x" },
        { client_folder_id: "bare-2", name: "y" },
      ]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: unknown[] };
    expect(body.created).toHaveLength(2);
  });

  it("batch-create — 501 items → 400 envelope (D-30)", async () => {
    const folders = Array.from({ length: 501 }, (_, i) => ({
      client_folder_id: `over-${i}`,
      name: `f-${i}`,
    }));
    const res = await appA.inject({
      method: "POST",
      url: "/api/folders/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ folders }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/500/);
  });

  it("update — PATCH mutates owner's row + bumps updated_at", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_folder_id: "upd-f", name: "old" }),
    });
    const { id, updated_at: oldUpdated } = create.json() as {
      id: string;
      updated_at: string;
    };
    await new Promise((r) => setTimeout(r, 25));

    const patch = await appA.inject({
      method: "PATCH",
      url: "/api/folders/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, name: "new", sort_order: 99 }),
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json() as {
      id: string;
      name: string;
      sort_order: number;
      updated_at: string;
    };
    expect(updated.id).toBe(id);
    expect(updated.name).toBe("new");
    expect(updated.sort_order).toBe(99);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
      new Date(oldUpdated).getTime(),
    );
  });

  it("update — unknown id returns 404", async () => {
    const res = await appA.inject({
      method: "PATCH",
      url: "/api/folders/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        name: "ghost",
      }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete — sets deleted_at; list excludes", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_folder_id: "del-f", name: "to-delete" }),
    });
    const { id } = create.json() as { id: string };
    const del = await appA.inject({
      method: "DELETE",
      url: "/api/folders/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM folders WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();

    const list = await appA.inject({ method: "GET", url: "/api/folders/list" });
    const listBody = list.json() as { folders: { id: string }[] };
    expect(listBody.folders.find((f) => f.id === id)).toBeUndefined();
  });

  it("delete — unknown id returns 404", async () => {
    const res = await appA.inject({
      method: "DELETE",
      url: "/api/folders/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("RLS — tenant B cannot see / mutate tenant A's folders (T-05-07)", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_folder_id: "a-private", name: "A secret" }),
    });
    const { id } = create.json() as { id: string };

    // B's update → 404.
    const bUpdate = await appB.inject({
      method: "PATCH",
      url: "/api/folders/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, name: "B's mutation" }),
    });
    expect(bUpdate.statusCode).toBe(404);

    // B's delete → 404.
    const bDel = await appB.inject({
      method: "DELETE",
      url: "/api/folders/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(bDel.statusCode).toBe(404);

    // B's list — invisible.
    const bList = await appB.inject({ method: "GET", url: "/api/folders/list" });
    const bBody = bList.json() as { folders: { id: string }[] };
    expect(bBody.folders.find((f) => f.id === id)).toBeUndefined();

    // Cross-tenant client_folder_id reuse is legal (partial UNIQUE is
    // (tenant_id, user_id, client_folder_id)).
    const bCreate = await appB.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_folder_id: "a-private", name: "B own" }),
    });
    expect(bCreate.statusCode).toBe(200);

    // A's original row still has original name.
    const aList = await appA.inject({ method: "GET", url: "/api/folders/list" });
    const aBody = aList.json() as { folders: { id: string; name: string }[] };
    const aRow = aBody.folders.find((f) => f.id === id);
    expect(aRow?.name).toBe("A secret");
  });

  it("401 — missing req.user defensive guard", async () => {
    const Fastify = (await import("fastify")).default;
    const app = Fastify({ logger: false });
    const { registerErrorHandler } = await import("../../../error-handler.js");
    const { zodTypeProvider } = await import("../../../plugins/zod-type-provider.js");
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const db = drizzle(pool);
    const { buildFoldersCreateRoutes } = await import("../create.js");
    await app.register(
      buildFoldersCreateRoutes({
        db: db as unknown as Parameters<typeof buildFoldersCreateRoutes>[0]["db"],
      }),
    );
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/folders/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "x" }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
