// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 05 / Task 3 — token-rotation overlap integration test.
// Phase 02.12 — migrated to plain-text storage (sessions.previous_token).
// Phase 33 / Plan 33-04 — migration 0019b dropped the
// `lookup_session_by_previous_token(text)` SECURITY DEFINER function. The
// AUTH-04 5-minute overlap contract now resolves via the Node-side
// helper `packages/data/src/sessions/lookup-by-previous-token.ts` which
// SHA-256-hashes the plaintext bearer and probes the partial-unique
// index `sessions_previous_token_fp_idx`. This test was rewritten in
// the same Plan 33-04 commit that drops the SQL function — production
// changes drive the test surface, not the other way around (CLAUDE.md
// Hard Rule 1: legitimate production-removal forces test-surface
// migration, never the inverse).
//
// Pins the AUTH-04 contract end-to-end against real Postgres:
//   1. UPDATE sessions SET previous_token + previous_token_fp +
//      previous_token_expires_at = now()+5min — same SQL shape that
//      recordPreviousToken issues from apps/api/src/lib/token-rotation.ts
//      (post-33-04).
//   2. lookupSessionByPreviousToken returns (userId, tenantId) for an
//      unexpired previous token, and returns null once
//      previous_token_expires_at < now() OR no fp matches.
//
// This test lives in packages/data because it is fundamentally a
// migration-contract test. The apps-side `recordPreviousToken`/
// `tryPreviousToken` helpers are unit-tested separately in
// `apps/api/tests/unit/lib/token-rotation.test.ts`.
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";
import { lookupSessionByPreviousToken } from "../../../src/sessions/lookup-by-previous-token.js";

let booted: BootResult;

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
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
    // Phase 33 / Plan 33-05 — plaintext `token` column dropped by migration
    // 0020; envelope-encryption sidecars are nullable, only `token_fp` is
    // NOT NULL. Seed the current session with the SHA-256 fingerprint of
    // the current bearer; the plaintext bearer never lands on disk.
    await ownerPool.query(
      `INSERT INTO sessions (id, tenant_id, user_id, token_fp, expires_at)
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

describe("AUTH-04 token-rotation overlap (real Postgres, fingerprint-index lookup)", () => {
  it("UPDATE sessions SET previous_token + previous_token_fp + 5-minute expiry under tenant GUC", async () => {
    const oldToken = "rotated-token-T1";
    const appPool = new Pool({ connectionString: booted.appUri });
    try {
      const client = await appPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEFAULT_TENANT_ID]);
        // Plan 33-05 — plaintext `previous_token` column dropped by 0020.
        // The fp + expires_at pair is the canonical AUTH-04 overlap state.
        await client.query(
          `UPDATE sessions
           SET previous_token_fp = $1,
               previous_token_expires_at = now() + interval '5 minutes'
           WHERE id = $2`,
          [sha256(oldToken), SESSION_ID],
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
      // Plan 33-05 — the plaintext `previous_token` column was dropped
      // by 0020. Only the fp and expiry window remain on the row.
      const { rows } = await ownerPool.query<{
        previous_token_fp: Buffer | null;
        in_window: boolean;
      }>(
        `SELECT previous_token_fp,
                (previous_token_expires_at > now()
                 AND previous_token_expires_at <= now() + interval '5 minutes 1 second') AS in_window
         FROM sessions WHERE id = $1`,
        [SESSION_ID],
      );
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.previous_token_fp).toEqual(sha256(oldToken));
      expect(row?.in_window).toBe(true);
    } finally {
      await ownerPool.end();
    }
  });

  it("lookupSessionByPreviousToken returns (userId, tenantId) via fp index on owner pool", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      const result = await lookupSessionByPreviousToken(ownerPool, "rotated-token-T1");
      expect(result).toEqual({ userId: USER_ID, tenantId: DEFAULT_TENANT_ID });
    } finally {
      await ownerPool.end();
    }
  });

  it("returns null for a bearer that never matched any session", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      const result = await lookupSessionByPreviousToken(ownerPool, "never-rotated-bearer");
      expect(result).toBeNull();
    } finally {
      await ownerPool.end();
    }
  });

  it("returns null once previous_token_expires_at has elapsed", async () => {
    // Force-expire via owner.
    const ownerPool = new Pool({ connectionString: booted.ownerUri });
    try {
      await ownerPool.query(
        `UPDATE sessions
         SET previous_token_expires_at = now() - interval '1 second'
         WHERE id = $1`,
        [SESSION_ID],
      );
      const result = await lookupSessionByPreviousToken(ownerPool, "rotated-token-T1");
      expect(result).toBeNull();
    } finally {
      await ownerPool.end();
    }
  });
});
