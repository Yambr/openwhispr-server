// TEST-MIGRATION-01 + DATA-01 + DATA-06 integration test.
//
// Spins up a real Postgres 17 container via @testcontainers/postgresql,
// applies 0000_initial.sql as openwhispr_owner, then asserts:
//
//  1. Every tenant-scoped table reports BOTH relrowsecurity AND
//     relforcerowsecurity = true (Pitfall 5: ENABLE without FORCE lets
//     the owner role bypass policies; we mandate both).
//  2. The default tenant row exists with the stable seed UUID (D-17).
//  3. openwhispr_owner has BYPASSRLS, openwhispr_app does NOT.
//  4. Forward-apply + drop-everything + forward-apply produces a
//     byte-stable schema dump (re-applies are deterministic, which is
//     what TEST-MIGRATION-01 calls "rollback equivalence").

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema/index.js";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
  MIGRATIONS_FOLDER,
} from "./helpers.js";

const TENANT_SCOPED = ["users", "sessions", "audit_log", "usage_ledger"];

let booted: BootResult;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("TEST-MIGRATION-01 — forward apply + RLS introspection", () => {
  it("ENABLE + FORCE row level security on every tenant-scoped table", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
                 FROM pg_class
                 WHERE relname = ANY($1::text[])
                 ORDER BY relname`,
        [TENANT_SCOPED],
      );
      expect(rows).toHaveLength(TENANT_SCOPED.length);
      for (const r of rows) {
        expect(r.relrowsecurity, `${r.relname}: ENABLE RLS`).toBe(true);
        expect(r.relforcerowsecurity, `${r.relname}: FORCE RLS`).toBe(true);
      }
    } finally {
      await pool.end();
    }
  });

  it("default tenant row exists with stable UUID", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM tenants WHERE id = $1`,
        [DEFAULT_TENANT_ID],
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await pool.end();
    }
  });

  it("openwhispr_owner has BYPASSRLS; openwhispr_app does not", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        rolname: string;
        rolbypassrls: boolean;
      }>(
        `SELECT rolname, rolbypassrls FROM pg_roles
                 WHERE rolname IN ('openwhispr_owner','openwhispr_app')
                 ORDER BY rolname`,
      );
      const byName = Object.fromEntries(rows.map((r) => [r.rolname, r.rolbypassrls]));
      expect(byName.openwhispr_owner).toBe(true);
      expect(byName.openwhispr_app).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it("forward+drop+forward reproduces byte-equal schema dump", async () => {
    // First dump: schema-only via pg_dump executed inside the container.
    const dumpCmd = [
      "pg_dump",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "-U",
      "openwhispr_owner",
      "-d",
      "openwhispr",
    ];
    const exec1 = await booted.container.exec(dumpCmd, {
      env: { PGPASSWORD: "owner-pw-test" },
    });
    expect(exec1.exitCode).toBe(0);
    const dump1 = exec1.output;

    // Drop everything (public schema cascade + the _meta migrations
    // schema), then re-run migrate() and dump again.
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      await ownerPool.query(`DROP SCHEMA public CASCADE`);
      await ownerPool.query(`CREATE SCHEMA public`);
      await ownerPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
      await ownerPool.query(`DROP SCHEMA IF EXISTS _meta CASCADE`);
      // Phase 6 / Plan 02 — clear pg_partman's part_config so 0014 can
      // re-register the parent on the second forward-apply. The partman
      // schema lives outside `public` and survives the DROP above.
      await ownerPool.query(
        `DELETE FROM partman.part_config WHERE parent_table='public.audit_log'`,
      );
      const ownerDb = drizzle(ownerPool, { schema });
      await migrate(ownerDb, {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: "_meta",
        migrationsTable: "__drizzle_migrations",
      });
    } finally {
      await ownerPool.end();
    }

    const exec2 = await booted.container.exec(dumpCmd, {
      env: { PGPASSWORD: "owner-pw-test" },
    });
    expect(exec2.exitCode).toBe(0);
    const dump2 = exec2.output;

    // pg_dump's preamble includes nondeterministic noise that has nothing
    // to do with schema equivalence and must be filtered before the
    // structural comparison:
    //   * `-- Dumped …`, `-- Started on …`, `-- Completed on …`:
    //     wall-clock timestamps.
    //   * `\restrict …` / `\unrestrict …`: a random per-dump token PG17
    //     emits to bracket the dump body (psql ignores them).
    //   * `COMMENT ON SCHEMA public IS '…';`: the bootstrap container
    //     creates `public` with a default comment, but our DROP SCHEMA
    //     CASCADE + CREATE SCHEMA round-trip omits it on the second
    //     run. The schema itself is unchanged.
    //   * Empty lines and comment-banner lines that surround the
    //     dropped COMMENT ensure structural equality survives the
    //     blank-line shuffle.
    const normalize = (s: string): string => {
      const lines = s.split("\n");
      const kept: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (
          line.startsWith("-- Dumped") ||
          line.startsWith("-- Started on") ||
          line.startsWith("-- Completed on") ||
          line.startsWith("\\restrict ") ||
          line.startsWith("\\unrestrict ")
        ) {
          continue;
        }
        if (line.startsWith("COMMENT ON SCHEMA public")) {
          continue;
        }
        if (line === "-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -") {
          // Skip this banner line and its surrounding `--` framing
          // (the previous and next lines, which are pure `--`).
          if (kept[kept.length - 1] === "--") kept.pop();
          // Also skip the trailing `--` and blank lines following the
          // banner (i.e. up through the next non-blank, non-`--` line).
          while (i + 1 < lines.length) {
            const peek = lines[i + 1];
            if (peek === "--" || peek === "" || peek === undefined) {
              i++;
              continue;
            }
            break;
          }
          continue;
        }
        kept.push(line);
      }
      // Collapse runs of blank lines so spacing perturbations from the
      // skipped COMMENT block do not alter equality.
      return kept
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };
    expect(normalize(dump2)).toBe(normalize(dump1));
  });
});
