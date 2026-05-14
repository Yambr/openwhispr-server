// SPDX-License-Identifier: FSL-1.1-ALv2
// DATA-03 — usage_ledger idempotency on request_id.
//
// Inserts a ledger row, then re-inserts the same request_id; the second
// insert MUST raise a unique-violation (Postgres SQLSTATE 23505). This
// test runs as openwhispr_owner so RLS is bypassed (we are testing the
// ledger constraint, not RLS).

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";

let booted: BootResult;
let userId: string;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  const pool = new Pool({ connectionString: booted.ownerUri });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email)
             VALUES ($1, $2) RETURNING id`,
      [DEFAULT_TENANT_ID, "ledger-test@example.com"],
    );
    userId = rows[0]?.id;
  } finally {
    await pool.end();
  }
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("DATA-03 — usage_ledger idempotency", () => {
  it("first insert with a fresh request_id succeeds", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      await pool.query(
        `INSERT INTO usage_ledger
                    (tenant_id, user_id, request_id, kind, units)
                 VALUES ($1, $2, $3, $4, $5)`,
        [DEFAULT_TENANT_ID, userId, "req-unique-1", "transcribe", 60],
      );
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM usage_ledger WHERE request_id = $1`,
        ["req-unique-1"],
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await pool.end();
    }
  });

  it("re-inserting the same request_id raises a unique violation", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      await pool.query(
        `INSERT INTO usage_ledger
                    (tenant_id, user_id, request_id, kind, units)
                 VALUES ($1, $2, $3, $4, $5)`,
        [DEFAULT_TENANT_ID, userId, "req-unique-2", "transcribe", 60],
      );
      await expect(
        pool.query(
          `INSERT INTO usage_ledger
                        (tenant_id, user_id, request_id, kind, units)
                     VALUES ($1, $2, $3, $4, $5)`,
          [DEFAULT_TENANT_ID, userId, "req-unique-2", "reason", 1],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await pool.end();
    }
  });
});
