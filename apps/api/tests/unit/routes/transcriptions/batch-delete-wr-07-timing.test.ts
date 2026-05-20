// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-07 regression test (real Postgres + RLS).
//
// WR-07 (security) — transcriptions/batch-delete.ts compares
// `returnedIds.length !== requestedIds.length` to throw NotFoundError. The
// all-hit path runs a full `UPDATE … RETURNING`; the all-miss path returns an
// empty RETURNING and rolls back — Postgres does measurably less work on a
// miss, so raw response timing oracles cross-tenant id existence at large
// batch sizes.
//
// The fix equalizes the failure path with a constant-time wall-clock floor
// (FAILURE_PATH_FLOOR_MS) measured from handler entry. This test asserts the
// regression-shape two ways:
//   1. structural — an all-miss 500-id batch takes AT LEAST the floor (the
//      failure path is no longer a fast-fail), and
//   2. comparative — the all-miss median is NOT systematically faster than
//      the all-hit median (the timing oracle is closed).
//
// Timing measurements are inherently noisy; the comparative assertion uses
// medians of K runs + a generous tolerance — its job is to show no
// *systematic* fast-fail delta, which the structural floor guarantees.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../src/routes/transcriptions/__tests__/setup.js";
import { getSharedRoutePool } from "../../../support/shared-route-pool.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let userA: string;
let appA: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const ra = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_A, "wr07-a@test"],
  );
  userA = ra.rows[0]!.id;
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM transcriptions`);
});

async function createTx(clientId: string): Promise<string> {
  const res = await appA.inject({
    method: "POST",
    url: "/api/transcriptions/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ client_transcription_id: clientId, text: `t-${clientId}` }),
  });
  return (res.json() as { id: string }).id;
}

function fakeUuid(i: number): string {
  return `${String(i + 1).padStart(8, "0")}-9999-4999-8999-999999999999`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

async function timeBatchDelete(ids: string[]): Promise<{ status: number; ms: number }> {
  const t0 = performance.now();
  const res = await appA.inject({
    method: "POST",
    url: "/api/transcriptions/batch-delete",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ ids }),
  });
  return { status: res.statusCode, ms: performance.now() - t0 };
}

describe("integration — WR-07 batch-delete timing oracle (real Postgres)", () => {
  it("WR-07: an all-miss 500-id batch is not a fast-fail (constant-time floor enforced)", async () => {
    // 500 random UUIDs, none owned → all-miss → 404. The failure path must
    // wait out the constant-time floor instead of returning immediately.
    const fakes = Array.from({ length: 500 }, (_, i) => fakeUuid(i));
    const { status, ms } = await timeBatchDelete(fakes);
    expect(status).toBe(404);
    // FAILURE_PATH_FLOOR_MS is 750ms; allow a small scheduler slack below.
    expect(ms).toBeGreaterThanOrEqual(700);
  }, 30_000);

  it("WR-07: all-miss median is not systematically faster than all-hit median", async () => {
    const K = 5;
    const hitMs: number[] = [];
    const missMs: number[] = [];

    for (let run = 0; run < K; run++) {
      // All-hit: seed 200 owned rows, delete them in one batch (200 → cap-safe).
      const ids: string[] = [];
      for (let i = 0; i < 200; i++) ids.push(await createTx(`wr07-hit-${run}-${i}`));
      const hit = await timeBatchDelete(ids);
      expect(hit.status).toBe(200);
      hitMs.push(hit.ms);

      // All-miss: 200 random UUIDs.
      const fakes = Array.from({ length: 200 }, (_, i) => fakeUuid(run * 1000 + i));
      const miss = await timeBatchDelete(fakes);
      expect(miss.status).toBe(404);
      missMs.push(miss.ms);

      await pool.query(`DELETE FROM transcriptions`);
    }

    const hitMed = median(hitMs);
    const missMed = median(missMs);
    // The oracle is closed when the failure path is NOT meaningfully faster
    // than the success path. Pre-fix the all-miss fast-fail made missMed
    // far smaller; with the constant-time floor missMed >= hitMed - slack.
    expect(missMed).toBeGreaterThanOrEqual(hitMed - 150);
  }, 60_000);
});
