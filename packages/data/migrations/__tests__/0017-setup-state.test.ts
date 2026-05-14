// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-01 — migration 0017: setup_state singleton + users.role.
//
// Per CLAUDE.md "no mocks of internal logic": real Postgres testcontainers,
// real DDL, real backfill branches. Two boots:
//   * fresh-install branch (no pre-existing users) → status='pending'
//   * v1-upgrade branch (one pre-existing user row) → status='skipped_legacy'
//
// Both branches share Test C (singleton CHECK rejects a second row) and
// Test D (users.role column shape) and Test E (squawk lint clean).
//
// The v1-upgrade branch CANNOT be exercised by the default
// `bootMigratedPostgres` helper — it applies ALL migrations including 0017
// before we get a handle, so by definition setup_state is already in
// 'pending' state with `users` empty. We therefore boot a SECOND container
// in legacy-seed mode: apply migrations 0000-0016, INSERT a user, THEN
// apply 0017 by hand via the SQL string. See behaviour-table in Task 3 of
// 12-01-PLAN.md.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  POSTGRES_PARTMAN_IMAGE,
  provisionPgPartman,
} from "../../src/__tests__/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/migrations/__tests__ -> packages/data/migrations
const MIGRATIONS_FOLDER = resolve(__dirname, "..");
// packages/data/migrations/__tests__ -> repo root
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const MIGRATION_0017_PATH = resolve(MIGRATIONS_FOLDER, "0017_setup_state.sql");

let freshBoot: BootResult | undefined;
let legacyContainer: StartedPostgreSqlContainer | undefined;
let legacyOwnerUri: string | undefined;

beforeAll(async () => {
  freshBoot = await bootMigratedPostgres({ withPgPartman: true });
}, 180_000);

afterAll(async () => {
  if (freshBoot) await freshBoot.stop();
  if (legacyContainer) await legacyContainer.stop();
}, 60_000);

async function bootLegacyPreMigration(): Promise<{
  ownerUri: string;
  applyZeroSeventeen: () => Promise<void>;
}> {
  // Mirror the boot/role-setup posture of `bootMigratedPostgres` (helpers.ts)
  // verbatim — same superuser, same role grants, same parameter privileges,
  // same pg_partman provisioning — then run drizzle's `migrate()` against a
  // TEMP migrations folder that contains migrations 0000-0016 only. After
  // seeding a legacy user, we apply 0017_setup_state.sql by hand to exercise
  // the v1-upgrade backfill branch (status='skipped_legacy').
  const ownerPassword = "owner-pw-legacy";
  const appPassword = "app-pw-legacy";

  legacyContainer = await new PostgreSqlContainer(POSTGRES_PARTMAN_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = legacyContainer.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });
  // Roles MUST exist before provisionPgPartman runs (it GRANTs partman privs
  // to openwhispr_owner). Same ordering as helpers.ts.
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await provisionPgPartman(superPool);
  await superPool.end();

  const host = legacyContainer.getHost();
  const port = legacyContainer.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;
  legacyOwnerUri = ownerUri;

  // Build a temp migrations folder that mirrors packages/data/migrations but
  // omits 0017 (so drizzle's migrate() applies 0000-0016 only). Copying is
  // safer than mutating the real journal in-place across parallel tests.
  const tmpMigrations = mkdtempSync(resolve(tmpdir(), "ow-0017-legacy-"));
  cpSync(MIGRATIONS_FOLDER, tmpMigrations, { recursive: true });
  // Remove 0017 SQL file from the temp folder.
  try {
    rmSync(resolve(tmpMigrations, "0017_setup_state.sql"));
  } catch {
    // File was not in the journal yet (RED phase); ignore.
  }
  // Strip the 0017 entry from the temp journal.
  const journalPath = resolve(tmpMigrations, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  journal.entries = journal.entries.filter((e) => !e.tag.startsWith("0017"));
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool);
  await migrate(ownerDb, {
    migrationsFolder: tmpMigrations,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  return {
    ownerUri,
    applyZeroSeventeen: async () => {
      const sql = readFileSync(MIGRATION_0017_PATH, "utf8");
      const pool = new Pool({ connectionString: ownerUri });
      try {
        const statements = sql.split(/--> statement-breakpoint/);
        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (trimmed.length === 0) continue;
          await pool.query(trimmed);
        }
      } finally {
        await pool.end();
      }
    },
  };
}

describe("0017_setup_state: fresh-install branch (no pre-existing users)", () => {
  it("seeds exactly one setup_state row with id=1, status='pending', completed_at IS NULL", async () => {
    const pool = new Pool({ connectionString: freshBoot!.ownerUri });
    try {
      const { rows } = await pool.query<{
        id: number;
        status: string;
        completed_at: Date | null;
      }>(`SELECT id, status, completed_at FROM setup_state`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(1);
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.completed_at).toBeNull();
    } finally {
      await pool.end();
    }
  });
});

describe("0017_setup_state: v1-upgrade branch (one pre-existing user)", () => {
  it("seeds setup_state with status='skipped_legacy' when users table is non-empty at migration time", async () => {
    const { ownerUri, applyZeroSeventeen } = await bootLegacyPreMigration();
    // Seed one user before applying 0017.
    const pool = new Pool({ connectionString: ownerUri });
    try {
      const tenant = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name) VALUES ('legacy-t') RETURNING id`,
      );
      await pool.query(`INSERT INTO users (tenant_id, email, locale) VALUES ($1::uuid, $2, 'en')`, [
        tenant.rows[0]!.id,
        "legacy@user.test",
      ]);
    } finally {
      await pool.end();
    }

    await applyZeroSeventeen();

    const verify = new Pool({ connectionString: ownerUri });
    try {
      const { rows } = await verify.query<{ id: number; status: string }>(
        `SELECT id, status FROM setup_state`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(1);
      expect(rows[0]!.status).toBe("skipped_legacy");
    } finally {
      await verify.end();
    }
  }, 180_000);
});

describe("0017_setup_state: singleton CHECK + users.role column shape + squawk lint", () => {
  it("attempting to INSERT a second setup_state row fails with CHECK violation (23514)", async () => {
    const pool = new Pool({ connectionString: freshBoot!.ownerUri });
    try {
      await expect(
        pool.query(`INSERT INTO setup_state (id, status) VALUES (2, 'pending')`),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await pool.end();
    }
  });

  it("users.role column is text, nullable, no default", async () => {
    const pool = new Pool({ connectionString: freshBoot!.ownerUri });
    try {
      const { rows } = await pool.query<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'role'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data_type).toBe("text");
      expect(rows[0]!.is_nullable).toBe("YES");
      expect(rows[0]!.column_default).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("existing user rows have role IS NULL after the migration", async () => {
    const pool = new Pool({ connectionString: freshBoot!.ownerUri });
    try {
      const tenant = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name) VALUES ('role-check') RETURNING id`,
      );
      const inserted = await pool.query<{ role: string | null }>(
        `INSERT INTO users (tenant_id, email) VALUES ($1::uuid, $2) RETURNING role`,
        [tenant.rows[0]!.id, "role-null@user.test"],
      );
      expect(inserted.rows[0]!.role).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("squawk lint exits 0 on migration 0017", () => {
    // Run from repo root via the pnpm script so squawk-cli resolves the same
    // way it does in CI (`pnpm lint:migrations <file>`).
    const out = execFileSync(
      "pnpm",
      ["-s", "lint:migrations", "packages/data/migrations/0017_setup_state.sql"],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    // Non-zero exit raises; reaching here means clean.
    expect(out).toMatch(/0017_setup_state\.sql/);
  }, 180_000);
});
