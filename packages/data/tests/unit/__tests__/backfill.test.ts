// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-03 — Node-side backfill migrator integration test.
//
// What we're proving (real PG testcontainer; no mocks of internal logic per
// DISCIPLINE Rule 1):
//
//   - `runBackfill({ ownerPool, keyProvider, columnMap, dryRun, batchSize })`
//     reads existing plaintext from the 8 Better-Auth credential columns,
//     calls envelope.encryptValue, writes the 6 bytea sidecars + optional
//     SHA-256 fingerprint sidecars on `sessions`, and leaves the plaintext
//     column intact (Plan 33-05 drops it).
//
//   - The owner-pool (BYPASSRLS) processes all 3 seeded tenants regardless
//     of `app.tenant_id` GUC — Phase 32 fail-closed RLS does not gate the
//     migrator.
//
//   - Idempotency: a second invocation processes 0 rows (predicate
//     `WHERE plaintext IS NOT NULL AND value_ciphertext IS NULL`).
//
//   - Dry-run: returns row counts per (table, column) but the DB is unchanged.
//
//   - Fingerprints on `sessions.token_fp` + `sessions.previous_token_fp`
//     equal `sha256(plaintext)`.
//
//   - Round-trip: `decryptValue(provider, row)` on the sidecars returns the
//     original plaintext bytes.
//
// Mocked surface (DISCIPLINE Rule 4): none. We use the real bootMigratedPostgres
// helper, real EnvKeyProvider, real envelope.ts, real pg.Pool.

import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";
import {
  type BackfillColumnMap,
  type BackfillReport,
  runBackfill,
} from "../../../src/encryption/backfill.js";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";
import { decryptValue, type EncryptedRow } from "../../../src/encryption/envelope.js";

// Canonical column-map for the 8 Better-Auth credential columns. Mirrors
// the lens column-map (33-02) but in the backfill shape: tables/columns
// addressed by their physical SQL names. Sessions' two token columns
// carry a fingerprint config; others do not.
const COLUMN_MAP: BackfillColumnMap = {
  account: {
    access_token: {},
    refresh_token: {},
    id_token: {},
    password: {},
  },
  verification: {
    value: {},
  },
  sessions: {
    token: { fingerprintColumn: "token_fp" },
    previous_token: { fingerprintColumn: "previous_token_fp" },
  },
  oauth_state: {
    code_verifier: {},
  },
};

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

interface SeedRow {
  table: string;
  pk: string; // uuid
  // Per-column plaintext seeded; null entries are skipped by predicate.
  values: Record<string, string | null>;
}

// Phase 33 / Plan 33-05 — migration 0020 drops the 8 plaintext credential
// columns this integration test seeds (it INSERTs into `account.password`,
// `verification.value`, `sessions.token`, `oauth_state.code_verifier`, etc.).
// Post-0020 the boot helper applies the full journal — those columns no
// longer exist and the INSERT statements raise 42703. The backfill unit
// itself (`runBackfill`) remains covered by its production-code TypeScript
// suite (`packages/data/src/encryption/__tests__/backfill.test.ts` —
// Plan 33-03), so this integration test is now redundant: the surface it
// proves (plaintext-on-disk → ciphertext-on-disk transition) is exactly
// the surface the Phase 33-05 atomic closure removes. Skipping is the
// honest signal — the test asserted production behaviour that no longer
// exists post-0020.
// SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
describe.skip("runBackfill — integration on real PG testcontainer (obsolete post-0020)", () => {
  let boot: BootResult;
  let ownerPool: Pool;
  let provider: EnvKeyProvider;
  const kek = makeKek();
  // Track seeded rows so each test can re-assert against them.
  const seeded: SeedRow[] = [];

  beforeAll(async () => {
    process.env.MASTER_KEK = kek;
    boot = await bootMigratedPostgres();
    ownerPool = new Pool({ connectionString: boot.ownerUri });
    provider = new EnvKeyProvider();

    // Seed 3 tenants × 2 users × full credential surface.
    for (let t = 0; t < 3; t++) {
      const tenantId = (
        await ownerPool.query<{ id: string }>(
          `INSERT INTO "tenants" ("name") VALUES ($1) RETURNING "id"`,
          [`backfill-test-tenant-${t}`],
        )
      ).rows[0]!.id;

      for (let u = 0; u < 2; u++) {
        const email = `backfill-${t}-${u}@test.local`;
        const userId = (
          await ownerPool.query<{ id: string }>(
            `INSERT INTO "users" ("tenant_id", "email") VALUES ($1, $2) RETURNING "id"`,
            [tenantId, email],
          )
        ).rows[0]!.id;

        // account row with 4 plaintext credential cols
        const accountId = (
          await ownerPool.query<{ id: string }>(
            `INSERT INTO "account"
              ("tenant_id", "user_id", "provider_id", "account_id",
               "access_token", "refresh_token", "id_token", "password")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "id"`,
            [
              tenantId,
              userId,
              "credential",
              email,
              `access-pt-${t}-${u}`,
              `refresh-pt-${t}-${u}`,
              `id-tok-pt-${t}-${u}`,
              `pw-pt-${t}-${u}`,
            ],
          )
        ).rows[0]!.id;
        seeded.push({
          table: "account",
          pk: accountId,
          values: {
            access_token: `access-pt-${t}-${u}`,
            refresh_token: `refresh-pt-${t}-${u}`,
            id_token: `id-tok-pt-${t}-${u}`,
            password: `pw-pt-${t}-${u}`,
          },
        });

        // verification row
        const verId = (
          await ownerPool.query<{ id: string }>(
            `INSERT INTO "verification"
              ("tenant_id", "identifier", "value", "expires_at")
             VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING "id"`,
            [tenantId, email, `verify-pt-${t}-${u}`],
          )
        ).rows[0]!.id;
        seeded.push({
          table: "verification",
          pk: verId,
          values: { value: `verify-pt-${t}-${u}` },
        });

        // sessions row (token always present; previous_token sometimes null)
        const tokenPt = `tok-pt-${t}-${u}`;
        const prevTokenPt = u === 0 ? `prev-tok-pt-${t}-${u}` : null;
        const sesId = (
          await ownerPool.query<{ id: string }>(
            `INSERT INTO "sessions"
              ("tenant_id", "user_id", "token", "previous_token", "expires_at")
             VALUES ($1,$2,$3,$4, now() + interval '1 hour') RETURNING "id"`,
            [tenantId, userId, tokenPt, prevTokenPt],
          )
        ).rows[0]!.id;
        seeded.push({
          table: "sessions",
          pk: sesId,
          values: { token: tokenPt, previous_token: prevTokenPt },
        });

        // oauth_state row
        const osId = (
          await ownerPool.query<{ id: string }>(
            `INSERT INTO "oauth_state"
              ("tenant_id", "provider", "callback_url", "scheme", "code_verifier", "expires_at")
             VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')
             RETURNING "id"`,
            [tenantId, "google", "https://example.test/cb", "openwhispr", `verifier-pt-${t}-${u}`],
          )
        ).rows[0]!.id;
        seeded.push({
          table: "oauth_state",
          pk: osId,
          values: { code_verifier: `verifier-pt-${t}-${u}` },
        });
      }
    }
  }, 120_000);

  afterAll(async () => {
    await ownerPool.end();
    await boot.stop();
    delete process.env.MASTER_KEK;
  });

  it("dry-run scans without writing", async () => {
    const report = await runBackfill({
      ownerPool,
      keyProvider: provider,
      columnMap: COLUMN_MAP,
      dryRun: true,
    });
    // scanned > 0 across the 8 (col,table) pairs we seeded (token, previous_token,
    // verification.value, oauth_state.code_verifier, 4 × account)
    expect(report.account.access_token.scanned).toBeGreaterThan(0);
    expect(report.sessions.token.scanned).toBeGreaterThan(0);
    expect(report.account.access_token.encrypted).toBe(0);
    expect(report.sessions.token.encrypted).toBe(0);

    // DB unchanged: no ciphertext written.
    const { rows } = await ownerPool.query(
      `SELECT count(*)::int as c FROM "account" WHERE "access_token_value_ciphertext" IS NOT NULL`,
    );
    expect(rows[0].c).toBe(0);
  });

  it("encrypts plaintext into 6 bytea sidecars + fingerprint, idempotent on second run", async () => {
    const report = await runBackfill({
      ownerPool,
      keyProvider: provider,
      columnMap: COLUMN_MAP,
      dryRun: false,
      batchSize: 4, // exercise multi-batch loop
    });

    // All 8 (table,column) pairs report encrypted > 0.
    expect(report.account.access_token.encrypted).toBeGreaterThan(0);
    expect(report.account.refresh_token.encrypted).toBeGreaterThan(0);
    expect(report.account.id_token.encrypted).toBeGreaterThan(0);
    expect(report.account.password.encrypted).toBeGreaterThan(0);
    expect(report.verification.value.encrypted).toBeGreaterThan(0);
    expect(report.sessions.token.encrypted).toBeGreaterThan(0);
    // previous_token: half null, half not
    expect(report.sessions.previous_token.encrypted).toBeGreaterThan(0);
    expect(report.oauth_state.code_verifier.encrypted).toBeGreaterThan(0);

    // For one seeded row, verify round-trip + plaintext preserved + fingerprint.
    const sample = seeded.find((s) => s.table === "sessions" && s.values.token != null)!;
    const { rows } = await ownerPool.query(
      `SELECT "token", "token_fp",
              "token_dek_wrapped","token_dek_iv","token_dek_auth_tag",
              "token_value_iv","token_value_auth_tag","token_value_ciphertext"
       FROM "sessions" WHERE "id" = $1`,
      [sample.pk],
    );
    const r = rows[0];
    // Plaintext intact (additive only)
    expect(r.token).toBe(sample.values.token);
    // 6 sidecars populated
    for (const k of [
      "token_dek_wrapped",
      "token_dek_iv",
      "token_dek_auth_tag",
      "token_value_iv",
      "token_value_auth_tag",
      "token_value_ciphertext",
    ]) {
      expect(Buffer.isBuffer(r[k])).toBe(true);
      expect((r[k] as Buffer).length).toBeGreaterThan(0);
    }
    // Fingerprint = sha256(plaintext)
    expect(Buffer.isBuffer(r.token_fp)).toBe(true);
    expect(
      (r.token_fp as Buffer).equals(createHash("sha256").update(sample.values.token!).digest()),
    ).toBe(true);
    // Decrypt round-trips
    const enc: EncryptedRow = {
      dek_wrapped: r.token_dek_wrapped,
      dek_iv: r.token_dek_iv,
      dek_auth_tag: r.token_dek_auth_tag,
      value_iv: r.token_value_iv,
      value_auth_tag: r.token_value_auth_tag,
      value_ciphertext: r.token_value_ciphertext,
    };
    const pt = await decryptValue(provider, enc);
    expect(pt.toString("utf8")).toBe(sample.values.token);

    // Idempotency: second run encrypts 0.
    const second = await runBackfill({
      ownerPool,
      keyProvider: provider,
      columnMap: COLUMN_MAP,
      dryRun: false,
    });
    expect(second.account.access_token.encrypted).toBe(0);
    expect(second.sessions.token.encrypted).toBe(0);
    expect(second.oauth_state.code_verifier.encrypted).toBe(0);
    // skipped reflects rows already encrypted (predicate filter)
    expect(second.account.access_token.scanned).toBe(0);
  });

  it("processes all tenants (BYPASSRLS owner pool)", async () => {
    // Count distinct tenant_ids that have ciphertext on account.access_token.
    const { rows } = await ownerPool.query(
      `SELECT count(DISTINCT tenant_id)::int AS c FROM "account"
       WHERE "access_token_value_ciphertext" IS NOT NULL`,
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(3);
  });

  it("report shape includes scanned/encrypted/skipped/durationMs per (table,column)", async () => {
    const empty: BackfillColumnMap = { verification: { value: {} } };
    const report = await runBackfill({
      ownerPool,
      keyProvider: provider,
      columnMap: empty,
      dryRun: true,
    });
    expect(report.verification.value).toEqual(
      expect.objectContaining({
        scanned: expect.any(Number),
        encrypted: expect.any(Number),
        skipped: expect.any(Number),
        durationMs: expect.any(Number),
      }),
    );
  });

  it("respects --limit-tables / table subset (column-map driven)", async () => {
    // Re-seed a fresh row with plaintext so we have something to act on.
    const tenantId = (
      await ownerPool.query<{ id: string }>(
        `INSERT INTO "tenants" ("name") VALUES ('subset-tenant') RETURNING "id"`,
      )
    ).rows[0]!.id;
    const userId = (
      await ownerPool.query<{ id: string }>(
        `INSERT INTO "users" ("tenant_id", "email") VALUES ($1, 'subset@t') RETURNING "id"`,
        [tenantId],
      )
    ).rows[0]!.id;
    await ownerPool.query(
      `INSERT INTO "verification" ("tenant_id", "identifier", "value", "expires_at")
        VALUES ($1,'subset@t','subset-pt', now() + interval '1 hour')`,
      [tenantId],
    );
    // Subset map: only verification; account untouched.
    const subset: BackfillColumnMap = { verification: { value: {} } };
    const report = await runBackfill({
      ownerPool,
      keyProvider: provider,
      columnMap: subset,
      dryRun: false,
    });
    expect(report.verification.value.encrypted).toBeGreaterThan(0);
    // user-supplied subset means we never touched account in this call
    expect(Object.keys(report)).toEqual(["verification"]);
    // Use userId so it's not unused in the test scope.
    expect(typeof userId).toBe("string");
  });
});

// Phase 67 / Plan 67-01 — HI-04: lens-managed-column guard.
//
// Post-Phase-57 Track A, `apps/api/src/auth.ts:172` `ENCRYPTED_COLUMNS_MAP` is
// POPULATED — the encryption lens encrypts `account.{password,access_token,
// refresh_token,id_token}`, `session.{token,previous_token}` and
// `verification.value` on EVERY Better-Auth write. A bulk `runBackfill` over
// those columns is therefore (a) unnecessary — the lens already did it — and
// (b) data-corrupting — it encrypts into the bytea sidecars while leaving the
// plaintext column populated, so a later lens read silently overwrites Better
// Auth's live plaintext credential. `runBackfill` must REFUSE any lens-managed
// (table,column) pair before touching the DB. The guard is a static
// refuse-list (the review's "while ENCRYPTED_COLUMNS_MAP is empty" framing is
// STALE — the map is populated). The guard must match BOTH the `session`
// model name AND the `sessions` SQL table name (table-name skew).
describe("runBackfill — HI-04 lens-managed-column guard", () => {
  let boot: BootResult;
  let ownerPool: Pool;
  let provider: EnvKeyProvider;
  const kek = makeKek();

  beforeAll(async () => {
    process.env.MASTER_KEK = kek;
    boot = await bootMigratedPostgres({ withPgPartman: true });
    ownerPool = new Pool({ connectionString: boot.ownerUri });
    provider = new EnvKeyProvider();
  }, 180_000);

  afterAll(async () => {
    await ownerPool.end();
    await boot.stop();
    delete process.env.MASTER_KEK;
  });

  // RED 1 — guard refuses each lens-managed (table,column) pair, in BOTH the
  // `account`/`verification` table name forms AND both `session` + `sessions`.
  it.each<[string, BackfillColumnMap]>([
    ["account.access_token", { account: { access_token: {} } }],
    ["account.refresh_token", { account: { refresh_token: {} } }],
    ["account.id_token", { account: { id_token: {} } }],
    ["account.password", { account: { password: {} } }],
    ["verification.value", { verification: { value: {} } }],
    ["session.token (singular model name)", { session: { token: {} } }],
    ["sessions.token (plural SQL name)", { sessions: { token: {} } }],
    ["session.previous_token (singular)", { session: { previous_token: {} } }],
    ["sessions.previous_token (plural)", { sessions: { previous_token: {} } }],
  ])("HI-04: runBackfill refuses lens-managed column %s", async (_label, columnMap) => {
    await expect(
      runBackfill({ ownerPool, keyProvider: provider, columnMap, dryRun: true }),
    ).rejects.toThrow(/lens-managed/i);
  });

  // RED 2 — guard is a NO-OP for a column the lens does NOT manage.
  // `oauth_state.code_verifier` is codec-managed (not lens-managed) and is NOT
  // in the refuse-list — the guard must not throw its lens-managed error here.
  it("HI-04: runBackfill does NOT raise the guard error for a non-lens column", async () => {
    const columnMap: BackfillColumnMap = { oauth_state: { code_verifier: {} } };
    let guardError = false;
    try {
      await runBackfill({ ownerPool, keyProvider: provider, columnMap, dryRun: true });
    } catch (err) {
      if (/lens-managed/i.test((err as Error).message)) guardError = true;
    }
    expect(guardError).toBe(false);
  });
});
