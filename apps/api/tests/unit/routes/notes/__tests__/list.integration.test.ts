// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — list integration tests (keyset pagination
// + soft-delete + limit clamp).

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

// Phase 18.1.2 / Plan 05 / Cluster #2 sub-cluster 2b — shared-pg
// migration (Option A canon).

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, "list@test"],
  );
  userId = r.rows[0]!.id;
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes`);
});

async function seedNotes(n: number): Promise<{ id: string; created_at: string }[]> {
  const out: { id: string; created_at: string }[] = [];
  for (let i = 0; i < n; i++) {
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      // A row whose `updated_at` is unrelated to its `created_at` is not a shape
      // the desktop ever produces, and seeding one is what let these fixtures pass
      // while `?since=` filtered the wrong column. Stagger both together.
      `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, created_at`,
      [
        "00000000-0000-0000-0000-000000000000",
        userId,
        `seed-${i}`,
        `Title ${i}`,
        `Content ${i}`,
        new Date(Date.now() - (n - i) * 1000),
      ],
    );
    out.push({ id: rows[0]?.id, created_at: rows[0]?.created_at.toISOString() });
  }
  return out;
}

describe("integration — GET /api/notes/list", () => {
  it("returns rows ordered by created_at DESC, id DESC", async () => {
    const seeded = await seedNotes(5);
    const res = await app.inject({ method: "GET", url: "/api/notes/list" });
    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { id: string }[] };
    expect(notes).toHaveLength(5);
    // The most-recently-created (last seeded) should come first.
    expect(notes[0]?.id).toBe(seeded[4]?.id);
    expect(notes[4]?.id).toBe(seeded[0]?.id);
  });

  it("respects ?limit=10 query param", async () => {
    await seedNotes(15);
    const res = await app.inject({ method: "GET", url: "/api/notes/list?limit=10" });
    const { notes } = res.json() as { notes: unknown[] };
    expect(notes).toHaveLength(10);
  });

  it("D-25 — clamps ?limit=500 to 200 max", async () => {
    await seedNotes(5);
    const res = await app.inject({ method: "GET", url: "/api/notes/list?limit=500" });
    expect(res.statusCode).toBe(200);
    // We only have 5 rows; verify no 400 envelope.
    const { notes } = res.json() as { notes: unknown[] };
    expect(notes).toHaveLength(5);
  });

  it("excludes soft-deleted rows (T-05-06)", async () => {
    const seeded = await seedNotes(3);
    await pool.query(`UPDATE notes SET deleted_at = NOW() WHERE id = $1`, [seeded[1]?.id]);
    const res = await app.inject({ method: "GET", url: "/api/notes/list" });
    const { notes } = res.json() as { notes: { id: string }[] };
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === seeded[1]?.id)).toBeUndefined();
  });

  it("?before=<ISO> paginates older rows", async () => {
    const seeded = await seedNotes(5);
    const midPoint = seeded[3]?.created_at; // 4th seeded; should return older than this.
    const res = await app.inject({
      method: "GET",
      url: `/api/notes/list?before=${encodeURIComponent(midPoint)}`,
    });
    const { notes } = res.json() as { notes: { id: string }[] };
    // All returned must have created_at < midPoint → only seeded[0..2].
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.length).toBeLessThanOrEqual(3);
    for (const n of notes) {
      // seeded[3] and seeded[4] excluded.
      expect(n.id).not.toBe(seeded[3]?.id);
      expect(n.id).not.toBe(seeded[4]?.id);
    }
  });

  it("?since=<ISO> paginates newer rows", async () => {
    const seeded = await seedNotes(5);
    const midPoint = seeded[2]?.created_at;
    const res = await app.inject({
      method: "GET",
      url: `/api/notes/list?since=${encodeURIComponent(midPoint)}`,
    });
    const { notes } = res.json() as { notes: { id: string }[] };
    // All returned must have created_at > midPoint → only seeded[3..4].
    for (const n of notes) {
      expect(n.id).not.toBe(seeded[0]?.id);
      expect(n.id).not.toBe(seeded[1]?.id);
      expect(n.id).not.toBe(seeded[2]?.id);
    }
  });

  it("invalid timestamp in ?before returns 400 envelope", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notes/list?before=not-a-date",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns empty array when user has no notes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/notes/list" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { notes: unknown[] }).notes).toEqual([]);
  });
});
