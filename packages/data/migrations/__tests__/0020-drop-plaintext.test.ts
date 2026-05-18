// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-05 — migration 0020: drop plaintext credential columns.
// Plan 51-23/24/25 amendment — Better Auth introspection compat columns
// restored as nullable, no-DEFAULT sentinels (migrations 0024/0025/0026);
// LOCKER-08 amended with inline LENS_INTROSPECTION_COMPAT allowlist of
// EXACTLY 7 file:column tuples.
//
// This sentinel's purpose AFTER the amendment:
//
//   The 7 LENS_INTROSPECTION_COMPAT plaintext columns
//   (account.{password,access_token,refresh_token,id_token},
//   verification.value, sessions.{token,previous_token}) MUST coexist
//   with the full 6-bytea sidecar set per credential AND be:
//   (a) nullable (no NOT NULL constraint)
//   (b) without a DEFAULT
//   (c) the ONLY plaintext credential survivors
//     — `oauth_state.code_verifier` MUST still be gone (NOT in allowlist).
//
//   sessions.token_fp is now NULLABLE (Plan 51-24, migration 0026)
//   because Better Auth bypasses the encryption lens for sessions-table
//   writes and the lens-generated fingerprint never lands; the session-
//   uniqueness contract is preserved at the plaintext-`token` layer
//   via the new partial UNIQUE INDEX `sessions_token_unique_partial`.
//
//   sessions.previous_token_fp stays nullable (overlap-window optional).
//
//   sessions_token_fp_unique stays as a full (non-partial) UNIQUE INDEX
//   on token_fp — preserved from Plan 33-05 since the fingerprint slot
//   continues to enforce uniqueness for any non-Better-Auth write
//   paths that DO route through the lens.
//
//   All 48 bytea sidecars (8 plaintext targets × 6 sidecars) survive.
//
// Inverted-mutation validation: this test must STILL FAIL if a future
// refactor (a) drops one of the 7 LENS_INTROSPECTION_COMPAT columns
// without updating the allowlist, (b) adds a DEFAULT or NOT NULL to
// any of them, (c) drops any bytea sidecar, (d) drops either
// uniqueness contract (`sessions_token_fp_unique` full OR
// `sessions_token_unique_partial`), (e) re-introduces
// `oauth_state.code_verifier`, or (f) silently expands the
// LENS_INTROSPECTION_COMPAT allowlist to cover a new column not
// enumerated here. The set of allowed plaintext survivors is
// hard-coded; tests for any future addition must extend BOTH the
// LOCKER-08 inline allowlist AND this hard-coded set.

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

// The 7 plaintext columns that LENS_INTROSPECTION_COMPAT allows post
// migrations 0024/0025/0026. MUST match
// `tools/lint-no-plaintext-secret-columns.ts:LENS_INTROSPECTION_COMPAT`
// 1:1 (sans path prefix). Any drift between this list and the locker
// allowlist is a constitutional regression.
const COMPAT_PLAINTEXT_SURVIVORS = [
  { table: "account", column: "password" },
  { table: "account", column: "access_token" },
  { table: "account", column: "refresh_token" },
  { table: "account", column: "id_token" },
  { table: "verification", column: "value" },
  { table: "sessions", column: "token" },
  { table: "sessions", column: "previous_token" },
] as const;

// Plaintext columns that must STILL be gone (NOT in
// LENS_INTROSPECTION_COMPAT). `oauth_state.code_verifier` was dropped
// in 0020 and was NEVER restored — it has no Better Auth-introspection
// dependency, so the envelope-encryption-only posture stands for it.
const DROPPED_PLAINTEXT_TARGETS = [{ table: "oauth_state", column: "code_verifier" }] as const;

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

describe("0020 forward + 0024/0025/0026 amendment: only `oauth_state.code_verifier` stays dropped", () => {
  for (const target of DROPPED_PLAINTEXT_TARGETS) {
    it(`${target.table}.${target.column} no longer exists (NOT in LENS_INTROSPECTION_COMPAT)`, async () => {
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

describe("0025/0026 amendment: the 7 LENS_INTROSPECTION_COMPAT plaintext columns exist as nullable, no-DEFAULT sentinels", () => {
  for (const target of COMPAT_PLAINTEXT_SURVIVORS) {
    it(`${target.table}.${target.column} exists, is text, nullable, no DEFAULT`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `SELECT data_type, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2`,
          [target.table, target.column],
        );
        expect(rows, `${target.table}.${target.column} must exist`).toHaveLength(1);
        expect(rows[0]!.data_type).toBe("text");
        expect(rows[0]!.is_nullable).toBe("YES");
        expect(rows[0]!.column_default).toBeNull();
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0020 forward: plaintext-era pre-encryption sessions_previous_token_idx is gone", () => {
  // sessions_token_unique was the unique-on-plaintext-token index from
  // Plan 02.12. It was dropped by 0020; migration 0026 re-introduces a
  // DIFFERENT partial-unique index named `sessions_token_unique_partial`
  // to preserve the same uniqueness contract under the amendment.
  // The OLD name (`sessions_token_unique`) MUST remain absent — a future
  // refactor that recreates it would risk colliding with the partial
  // index name and silently breaking the contract semantics.
  it("legacy sessions_token_unique is gone (renamed to sessions_token_unique_partial under 0026)", async () => {
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

  it("sessions_previous_token_idx is gone (no plaintext-era lookup)", async () => {
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

describe("uniqueness contract: both fp-layer AND amendment plaintext-layer indexes coexist", () => {
  it("sessions_token_fp_unique is a full UNIQUE INDEX on token_fp (no WHERE) — fingerprint-layer contract from Plan 33-05", async () => {
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
      // Full unique, NOT partial — preserved from Plan 33-05.
      expect(def).not.toMatch(/WHERE/i);
    } finally {
      await pool.end();
    }
  });

  it("sessions_token_unique_partial is a partial UNIQUE INDEX on plaintext token — amendment contract from Plan 51-24", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname='public' AND tablename='sessions'
            AND indexname='sessions_token_unique_partial'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0]!.indexdef;
      expect(def).toMatch(/CREATE UNIQUE INDEX/i);
      expect(def).toMatch(/\(token\)/i);
      // Partial — Postgres-MVCC NULL coexistence at fp layer demands
      // this to be partial on the plaintext side (Better Auth-bypass
      // writes never populate token_fp).
      expect(def).toMatch(/WHERE.*token.*IS NOT NULL/i);
    } finally {
      await pool.end();
    }
  });
});

describe("0026 amendment: sessions.token_fp nullable; sessions.previous_token_fp still nullable", () => {
  it("sessions.token_fp is NULLABLE (Plan 51-24 — lens bypass for Better Auth writes)", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sessions' AND column_name='token_fp'`,
      );
      expect(rows[0]!.is_nullable).toBe("YES");
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

describe("envelope-encryption posture: 48 bytea sidecars survive across all 4 target tables", () => {
  it("48 bytea sidecar columns remain across the 4 target tables (8 targets × 6 sidecars)", async () => {
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

describe("0020 down: rescue script unchanged — restores original Phase 33 pre-amendment shape", () => {
  it("down SQL exists at the documented path and declares the rescue DDL", () => {
    const sql = readFileSync(DOWN_SQL_PATH, "utf8");
    expect(sql).toMatch(/ADD COLUMN\s+"?access_token"?\s+text/i);
    expect(sql).toMatch(/ADD COLUMN\s+"?password"?\s+text/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX\s+"?sessions_token_unique"?/i);
    expect(sql).toMatch(/sessions_previous_token_idx/i);
  });

  // The applying-down test from the pre-amendment era is no longer
  // meaningful: applying 0020.down.sql on top of 0025/0026 would attempt
  // to recreate columns that 0025 already restored, raising a duplicate-
  // column error. The down path's operational role is now "rescue for
  // a pristine-post-0020 state, ahead of 0024/0025/0026" — exercised
  // by the dedicated rescue-from-pristine tests in
  // packages/data/migrations/__tests__/0025-better-auth-account-plaintext-compat.test.ts
  // (forward+down pair scoped to its own checkpoint). Sweeping it
  // here would couple two independent migration contracts.
});
