// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-04 — migration 0019b drops the
// `lookup_session_by_previous_token(text)` SECURITY DEFINER function.
//
// Confirms post-migration:
//   1. pg_proc no longer contains `lookup_session_by_previous_token`
//      under ANY signature (the 0001 bytea form was dropped by 0005;
//      the 0005 text form is dropped by 0019b).
//   2. `previous_token_fp` column + `sessions_previous_token_fp_idx`
//      remain (Plan 33-05 may NOT-NULL the column; 33-04 only drops
//      the SECURITY DEFINER path).

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

describe("0019b migration — drops lookup_session_by_previous_token SECURITY DEFINER function", () => {
  let booted: BootResult;

  beforeAll(async () => {
    booted = await bootMigratedPostgres();
  }, 120_000);

  afterAll(async () => {
    await booted.stop();
  });

  it("pg_proc has no `lookup_session_by_previous_token` function of any signature", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_proc
          WHERE proname = 'lookup_session_by_previous_token'`,
      );
      expect(rows[0]?.count).toBe("0");
    } finally {
      await pool.end();
    }
  });

  it("`sessions.previous_token_fp` column survives the drop", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name = 'sessions' AND column_name = 'previous_token_fp'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data_type).toBe("bytea");
    } finally {
      await pool.end();
    }
  });

  it("`sessions_previous_token_fp_idx` partial index survives the drop", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE indexname = 'sessions_previous_token_fp_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/previous_token_fp/);
      expect(rows[0]?.indexdef).toMatch(/WHERE.*previous_token_fp IS NOT NULL/);
    } finally {
      await pool.end();
    }
  });
});
