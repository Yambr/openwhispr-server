// SPDX-License-Identifier: Apache-2.0
// DATA-04 — audit_log JSONB roundtrip + B-tree index on created_at.
//
// Asserts that:
//   1. A JSONB payload (with nested keys + numeric values) survives a
//      write/read roundtrip byte-equal at the JSON level.
//   2. A B-tree index on `created_at` is registered in pg_indexes.
//      A GIN index on `payload` is intentionally NOT required for v1
//      (deferred per RESEARCH-DB; revisit when audit-log query volume
//      makes it warranted).

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";

let booted: BootResult;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("DATA-04 — audit_log", () => {
  it("preserves nested JSONB payloads byte-equal", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const payload = { nested: { key: "value" }, n: 1, list: [1, 2, 3] };
      const { rows: ins } = await pool.query<{ id: string }>(
        `INSERT INTO audit_log (tenant_id, action, payload)
                 VALUES ($1, $2, $3::jsonb)
                 RETURNING id`,
        // Phase 6 / Plan 02 — `action` is now CHECK-constrained to the
        // 18 canonical D-A6 values. Use `auth.signin` as a generic
        // canonical action to exercise JSONB-payload round-trip.
        [DEFAULT_TENANT_ID, "auth.signin", JSON.stringify(payload)],
      );
      const { rows } = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM audit_log WHERE id = $1`,
        [ins[0]?.id],
      );
      expect(rows[0]?.payload).toEqual(payload);
    } finally {
      await pool.end();
    }
  });

  it("registers a B-tree index on created_at", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
                 WHERE tablename = 'audit_log'
                   AND indexname = 'audit_log_created_at_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/btree.*created_at/i);
    } finally {
      await pool.end();
    }
  });
});
