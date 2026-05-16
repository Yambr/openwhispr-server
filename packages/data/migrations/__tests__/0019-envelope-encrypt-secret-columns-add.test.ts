// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-01 — migration 0019: additive bytea sidecars +
// SHA-256 fingerprint sidecars for envelope encryption (CRIT-FIX-02 step 1).
//
// This migration is ADDITIVE-ONLY:
//
//   - For each of the 8 credential columns
//     (`account.{access_token, refresh_token, id_token, password}`,
//      `verification.value`,
//      `sessions.{token, previous_token}`,
//      `oauth_state.code_verifier`)
//     it adds 6 nullable bytea sidecars matching the `EncryptedRow` shape
//     declared in `packages/data/src/encryption/envelope.ts:37-44`:
//     `{ dek_wrapped, dek_iv, dek_auth_tag, value_iv, value_auth_tag,
//        value_ciphertext }`.
//   - It adds two nullable bytea SHA-256 fingerprint sidecars on `sessions`:
//     `token_fp` and `previous_token_fp` — needed to preserve O(log N)
//     `lookupByToken` once the plaintext columns are dropped (research
//     §Q4 / pitfall #3). The NOT-NULL flip on `sessions.token_fp` is
//     deferred to migration 0020 (Plan 33-05) so the partial-unique
//     index pattern below is the canonical nullable-transition shape.
//   - Plaintext columns + their existing indexes are untouched. Tests
//     33-02..04 land in any rollback-safe order before 33-05 drops
//     plaintext.
//
// Per CLAUDE.md "no mocks of internal logic": real Postgres testcontainer,
// real DDL — never pg-mem.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/migrations/__tests__ -> packages/data/migrations
const MIGRATIONS_DIR = resolve(__dirname, "..");
const DOWN_SQL_PATH = resolve(MIGRATIONS_DIR, "0019_envelope_encrypt_secret_columns_add.down.sql");

// -- Column matrix ------------------------------------------------------
//
// 8 credential columns × 6 sidecars = 48 bytea sidecars.
// Plus 2 sessions fingerprint sidecars = 50 new bytea columns total.
//
// Encoded as a structure so both forward + rollback assertions iterate
// the same list (DRY — one source of truth for the 48-shape).

const SIDECAR_SUFFIXES = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

interface CredentialTarget {
  table: string;
  column: string;
}

const CREDENTIAL_TARGETS: CredentialTarget[] = [
  { table: "account", column: "access_token" },
  { table: "account", column: "refresh_token" },
  { table: "account", column: "id_token" },
  { table: "account", column: "password" },
  { table: "verification", column: "value" },
  { table: "sessions", column: "token" },
  { table: "sessions", column: "previous_token" },
  { table: "oauth_state", column: "code_verifier" },
];

const FINGERPRINT_COLUMNS = [
  { table: "sessions", column: "token_fp" },
  { table: "sessions", column: "previous_token_fp" },
] as const;

// Plaintext columns that MUST still exist after 0019 (additive only).
// Mirrors CREDENTIAL_TARGETS — the same columns, before the rename to
// sidecars. Listed explicitly so a stray DROP COLUMN in the forward
// migration would fail the additive-invariant check.
const PLAINTEXT_INVARIANTS: CredentialTarget[] = [...CREDENTIAL_TARGETS];

function sidecarColumnNames(t: CredentialTarget): string[] {
  return SIDECAR_SUFFIXES.map((suffix) => `${t.column}_${suffix}`);
}

let boot: BootResult | undefined;

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
}, 240_000);

afterAll(async () => {
  if (boot) await boot.stop();
}, 60_000);

describe("0019 forward: 48 bytea sidecars exist", () => {
  for (const target of CREDENTIAL_TARGETS) {
    for (const sidecar of sidecarColumnNames(target)) {
      it(`${target.table}.${sidecar} exists as nullable bytea`, async () => {
        const pool = new Pool({ connectionString: boot!.ownerUri });
        try {
          const { rows } = await pool.query<{
            data_type: string;
            is_nullable: string;
          }>(
            `SELECT data_type, is_nullable
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2`,
            [target.table, sidecar],
          );
          expect(rows).toHaveLength(1);
          expect(rows[0]!.data_type).toBe("bytea");
          expect(rows[0]!.is_nullable).toBe("YES");
        } finally {
          await pool.end();
        }
      });
    }
  }

  it("exactly 48 sidecar columns exist across the 4 target tables", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      // Build the OR-list explicitly so an accidental extra sidecar in
      // any one table fails the equality check below.
      const suffixPattern = SIDECAR_SUFFIXES.join("|");
      const columnPattern =
        "^(access_token|refresh_token|id_token|password|value|token|previous_token|code_verifier)_(" +
        suffixPattern +
        ")$";
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('account', 'verification', 'sessions', 'oauth_state')
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

describe("0019 forward: 2 sessions fingerprint sidecars exist", () => {
  for (const fp of FINGERPRINT_COLUMNS) {
    it(`${fp.table}.${fp.column} exists as nullable bytea`, async () => {
      // NOTE: NOT-NULL on sessions.token_fp is deferred to migration 0020
      // (Plan 33-05). The partial-unique index pattern (WHERE col IS NOT
      // NULL) allows the nullable-transition window between 0019 and 0020.
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{
          data_type: string;
          is_nullable: string;
        }>(
          `SELECT data_type, is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2`,
          [fp.table, fp.column],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.data_type).toBe("bytea");
        expect(rows[0]!.is_nullable).toBe("YES");
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0019 forward: fingerprint indexes exist", () => {
  it("sessions_token_fp_unique is a partial UNIQUE index on (token_fp) WHERE token_fp IS NOT NULL", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'sessions'
            AND indexname = 'sessions_token_fp_unique'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0]!.indexdef;
      expect(def).toMatch(/CREATE UNIQUE INDEX/i);
      expect(def).toMatch(/\(token_fp\)/i);
      expect(def).toMatch(/WHERE.*token_fp IS NOT NULL/i);
    } finally {
      await pool.end();
    }
  });

  it("sessions_previous_token_fp_idx is a partial index on (previous_token_fp) WHERE previous_token_fp IS NOT NULL", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'sessions'
            AND indexname = 'sessions_previous_token_fp_idx'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0]!.indexdef;
      expect(def).toMatch(/CREATE INDEX/i);
      expect(def).toMatch(/\(previous_token_fp\)/i);
      expect(def).toMatch(/WHERE.*previous_token_fp IS NOT NULL/i);
    } finally {
      await pool.end();
    }
  });
});

describe("0019 forward: additive invariants — plaintext columns + indexes untouched", () => {
  for (const target of PLAINTEXT_INVARIANTS) {
    it(`${target.table}.${target.column} is still present (additive migration must not drop)`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{ column_name: string }>(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2`,
          [target.table, target.column],
        );
        expect(rows).toHaveLength(1);
      } finally {
        await pool.end();
      }
    });
  }

  it("sessions_token_unique (plaintext UNIQUE index) still active", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'sessions'
            AND indexname = 'sessions_token_unique'`,
      );
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});

describe("0019 down: rescue rollback restores pre-migration schema", () => {
  // The down migration is a rescue script (NOT in the drizzle journal —
  // mirrors 0018_rls_fail_closed.down.sql precedent). We exercise it by
  // reading the .down.sql file and applying it as openwhispr_owner on the
  // same testcontainer used by the forward suite above. The boot fixture
  // has already replayed 0000..0019 via drizzle migrate(); the down script
  // reverses 0019 in-place and the assertions below confirm the schema
  // returns to its pre-0019 shape.

  it("down SQL exists at the documented path", () => {
    const sql = readFileSync(DOWN_SQL_PATH, "utf8");
    expect(sql).toMatch(/DROP\s+INDEX[^;]*sessions_token_fp_unique/i);
    expect(sql).toMatch(/DROP\s+INDEX[^;]*sessions_previous_token_fp_idx/i);
    expect(sql).toMatch(/ALTER TABLE\s+"?account"?\s+DROP\s+COLUMN/i);
    expect(sql).toMatch(/ALTER TABLE\s+"?sessions"?\s+DROP\s+COLUMN/i);
    expect(sql).toMatch(/ALTER TABLE\s+"?verification"?\s+DROP\s+COLUMN/i);
    expect(sql).toMatch(/ALTER TABLE\s+"?oauth_state"?\s+DROP\s+COLUMN/i);
  });

  it("applying down DDL drops all 48 sidecars + 2 fingerprints + 2 indexes; plaintext columns + sessions_token_unique survive", async () => {
    const sql = readFileSync(DOWN_SQL_PATH, "utf8");
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      await pool.query(sql);

      // 1. Zero sidecars survive.
      const suffixPattern = SIDECAR_SUFFIXES.join("|");
      const columnPattern =
        "^(access_token|refresh_token|id_token|password|value|token|previous_token|code_verifier)_(" +
        suffixPattern +
        ")$";
      const { rows: sidecarRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('account', 'verification', 'sessions', 'oauth_state')
            AND column_name ~ $1`,
        [columnPattern],
      );
      expect(sidecarRows[0]!.count).toBe("0");

      // 2. Both fingerprint columns gone.
      const { rows: fpRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'sessions'
            AND column_name IN ('token_fp', 'previous_token_fp')`,
      );
      expect(fpRows[0]!.count).toBe("0");

      // 3. Both new indexes gone.
      const { rows: idxRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'sessions'
            AND indexname IN ('sessions_token_fp_unique', 'sessions_previous_token_fp_idx')`,
      );
      expect(idxRows[0]!.count).toBe("0");

      // 4. Plaintext columns still intact.
      const { rows: ptRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'account' AND column_name IN ('access_token', 'refresh_token', 'id_token', 'password'))
              OR (table_name = 'verification' AND column_name = 'value')
              OR (table_name = 'sessions' AND column_name IN ('token', 'previous_token'))
              OR (table_name = 'oauth_state' AND column_name = 'code_verifier')
            )`,
      );
      expect(ptRows[0]!.count).toBe("8");

      // 5. Pre-existing plaintext UNIQUE index still intact.
      const { rows: ptIdx } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'sessions'
            AND indexname = 'sessions_token_unique'`,
      );
      expect(ptIdx).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
