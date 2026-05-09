// Phase 2 / Plan 05 / Task 3 — token-rotation overlap integration test.
//
// Pins the AUTH-04 contract end-to-end against real Postgres:
//   1. UPDATE sessions SET previous_token_hash + previous_token_expires_at
//      = now()+5min — same SQL shape that recordPreviousToken issues from
//      apps/api/src/lib/token-rotation.ts.
//   2. The lookup_session_by_previous_token(bytea) SECURITY DEFINER
//      function returns (user_id, tenant_id) for an unexpired previous
//      token, and returns nothing once previous_token_expires_at < now().
//   3. EXECUTE on the function is granted to openwhispr_app (verified via
//      the app-role connection succeeding without elevated privileges).
//
// This test lives in packages/data because it is fundamentally a
// migration-contract test (Pitfall: cross-package rootDir would prevent
// apps/api from including it under its own typecheck). The apps-side
// `recordPreviousToken`/`tryPreviousToken` helpers are unit-tested
// separately in apps/api/src/lib/token-rotation.test.ts; THIS test
// pins the database side of that contract so the helpers' SQL shape
// stays in sync with the migration.
//
// Plan 06's CONTRACT-01 owns the full end-to-end Better Auth rotation
// run against a deployed backend (the 100-concurrent-requests assertion
// in 02-05-PLAN.md Task 3 done criteria). This integration test pins
// the DB-side machinery the contract test relies on.
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootMigratedPostgres,
  type BootResult,
  DEFAULT_TENANT_ID,
} from "./helpers.js";

let booted: BootResult;

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  const ownerPool = new Pool({ connectionString: booted.ownerUri });
  try {
    await ownerPool.query(
      `INSERT INTO users (id, tenant_id, email)
       VALUES ($1, $2, 'rotate@example.com')
       ON CONFLICT DO NOTHING`,
      [USER_ID, DEFAULT_TENANT_ID],
    );
    await ownerPool.query(
      `INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 days')
       ON CONFLICT DO NOTHING`,
      [SESSION_ID, DEFAULT_TENANT_ID, USER_ID, sha256("current-token-T2")],
    );
  } finally {
    await ownerPool.end();
  }
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("AUTH-04 token-rotation overlap (real Postgres)", () => {
  it("UPDATE sessions SET previous_token_hash + 5-minute expiry under tenant GUC", async () => {
    const oldHash = sha256("token-T1");
    const appPool = new Pool({ connectionString: booted.appUri });
    try {
      const client = await appPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT set_config('app.tenant_id', $1, true)`,
          [DEFAULT_TENANT_ID],
        );
        await client.query(
          `UPDATE sessions
           SET previous_token_hash = $1,
               previous_token_expires_at = now() + interval '5 minutes'
           WHERE id = $2`,
          [oldHash, SESSION_ID],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    } finally {
      await appPool.end();
    }

    // Verify under owner connection (BYPASSRLS).
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await ownerPool.query<{
        previous_token_hash: Buffer | null;
        in_window: boolean;
      }>(
        `SELECT previous_token_hash,
                (previous_token_expires_at > now()
                 AND previous_token_expires_at <= now() + interval '5 minutes 1 second') AS in_window
         FROM sessions WHERE id = $1`,
        [SESSION_ID],
      );
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.previous_token_hash?.equals(oldHash)).toBe(true);
      expect(row?.in_window).toBe(true);
    } finally {
      await ownerPool.end();
    }
  });

  it("lookup_session_by_previous_token returns (user_id, tenant_id) for an unexpired hash via the app role (SECURITY DEFINER)", async () => {
    const appPool = new Pool({ connectionString: booted.appUri });
    try {
      const { rows } = await appPool.query<{
        user_id: string;
        tenant_id: string;
      }>(
        `SELECT user_id, tenant_id
         FROM lookup_session_by_previous_token($1)`,
        [sha256("token-T1")],
      );
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.user_id).toBe(USER_ID);
      expect(row?.tenant_id).toBe(DEFAULT_TENANT_ID);
    } finally {
      await appPool.end();
    }
  });

  it("returns no rows for a hash that never matched any session", async () => {
    const appPool = new Pool({ connectionString: booted.appUri });
    try {
      const { rows } = await appPool.query(
        `SELECT user_id, tenant_id
         FROM lookup_session_by_previous_token($1)`,
        [sha256("never-rotated")],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await appPool.end();
    }
  });

  it("returns no rows once previous_token_expires_at has elapsed", async () => {
    // Force-expire via owner.
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      await ownerPool.query(
        `UPDATE sessions
         SET previous_token_expires_at = now() - interval '1 second'
         WHERE id = $1`,
        [SESSION_ID],
      );
    } finally {
      await ownerPool.end();
    }
    const appPool = new Pool({ connectionString: booted.appUri });
    try {
      const { rows } = await appPool.query(
        `SELECT user_id, tenant_id
         FROM lookup_session_by_previous_token($1)`,
        [sha256("token-T1")],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await appPool.end();
    }
  });
});
