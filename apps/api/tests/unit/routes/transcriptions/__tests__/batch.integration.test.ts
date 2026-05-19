// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 08 / Task 1 — transcriptions batch-delete integration
// tests against real Postgres + RLS.
//
// Covers: batch-delete happy path (returns deleted: string[]), 501-item
// rejection, already-deleted rows cause rollback (atomic semantics),
// cross-tenant invisibility causes rollback, empty ids array.
//
// Phase 56 / Plan 05 (R11) — batch-delete is now ATOMIC (all-or-none).
// Per SERVER-REQUIREMENTS.md §R11 and Phase 56 CONTEXT.md atomicity
// decision: if any id in the batch fails to match (not found, already-
// deleted, RLS-hidden), the WHOLE batch rolls back and the route returns
// 404 TRANSCRIPTION_NOT_FOUND. Previously the route silently returned
// partial-success — that semantic is removed.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/transcriptions/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

// Phase 18.1.2 / Plan 05 / Cluster #2 sub-cluster 2c — shared-pg
// migration (Option A canon).

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  const ra = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_A, "txb-a@test"],
  );
  const rb = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_B, "txb-b@test"],
  );
  userA = ra.rows[0]!.id;
  userB = rb.rows[0]!.id;
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM transcriptions`);
});

async function createTx(app: FastifyInstance, clientId: string): Promise<string> {
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

  it("batch-delete — atomic: any already-deleted id → 404 + WHOLE batch rolled back", async () => {
    // Phase 56 / Plan 05 (R11) atomic semantics — if id1 is already
    // soft-deleted, the batch UPDATE matches only 1 of 2 ids → the
    // transaction MUST roll back and the route MUST 404. id2 stays live.
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
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    // Envelope error is the i18n-localized message for the
    // TRANSCRIPTION_NOT_FOUND code → "Transcription not found" (en).
    expect(body.error).toMatch(/transcription not found/i);

    // ATOMICITY — id2 was NOT soft-deleted (whole tx rolled back).
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM transcriptions WHERE id = $1`,
      [id2],
    );
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("batch-delete — 501 ids → 400 envelope (D-30)", async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-4222-8333-444455556666`,
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

  it("batch-delete — 500 ids boundary, all-real: full success at cap", async () => {
    // Phase 56 / Plan 05 (R11) atomic semantics — boundary success requires
    // every id in the batch to match a live row. Seed 500 real rows and
    // delete them as a single atomic batch.
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      ids.push(await createTx(appA, `bd500-${i}`));
    }
    expect(ids).toHaveLength(500);

    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: string[] };
    expect(new Set(body.deleted)).toEqual(new Set(ids));
  });

  it("batch-delete — atomic: mix of real + fake UUIDs → 404 + WHOLE batch rolled back", async () => {
    // Phase 56 / Plan 05 (R11) atomic semantics — 3 real + 497 fakes does
    // NOT partially-succeed. Whole tx rolls back; real rows stay live.
    const id1 = await createTx(appA, "bdmix-1");
    const id2 = await createTx(appA, "bdmix-2");
    const id3 = await createTx(appA, "bdmix-3");
    const fakes = Array.from(
      { length: 497 },
      (_, i) => `${String(i + 1).padStart(8, "0")}-9999-4999-8999-999999999999`,
    );
    const ids = [id1, id2, id3, ...fakes];

    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids }),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    // Envelope error is the i18n-localized message for the
    // TRANSCRIPTION_NOT_FOUND code → "Transcription not found" (en).
    expect(body.error).toMatch(/transcription not found/i);

    // All 3 real rows STILL live (atomicity).
    const { rows } = await pool.query<{ id: string; deleted_at: Date | null }>(
      `SELECT id, deleted_at FROM transcriptions WHERE id = ANY($1::uuid[])`,
      [[id1, id2, id3]],
    );
    for (const row of rows) {
      expect(row.deleted_at).toBeNull();
    }
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

  it("RLS — tenant B's batch-delete on tenant A's ids → 404 + A's rows live (atomic)", async () => {
    // Phase 56 / Plan 05 (R11) atomic semantics — RLS hides A's rows from
    // B's UPDATE → matched 0 rows for B → atomic rollback → 404. A's rows
    // remain live (already live; this confirms no leakage either way).
    const id1 = await createTx(appA, "rls-1");
    const id2 = await createTx(appA, "rls-2");

    const bDel = await appB.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [id1, id2] }),
    });
    expect(bDel.statusCode).toBe(404);
    const bBody = bDel.json() as { error: string };
    expect(bBody.error).toMatch(/transcription not found/i);

    // A's rows still live, undeleted.
    const aList = await appA.inject({
      method: "GET",
      url: "/api/transcriptions/list",
    });
    const aBody = aList.json() as { transcriptions: { id: string }[] };
    expect(aBody.transcriptions).toHaveLength(2);
  });
});
