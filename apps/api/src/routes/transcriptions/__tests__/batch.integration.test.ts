// Phase 05 / Plan 08 / Task 1 — transcriptions batch-delete integration
// tests against real Postgres + RLS.
//
// Covers: batch-delete happy path (returns deleted: string[]), 501-item
// rejection, already-deleted rows excluded, cross-tenant invisibility,
// empty ids array.

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
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "txb-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "txb-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM transcriptions`);
});

async function createTx(
  app: FastifyInstance,
  clientId: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/transcriptions/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      client_transcription_id: clientId,
      text: `t-${clientId}`,
    }),
  });
  return (res.json() as { id: string }).id;
}

describe("integration — transcriptions batch-delete (real Postgres + RLS)", () => {
  it("batch-delete — soft-deletes each id, returns { deleted: string[] }", async () => {
    const id1 = await createTx(appA, "bd-1");
    const id2 = await createTx(appA, "bd-2");
    const id3 = await createTx(appA, "bd-3");

    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [id1, id2, id3] }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: string[] };
    expect(body.deleted).toHaveLength(3);
    expect(new Set(body.deleted)).toEqual(new Set([id1, id2, id3]));

    // Verify all 3 have deleted_at set.
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM transcriptions WHERE id = ANY($1::uuid[])`,
      [[id1, id2, id3]],
    );
    for (const row of rows) {
      expect(row.deleted_at).not.toBeNull();
    }

    // List excludes them.
    const list = await appA.inject({
      method: "GET",
      url: "/api/transcriptions/list",
    });
    const listBody = list.json() as { transcriptions: { id: string }[] };
    expect(listBody.transcriptions).toHaveLength(0);
  });

  it("batch-delete — already-deleted rows excluded from deleted[]", async () => {
    const id1 = await createTx(appA, "ad-1");
    const id2 = await createTx(appA, "ad-2");
    // Soft-delete id1 first.
    await appA.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: id1 }),
    });

    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [id1, id2] }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: string[] };
    // id1 was already deleted → NOT in the returned array; only id2.
    expect(body.deleted).toEqual([id2]);
  });

  it("batch-delete — 501 ids → 400 envelope (D-30)", async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-2222-3333-444455556666`,
    );
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/500/);
  });

  it("batch-delete — 500 ids boundary success (within cap)", async () => {
    // Seed 3 real rows; bulk request with 500 IDs (mostly fake UUIDs).
    const id1 = await createTx(appA, "bd500-1");
    const id2 = await createTx(appA, "bd500-2");
    const id3 = await createTx(appA, "bd500-3");
    const fakes = Array.from(
      { length: 497 },
      (_, i) => `${String(i + 1).padStart(8, "0")}-9999-9999-9999-999999999999`,
    );
    const ids = [id1, id2, id3, ...fakes];
    expect(ids).toHaveLength(500);

    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: string[] };
    // Only the 3 real ones get reported.
    expect(new Set(body.deleted)).toEqual(new Set([id1, id2, id3]));
  });

  it("batch-delete — empty ids array returns { deleted: [] }", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [] }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: string[] };
    expect(body.deleted).toEqual([]);
  });

  it("RLS — tenant B's batch-delete on tenant A's ids → empty deleted[]", async () => {
    const id1 = await createTx(appA, "rls-1");
    const id2 = await createTx(appA, "rls-2");

    const bDel = await appB.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [id1, id2] }),
    });
    expect(bDel.statusCode).toBe(200);
    const bBody = bDel.json() as { deleted: string[] };
    // RLS hides A's rows from B's UPDATE — nothing soft-deleted.
    expect(bBody.deleted).toEqual([]);

    // A's rows still live, undeleted.
    const aList = await appA.inject({
      method: "GET",
      url: "/api/transcriptions/list",
    });
    const aBody = aList.json() as { transcriptions: { id: string }[] };
    expect(aBody.transcriptions).toHaveLength(2);
  });
});
