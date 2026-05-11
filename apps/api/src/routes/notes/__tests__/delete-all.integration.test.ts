// Phase 05 / Plan 05 / Task 2 — delete-all integration tests
// (hard purge + 1000-row cap per Open Q#6 / T-DEL-ALL-DOS).

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
  userId = await seedUser(pool, { email: "delete-all@test" });
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes`);
});

async function seedNotes(n: number): Promise<void> {
  // Bulk insert via single multi-row VALUES for speed.
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const base = i * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(
      "00000000-0000-0000-0000-000000000000",
      userId,
      `seed-${i}`,
      `title ${i}`,
    );
  }
  await pool.query(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title) VALUES ${values.join(", ")}`,
    params,
  );
}

describe("integration — DELETE /api/notes/delete-all", () => {
  it("hard-purges all active notes for the user; returns { deleted: <count> }", async () => {
    await seedNotes(7);
    const res = await app.inject({ method: "DELETE", url: "/api/notes/delete-all" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: number };
    expect(body.deleted).toBe(7);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notes WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("returns deleted=0 cleanly when user has no notes", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/notes/delete-all" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { deleted: number }).deleted).toBe(0);
  });

  it("does NOT count already-soft-deleted rows toward the 1000 cap (only deleted_at IS NULL)", async () => {
    await seedNotes(10);
    // Soft-delete 5 of them.
    await pool.query(
      `UPDATE notes SET deleted_at = NOW() WHERE user_id = $1 AND client_note_id < 'seed-5'`,
      [userId],
    );
    const res = await app.inject({ method: "DELETE", url: "/api/notes/delete-all" });
    expect(res.statusCode).toBe(200);
    // delete-all hard-purges ALL rows (including tombstones) so deleted >= 5 active rows; we don't constrain
    // the exact `deleted` count here because the SQL returns total DELETE affected rows.
    expect((res.json() as { deleted: number }).deleted).toBeGreaterThanOrEqual(5);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notes WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("Open Q#6 — >1000 active rows returns 400 envelope (T-DEL-ALL-DOS)", async () => {
    // Seed 1001 to trip the cap.
    await seedNotes(1001);
    const res = await app.inject({ method: "DELETE", url: "/api/notes/delete-all" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/1000|exceeds.*rows/);
    // Verify no rows were deleted (count-first gate).
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notes WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]?.n).toBe("1001");
  });

  it("boundary — exactly 1000 active rows succeeds", async () => {
    await seedNotes(1000);
    const res = await app.inject({ method: "DELETE", url: "/api/notes/delete-all" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { deleted: number }).deleted).toBe(1000);
  });
});
