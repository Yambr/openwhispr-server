// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-05 — migration 0020: drop plaintext credential columns.
//
// Forward + down test pair for the closing migration of CRIT-FIX-02.
// Assertions:
//   1. All 8 plaintext credential columns are gone from
//      account / verification / sessions / oauth_state.
//   2. The plaintext-era indexes (sessions_token_unique +
//      sessions_previous_token_idx) are gone.
//   3. sessions_token_fp_unique is a full UNIQUE INDEX (no WHERE).
//   4. sessions.token_fp is NOT NULL.
//   5. sessions.previous_token_fp is nullable (overlap-window optional).
//   6. The 48 bytea sidecars + previous_token_fp are still present.
//   7. The down migration restores plaintext columns + plaintext-era
//      indexes (rescue path; data is not recovered).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/migrations/__tests__ -> packages/data/migrations
const MIGRATIONS_DIR = resolve(__dirname, "..");
const DOWN_SQL_PATH = resolve(
  MIGRATIONS_DIR,
  "0020_envelope_encrypt_secret_columns_drop_plaintext.down.sql",
);

const PLAINTEXT_TARGETS = [
  { table: "account", column: "access_token" },
  { table: "account", column: "refresh_token" },
  { table: "account", column: "id_token" },
  { table: "account", column: "password" },
  { table: "verification", column: "value" },
  { table: "sessions", column: "token" },
  { table: "sessions", column: "previous_token" },
  { table: "oauth_state", column: "code_verifier" },
] as const;

const SIDECAR_SUFFIXES = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

let boot: BootResult | undefined;

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
}, 240_000);

afterAll(async () => {
  if (boot) await boot.stop();
}, 60_000);

describe("0020 forward: 8 plaintext credential columns are dropped", () => {
  for (const target of PLAINTEXT_TARGETS) {
    it(`${target.table}.${target.column} no longer exists`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2`,
          [target.table, target.column],
        );
        expect(rows[0]!.count).toBe("0");
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0020 forward: plaintext-era indexes removed", () => {
  it("sessions_token_unique is gone", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_indexes
          WHERE schemaname='public' AND indexname='sessions_token_unique'`,
      );
      expect(rows[0]!.count).toBe("0");
    } finally {
      await pool.end();
    }
  });

  it("sessions_previous_token_idx is gone", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_indexes
          WHERE schemaname='public' AND indexname='sessions_previous_token_idx'`,
      );
      expect(rows[0]!.count).toBe("0");
    } finally {
      await pool.end();
    }
  });
});

describe("0020 forward: sessions_token_fp_unique is a full UNIQUE INDEX", () => {
  it("sessions_token_fp_unique no longer has a WHERE clause", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname='public' AND tablename='sessions'
            AND indexname='sessions_token_fp_unique'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0]!.indexdef;
      expect(def).toMatch(/CREATE UNIQUE INDEX/i);
      expect(def).toMatch(/\(token_fp\)/i);
      // Full unique, NOT partial — the WHERE clause is gone.
      expect(def).not.toMatch(/WHERE/i);
    } finally {
      await pool.end();
    }
  });
});

describe("0020 forward: sessions.token_fp is NOT NULL; previous_token_fp stays nullable", () => {
  it("sessions.token_fp is NOT NULL", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sessions' AND column_name='token_fp'`,
      );
      expect(rows[0]!.is_nullable).toBe("NO");
    } finally {
      await pool.end();
    }
  });

  it("sessions.previous_token_fp stays nullable (overlap-window optional)", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sessions' AND column_name='previous_token_fp'`,
      );
      expect(rows[0]!.is_nullable).toBe("YES");
    } finally {
      await pool.end();
    }
  });
});

describe("0020 forward: 48 bytea sidecars survive", () => {
  it("48 bytea sidecar columns remain across the 4 target tables", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const suffixPattern = SIDECAR_SUFFIXES.join("|");
      const columnPattern =
        "^(access_token|refresh_token|id_token|password|value|token|previous_token|code_verifier)_(" +
        suffixPattern +
        ")$";
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name IN ('account','verification','sessions','oauth_state')
            AND column_name ~ $1
            AND data_type = 'bytea'`,
        [columnPattern],
      );
      expect(rows[0]!.count).toBe("48");
    } finally {
      await pool.end();
    }
  });
});

describe("0020 down: rescue script restores plaintext shape", () => {
  it("down SQL exists at the documented path and declares the rescue DDL", () => {
    const sql = readFileSync(DOWN_SQL_PATH, "utf8");
    expect(sql).toMatch(/ADD COLUMN\s+"?access_token"?\s+text/i);
    expect(sql).toMatch(/ADD COLUMN\s+"?password"?\s+text/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX\s+"?sessions_token_unique"?/i);
    expect(sql).toMatch(/sessions_previous_token_idx/i);
  });

  it("applying down DDL restores plaintext columns + plaintext-era indexes + nullable token_fp", async () => {
    const sql = readFileSync(DOWN_SQL_PATH, "utf8");
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      await pool.query(sql);

      // 1) Plaintext columns restored.
      const { rows: ptRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
          WHERE table_schema='public'
            AND (
              (table_name='account' AND column_name IN ('access_token','refresh_token','id_token','password'))
              OR (table_name='verification' AND column_name='value')
              OR (table_name='sessions' AND column_name IN ('token','previous_token'))
              OR (table_name='oauth_state' AND column_name='code_verifier')
            )`,
      );
      expect(ptRows[0]!.count).toBe("8");

      // 2) sessions_token_unique back.
      const { rows: tokIdx } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_indexes
          WHERE schemaname='public' AND indexname='sessions_token_unique'`,
      );
      expect(tokIdx[0]!.count).toBe("1");

      // 3) token_fp nullable again.
      const { rows: nullRows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sessions' AND column_name='token_fp'`,
      );
      expect(nullRows[0]!.is_nullable).toBe("YES");
    } finally {
      await pool.end();
    }
  });
});
