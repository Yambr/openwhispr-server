// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 03 / D-12 — bootstrapRoles helper.
//
// Asserts that calling bootstrapRoles(superPool) against a fresh
// PostgresSqlContainer produces the canonical two-role layout used by
// every RLS-touching test in this package:
//
//   - `openwhispr_owner` exists, has LOGIN, has BYPASSRLS, has CREATEROLE.
//   - `openwhispr_app` exists, has LOGIN, NO BYPASSRLS (RLS-subject role).
//   - `openwhispr_owner` is GRANTed `openwhispr_app` WITH ADMIN OPTION
//     (so migration 0003 can `ALTER ROLE openwhispr_app SET …` as owner).
//   - Database + public schema owned by `openwhispr_owner`.
//
// pg_partman provisioning is intentionally NOT part of the helper — callers
// that need it call `provisionPgPartman(superPool)` after `bootstrapRoles`.
// This keeps the helper usable from lint-rls.test.ts (no pg_partman) and
// from the five pg_partman-dependent migration tests.
//
// Per CLAUDE.md "no mocks of internal logic": real Postgres 17 testcontainer.
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapRoles } from "../bootstrap-roles.js";

const TIMEOUT = 120_000;

describe("bootstrapRoles — D-12 (Phase 18.1.1 / Plan 03)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let superPool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("openwhispr")
      .withUsername("postgres_super")
      .withPassword("super-pw")
      .start();
    superPool = new Pool({ connectionString: container.getConnectionUri() });
    await bootstrapRoles(superPool);
  }, TIMEOUT);

  afterAll(async () => {
    if (superPool) await superPool.end();
    if (container) await container.stop();
  }, 60_000);

  it("creates openwhispr_owner with LOGIN + BYPASSRLS + CREATEROLE", async () => {
    const { rows } = await superPool.query<{
      rolcanlogin: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolcanlogin, rolbypassrls, rolcreaterole
         FROM pg_roles WHERE rolname = 'openwhispr_owner'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolcanlogin).toBe(true);
    expect(rows[0]?.rolbypassrls).toBe(true);
    expect(rows[0]?.rolcreaterole).toBe(true);
  });

  it("creates openwhispr_app with LOGIN and NO BYPASSRLS", async () => {
    const { rows } = await superPool.query<{
      rolcanlogin: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolcanlogin, rolbypassrls
         FROM pg_roles WHERE rolname = 'openwhispr_app'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolcanlogin).toBe(true);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it("grants openwhispr_app to openwhispr_owner WITH ADMIN OPTION", async () => {
    // pg_has_role member-with-admin: query via pg_auth_members.admin_option.
    const { rows } = await superPool.query<{ admin_option: boolean }>(
      `SELECT m.admin_option
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         JOIN pg_roles g ON g.oid = m.member
        WHERE r.rolname = 'openwhispr_app' AND g.rolname = 'openwhispr_owner'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.admin_option).toBe(true);
  });

  it("transfers database ownership to openwhispr_owner", async () => {
    const { rows } = await superPool.query<{ owner: string }>(
      `SELECT pg_catalog.pg_get_userbyid(datdba) AS owner
         FROM pg_database WHERE datname = 'openwhispr'`,
    );
    expect(rows[0]?.owner).toBe("openwhispr_owner");
  });

  it("transfers public schema ownership to openwhispr_owner", async () => {
    const { rows } = await superPool.query<{ owner: string }>(
      `SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner
         FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(rows[0]?.owner).toBe("openwhispr_owner");
  });
});
