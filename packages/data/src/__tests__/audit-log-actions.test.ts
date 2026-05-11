// Phase 6 / Plan 02 — DATA-04 D-A6 action-enum CHECK enforcement.
//
// Originally created as a RED stub in Wave 0 (TDD-01b). This file is
// flipped GREEN here against a real Postgres + pg_partman testcontainer.
// The 18-action enumeration below is COPIED VERBATIM from 06-CONTEXT.md D-A6;
// any future drift fails the "exactly 18 entries" drift-detector test
// (the const array IS the spec).
//
// Real Postgres + pg_partman, no mocks (CLAUDE.md "no mocks of internal logic").

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres, DEFAULT_TENANT_ID } from "./helpers.js";

const PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman";

export const AUDIT_LOG_ACTIONS = [
  "auth.signin",
  "auth.signin_failed",
  "auth.signout",
  "auth.password_change",
  "auth.oauth_link",
  "account.delete",
  "account.delete_requested",
  "key.issued",
  "key.revoked",
  "settings.tenant_changed",
  "settings.user_changed",
  "admin.tenant_created",
  "admin.tenant_suspended",
  "admin.user_impersonated",
  "admin.role_changed",
  "security.cross_tenant_attempt",
  "security.rate_limit_exceeded",
  "security.ssrf_blocked",
] as const;

let booted: BootResult | undefined;

beforeAll(async () => {
  booted = await bootMigratedPostgres({
    image: PARTMAN_IMAGE,
    withPgPartman: true,
  });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

async function expectCheckViolation(pool: Pool, action: string): Promise<void> {
  let caught: { code?: string } | undefined;
  try {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, action, payload)
         VALUES ($1::uuid, $2, '{}'::jsonb)`,
      [DEFAULT_TENANT_ID, action],
    );
  } catch (e) {
    caught = e as { code?: string };
  }
  expect(caught, `action='${action}' should have been rejected`).toBeDefined();
  expect(caught!.code).toBe("23514");
}

describe("audit_log.action CHECK constraint (D-A6, 18 actions)", () => {
  for (const action of AUDIT_LOG_ACTIONS) {
    it(`accepts INSERT with action='${action}'`, async () => {
      const pool = new Pool({ connectionString: booted!.ownerUri });
      try {
        await pool.query(
          `INSERT INTO audit_log (tenant_id, action, payload)
             VALUES ($1::uuid, $2, '{}'::jsonb)`,
          [DEFAULT_TENANT_ID, action],
        );
      } finally {
        await pool.end();
      }
    });
  }

  it("rejects INSERT with action='auth.unknown' (CHECK violation)", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      await expectCheckViolation(pool, "auth.unknown");
    } finally {
      await pool.end();
    }
  });

  it("rejects INSERT with action='' (CHECK violation)", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      await expectCheckViolation(pool, "");
    } finally {
      await pool.end();
    }
  });

  it("rejects INSERT with action containing whitespace", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      await expectCheckViolation(pool, "auth.signin ");
    } finally {
      await pool.end();
    }
  });

  it("the AUDIT_LOG_ACTIONS const-union has exactly 18 entries (drift detector)", () => {
    expect(AUDIT_LOG_ACTIONS).toHaveLength(18);
  });
});
