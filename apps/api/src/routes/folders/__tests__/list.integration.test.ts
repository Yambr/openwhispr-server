// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 06 / Task 1 — folders list integration tests
// (keyset pagination + soft-delete + limit clamp + before/since
// intersection).
//
// Mirrors apps/api/src/routes/notes/__tests__/list.integration.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { bootMigratedPostgres, buildTestApp, seedUser } from "./setup.js";

let pool: Pool;
let shutdown: () => Promise<void>;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  userId = await seedUser(pool, { email: "folders-list@test" });
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM folders`);
});

async function seedFolders(n: number): Promise<{ id: string; created_at: string }[]> {
  const out: { id: string; created_at: string }[] = [];
  for (let i = 0; i < n; i++) {
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO folders (tenant_id, user_id, client_folder_id, name, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
      [
        "00000000-0000-0000-0000-000000000000",
        userId,
        `f-seed-${i}`,
        `Folder ${i}`,
        new Date(Date.now() - (n - i) * 1000),
      ],
    );
    out.push({ id: rows[0]!.id, created_at: rows[0]!.created_at.toISOString() });
  }
  return out;
}

describe("integration — GET /api/folders/list", () => {
  it("returns rows ordered by created_at DESC, id DESC", async () => {
    const seeded = await seedFolders(5);
    const res = await app.inject({ method: "GET", url: "/api/folders/list" });
    expect(res.statusCode).toBe(200);
    const { folders } = res.json() as { folders: { id: string }[] };
    expect(folders).toHaveLength(5);
    // Most-recently-created first.
    expect(folders[0]!.id).toBe(seeded[4]!.id);
    expect(folders[4]!.id).toBe(seeded[0]!.id);
  });

  it("respects ?limit=3 query param", async () => {
    await seedFolders(8);
    const res = await app.inject({ method: "GET", url: "/api/folders/list?limit=3" });
    const { folders } = res.json() as { folders: unknown[] };
    expect(folders).toHaveLength(3);
  });

  it("D-25 — clamps ?limit=500 to 200 max (no 400)", async () => {
    await seedFolders(5);
    const res = await app.inject({ method: "GET", url: "/api/folders/list?limit=500" });
    expect(res.statusCode).toBe(200);
    const { folders } = res.json() as { folders: unknown[] };
    expect(folders).toHaveLength(5);
  });

  it("excludes soft-deleted rows (T-05-06)", async () => {
    const seeded = await seedFolders(3);
    await pool.query(`UPDATE folders SET deleted_at = NOW() WHERE id = $1`, [seeded[1]!.id]);
    const res = await app.inject({ method: "GET", url: "/api/folders/list" });
    const { folders } = res.json() as { folders: { id: string }[] };
    expect(folders).toHaveLength(2);
    expect(folders.find((f) => f.id === seeded[1]!.id)).toBeUndefined();
  });

  it("?before=<ISO> paginates older rows", async () => {
    const seeded = await seedFolders(5);
    const midPoint = seeded[3]!.created_at;
    const res = await app.inject({
      method: "GET",
      url: `/api/folders/list?before=${encodeURIComponent(midPoint)}`,
    });
    const { folders } = res.json() as { folders: { id: string }[] };
    expect(folders.length).toBeGreaterThanOrEqual(2);
    expect(folders.length).toBeLessThanOrEqual(3);
    for (const f of folders) {
      expect(f.id).not.toBe(seeded[3]!.id);
      expect(f.id).not.toBe(seeded[4]!.id);
    }
  });

  it("?since=<ISO> paginates newer rows", async () => {
    const seeded = await seedFolders(5);
    const midPoint = seeded[2]!.created_at;
    const res = await app.inject({
      method: "GET",
      url: `/api/folders/list?since=${encodeURIComponent(midPoint)}`,
    });
    const { folders } = res.json() as { folders: { id: string }[] };
    for (const f of folders) {
      expect(f.id).not.toBe(seeded[0]!.id);
      expect(f.id).not.toBe(seeded[1]!.id);
      expect(f.id).not.toBe(seeded[2]!.id);
    }
  });

  it("?before AND ?since together intersect (both bounds applied)", async () => {
    const seeded = await seedFolders(5);
    const lower = seeded[1]!.created_at; // older bound (since > lower)
    const upper = seeded[4]!.created_at; // newer bound (before < upper)
    const res = await app.inject({
      method: "GET",
      url: `/api/folders/list?since=${encodeURIComponent(lower)}&before=${encodeURIComponent(upper)}`,
    });
    expect(res.statusCode).toBe(200);
    const { folders } = res.json() as { folders: { id: string }[] };
    // Strict bounds: created_at > seeded[1] AND created_at < seeded[4].
    // So eligible rows are seeded[2], seeded[3].
    expect(folders.length).toBeGreaterThanOrEqual(1);
    expect(folders.length).toBeLessThanOrEqual(2);
    for (const f of folders) {
      expect(f.id).not.toBe(seeded[0]!.id);
      expect(f.id).not.toBe(seeded[1]!.id);
      expect(f.id).not.toBe(seeded[4]!.id);
    }
  });

  it("invalid timestamp in ?before returns 400 envelope", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/folders/list?before=not-a-date",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns empty array when user has no folders", async () => {
    const res = await app.inject({ method: "GET", url: "/api/folders/list" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { folders: unknown[] }).folders).toEqual([]);
  });
});
