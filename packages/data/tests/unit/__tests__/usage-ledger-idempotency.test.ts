// SPDX-License-Identifier: Apache-2.0
// Phase 03 / Plan 10 / Task 1 — DATA-03 schema-level idempotency property test.
//
// Complementary to packages/data/src/__tests__/usage-ledger.test.ts which
// asserts the bare unique-violation (SQLSTATE 23505) on duplicate request_id.
// THIS file exercises the production INSERT pattern used by the api routes
// (`ON CONFLICT (request_id) DO NOTHING`) — first-writer-wins semantics —
// and a property-style replay loop confirming distinct(request_id) is
// stable across N inserts + N replays.
//
// The two tests together close the DATA-03 invariant from BOTH directions:
//   (a) usage-ledger.test.ts  — naked INSERT raises 23505 on dup request_id.
//   (b) THIS file              — INSERT ... ON CONFLICT DO NOTHING is a
//                                no-op; first writer wins; replay stable.
//
// Real Postgres testcontainer + real DDL only (CLAUDE.md: no mocks). The
// helper bootMigratedPostgres() runs the openwhispr migrations so the
// usage_ledger table + uniqueIndex(request_id) are exactly as production.
//
// Threat model (T-03-10-04 — accepted): this test runs as openwhispr_owner
// (BYPASSRLS) deliberately to focus on the UNIQUE-INDEX behavior. RLS
// isolation is the responsibility of the rls-property test in this same
// directory; reproducing RLS here would dilute the assertion target.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";

let booted: BootResult;
let pool: Pool;
let userId: string;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  pool = new Pool({ connectionString: booted.ownerUri });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email)
       VALUES ($1, $2) RETURNING id`,
    [DEFAULT_TENANT_ID, "ledger-idempotency-test@example.com"],
  );
  userId = rows[0]?.id;
}, 120_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (booted) await booted.stop();
}, 60_000);

describe("DATA-03 — usage_ledger ON CONFLICT DO NOTHING (first-writer-wins)", () => {
  it("re-INSERT with same request_id is a no-op — first row's units preserved", async () => {
    const rid = "rid-on-conflict-1";
    // First insert: units = 10.
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
       VALUES ($1, $2, $3, 'reason_tokens', 10)
       ON CONFLICT (request_id) DO NOTHING`,
      [DEFAULT_TENANT_ID, userId, rid],
    );
    // Second insert: SAME request_id, DIFFERENT units (999) — must no-op.
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
       VALUES ($1, $2, $3, 'reason_tokens', 999)
       ON CONFLICT (request_id) DO NOTHING`,
      [DEFAULT_TENANT_ID, userId, rid],
    );
    const { rows } = await pool.query<{ count: string; units: number }>(
      `SELECT count(*)::text AS count, MAX(units)::int AS units
         FROM usage_ledger WHERE request_id = $1`,
      [rid],
    );
    expect(rows[0]?.count).toBe("1");
    // First-writer-wins: surviving row carries the FIRST insert's units.
    expect(rows[0]?.units).toBe(10);
  });

  it("ON CONFLICT DO NOTHING tolerates kind cross-write (transcribe vs reason)", async () => {
    // Plan 04 emits kind='transcribe'; Plan 05 emits kind='reason_tokens'.
    // Both share the same idempotency key namespace (request_id is GLOBAL
    // unique). Re-posting the same request_id with a DIFFERENT kind must
    // still no-op rather than land a second ledger row.
    const rid = "rid-cross-kind-1";
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
       VALUES ($1, $2, $3, 'transcribe', 60)
       ON CONFLICT (request_id) DO NOTHING`,
      [DEFAULT_TENANT_ID, userId, rid],
    );
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
       VALUES ($1, $2, $3, 'reason_tokens', 1)
       ON CONFLICT (request_id) DO NOTHING`,
      [DEFAULT_TENANT_ID, userId, rid],
    );
    const { rows } = await pool.query<{ count: string; kind: string }>(
      `SELECT count(*)::text AS count, MAX(kind) AS kind
         FROM usage_ledger WHERE request_id = $1`,
      [rid],
    );
    expect(rows[0]?.count).toBe("1");
    expect(rows[0]?.kind).toBe("transcribe"); // first writer wins
  });

  it("property: N random rows + full replay → distinct(request_id) count stable", async () => {
    // Generate 50 random rows, insert all, then insert the SAME batch a
    // second time — the second pass MUST be a perfect no-op. Distinct
    // request_id count after pass 1 == count after pass 2.
    const N = 50;
    const batch: Array<{ rid: string; kind: string; units: number }> = [];
    for (let i = 0; i < N; i++) {
      batch.push({
        rid: `rid-prop-${i}-${Math.random().toString(36).slice(2, 10)}`,
        kind: i % 2 === 0 ? "transcribe" : "reason_tokens",
        units: 1 + Math.floor(Math.random() * 100),
      });
    }
    const insertOne = async (b: { rid: string; kind: string; units: number }) =>
      pool.query(
        `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (request_id) DO NOTHING`,
        [DEFAULT_TENANT_ID, userId, b.rid, b.kind, b.units],
      );

    // Pass 1.
    for (const row of batch) await insertOne(row);
    const after1 = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM usage_ledger
         WHERE request_id LIKE 'rid-prop-%'`,
    );
    expect(after1.rows[0]?.count).toBe(String(N));

    // Pass 2 (replay) — every row should ON CONFLICT no-op.
    for (const row of batch) await insertOne(row);
    const after2 = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM usage_ledger
         WHERE request_id LIKE 'rid-prop-%'`,
    );
    expect(after2.rows[0]?.count).toBe(String(N));
  });
});
