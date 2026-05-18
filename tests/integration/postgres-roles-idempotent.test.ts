// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.4 / G2 — packages/data/migrations/init/00-roles.sql.tpl idempotency.
 *
 * Source-of-record commit: 7ccb8bb
 *
 * Reverts: this test goes RED if the DO-block reverts to plain CREATE ROLE
 *   (no IF NOT EXISTS / ELSE ALTER):
 *   1. Test "second apply does NOT error" → fails with `role "openwhispr_owner"
 *      already exists` (SQLSTATE 42710).
 *   2. Test "ALTER branch updates app password" → fails because plain CREATE
 *      would error before the ALTER path could run.
 *
 * Real Postgres via testcontainers per CONTEXT D-04.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devStackUp } from "../_shared/dev-stack-guard.js";

// BUG-53-39: skip when dev compose stack is up — testcontainers Ryuk
// cleanup can tear down the dev stack on test exit.
const DEV_STACK_UP = devStackUp();

const SQL_TPL = readFileSync(
  join(process.cwd(), "packages", "data", "migrations", "init", "00-roles.sql.tpl"),
  "utf8",
);

function expand(tpl: string, ownerPw: string, appPw: string): string {
  return tpl
    .replace(/\$\{POSTGRES_OWNER_PASSWORD\}/g, ownerPw)
    .replace(/\$\{POSTGRES_APP_PASSWORD\}/g, appPw);
}

async function runSql(uri: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function querySingle<T = unknown>(uri: string, sql: string): Promise<T> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const r = await client.query(sql);
    return r.rows[0] as T;
  } finally {
    await client.end();
  }
}

describe.skipIf(DEV_STACK_UP)(
  "Phase 02.4 G2 — 00-roles.sql.tpl idempotency on real postgres:17",
  {
    timeout: 120_000,
  },
  () => {
    let container: StartedPostgreSqlContainer;
    // Owner password rotates each apply (the SQL template ALTERs it). Test
    // helpers rebuild the superuser URI from the latest value so the
    // post-apply queries don't reuse a stale credential.
    let currentOwnerPw = "owner_pw_v1";

    function superUri(): string {
      const host = container.getHost();
      const port = container.getMappedPort(5432);
      return `postgres://openwhispr_owner:${currentOwnerPw}@${host}:${port}/openwhispr`;
    }

    async function applyTemplate(ownerPw: string, appPw: string): Promise<void> {
      const sql = expand(SQL_TPL, ownerPw, appPw);
      await runSql(superUri(), sql);
      currentOwnerPw = ownerPw;
    }

    beforeAll(async () => {
      // Image matches docker-compose.yml `postgres:` service pin (17.5-alpine)
      // so the test exercises the same Postgres build operators run in production.
      // POSTGRES_USER=openwhispr_owner mirrors Phase 02.2: the bootstrap superuser
      // already exists with the same name as the role our SQL template re-ALTERs.
      // POSTGRES_PASSWORD seeded equal to "owner_pw_v1" so the very first apply
      // (which itself ALTERs the password to "owner_pw_v1") leaves the URI valid.
      container = await new PostgreSqlContainer("postgres:17.5-alpine")
        .withUsername("openwhispr_owner")
        .withPassword("owner_pw_v1")
        .withDatabase("openwhispr")
        .start();

      // First apply — exercises the ELSE-ALTER branch for the owner (because
      // POSTGRES_USER pre-created the role) and the IF-NOT-EXISTS / CREATE
      // branch for the app. Establishes baseline state for the first two its.
      await applyTemplate("owner_pw_v1", "app_pw_v1");
    }, 120_000);

    afterAll(async () => {
      if (container) await container.stop();
    });

    it("first apply: creates both roles with correct BYPASSRLS attributes", async () => {
      const owner = await querySingle<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_owner'",
      );
      expect(owner.rolcanlogin).toBe(true);
      expect(owner.rolbypassrls).toBe(true);

      const app = await querySingle<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app'",
      );
      expect(app.rolcanlogin).toBe(true);
      expect(app.rolbypassrls).toBe(false);
    });

    it("first apply: openwhispr database is owned by openwhispr_owner", async () => {
      const dbOwner = await querySingle<{ owner: string }>(
        superUri(),
        "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'openwhispr'",
      );
      expect(dbOwner.owner).toBe("openwhispr_owner");
    });

    it("second apply does NOT error (idempotency)", async () => {
      // applyTemplate uses the current owner password to connect, then rotates
      // currentOwnerPw to v2 after success. A regression to plain CREATE ROLE
      // would throw SQLSTATE 42710 here.
      await expect(applyTemplate("owner_pw_v2", "app_pw_v2")).resolves.toBeUndefined();
    });

    it("ALTER branch took effect: openwhispr_app password changed (can connect with v2)", async () => {
      const host = container.getHost();
      const port = container.getMappedPort(5432);
      const v2Uri = `postgres://openwhispr_app:app_pw_v2@${host}:${port}/openwhispr`;
      const client = new Client({ connectionString: v2Uri });
      // pg's Client.connect() resolves to the Client itself in this driver
      // version; the meaningful assertion is that it did not REJECT with
      // 28P01 password-auth-failed.
      await expect(client.connect()).resolves.toBeDefined();
      const r = await client.query("SELECT current_user AS u");
      expect(r.rows[0].u).toBe("openwhispr_app");
      await client.end();
    });

    it("BYPASSRLS attributes preserved on second apply (owner=true, app=false)", async () => {
      const owner = await querySingle<{ rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_owner'",
      );
      expect(owner.rolbypassrls).toBe(true);
      const app = await querySingle<{ rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app'",
      );
      expect(app.rolbypassrls).toBe(false);
    });

    it("defensive RAISE: regression-set BYPASSRLS on openwhispr_app is corrected by re-apply", async () => {
      // Regression simulation: manually grant BYPASSRLS to openwhispr_app, then
      // re-apply the script. The script's ALTER branch resets it to NOBYPASSRLS,
      // so the final RAISE-EXCEPTION block does NOT fire (because ALTER fixed it).
      // This pins the recovery path: a regression that dropped NOBYPASSRLS from
      // the ALTER would let the RAISE fire and abort the script.
      await runSql(superUri(), "ALTER ROLE openwhispr_app WITH BYPASSRLS");
      const before = await querySingle<{ rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app'",
      );
      expect(before.rolbypassrls).toBe(true);

      await expect(applyTemplate("owner_pw_v3", "app_pw_v3")).resolves.toBeUndefined();

      const after = await querySingle<{ rolbypassrls: boolean }>(
        superUri(),
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app'",
      );
      expect(after.rolbypassrls).toBe(false);
    });
  },
);
