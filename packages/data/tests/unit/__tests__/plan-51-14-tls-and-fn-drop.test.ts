// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-14 — RED→GREEN regressions for REVIEW-INDEX.md
// data HIGH:
//
//   HI-01: stale `session_lookup_by_token(text)` SECURITY DEFINER
//          function references the dropped `sessions.token` column
//          after migration 0020. Throws 42703 (undefined column) on
//          every call. Closed by new migration 0023.
//   HI-03: pg.Pool construction across `client.ts`, `migrate.ts`,
//          `backfill-encrypt-credentials.ts` did not opt into TLS.
//          libpq's default is `sslmode=prefer` — falls back to
//          plaintext when the server rejects the TLS handshake.
//          Closed by the new `buildPoolConfig()` helper.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "../../../src/client.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(TEST_DIR, "../../../migrations");
const JOURNAL = resolve(MIGRATIONS_DIR, "meta/_journal.json");
const CLIENT_SRC = resolve(TEST_DIR, "../../../src/client.ts");
const MIGRATE_SRC = resolve(TEST_DIR, "../../../src/migrate.ts");
const BACKFILL_SRC = resolve(
  TEST_DIR,
  "../../../src/encryption/cli/backfill-encrypt-credentials.ts",
);

describe("Plan 51-14 — data hardening", () => {
  describe("HI-01 — stale session_lookup_by_token dropped in 0023", () => {
    it("migration 0023 file exists and contains the DROP", () => {
      const path = resolve(MIGRATIONS_DIR, "0023_drop_stale_session_lookup_fn.sql");
      expect(existsSync(path), `expected ${path}`).toBe(true);
      const sql = readFileSync(path, "utf8");
      expect(
        /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.session_lookup_by_token\(text\)/i.test(sql),
      ).toBe(true);
    });

    it("down migration exists and re-creates a hard-fail stub", () => {
      const path = resolve(MIGRATIONS_DIR, "0023_drop_stale_session_lookup_fn.down.sql");
      expect(existsSync(path)).toBe(true);
      const sql = readFileSync(path, "utf8");
      expect(/RAISE\s+EXCEPTION/i.test(sql)).toBe(true);
    });

    it("journal entry idx=24 carries the 0023 tag", () => {
      const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      const entry = journal.entries.find((e) => e.idx === 24);
      expect(entry, "journal must include idx=24").toBeTruthy();
      expect(entry?.tag).toBe("0023_drop_stale_session_lookup_fn");
    });
  });

  describe("HI-03 — TLS-by-default pg.Pool construction", () => {
    it("buildPoolConfig enables TLS for a bare DATABASE_URL (libpq default would be sslmode=prefer)", () => {
      const cfg = buildPoolConfig("postgres://user:pw@host:5432/db");
      expect(cfg.ssl).toBeTruthy();
      expect(cfg.ssl).not.toBe(false);
    });

    it("buildPoolConfig honors `sslmode=disable` opt-out", () => {
      const cfg = buildPoolConfig("postgres://user:pw@host:5432/db?sslmode=disable");
      expect(cfg.ssl).toBe(false);
    });

    it("buildPoolConfig enables TLS for `sslmode=require`", () => {
      const cfg = buildPoolConfig("postgres://user:pw@host:5432/db?sslmode=require");
      expect(cfg.ssl).toBeTruthy();
      expect(cfg.ssl).not.toBe(false);
    });

    it("buildPoolConfig flips rejectUnauthorized when PGSSL_REJECT_UNAUTHORIZED=1", () => {
      const prev = process.env.PGSSL_REJECT_UNAUTHORIZED;
      process.env.PGSSL_REJECT_UNAUTHORIZED = "1";
      try {
        const cfg = buildPoolConfig("postgres://user:pw@host:5432/db");
        expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
      } finally {
        if (prev === undefined) delete process.env.PGSSL_REJECT_UNAUTHORIZED;
        else process.env.PGSSL_REJECT_UNAUTHORIZED = prev;
      }
    });

    it("client.ts, migrate.ts, backfill cli all consume buildPoolConfig (no bare `new Pool({ connectionString })`)", () => {
      for (const path of [CLIENT_SRC, MIGRATE_SRC, BACKFILL_SRC]) {
        const src = readFileSync(path, "utf8");
        // Strip comments before pattern-matching so a narrative
        // mention of the old pattern doesn't false-positive.
        const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        // Allow `new Pool(buildPoolConfig(...))`; refuse a bare
        // `new Pool({ connectionString: ... })` literal.
        expect(
          /new Pool\(\s*\{\s*connectionString:/.test(stripped),
          `${path} contains a bare new Pool({ connectionString }) — must use buildPoolConfig`,
        ).toBe(false);
      }
    });
  });
});
