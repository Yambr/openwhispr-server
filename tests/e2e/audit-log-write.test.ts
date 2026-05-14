// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/audit-log-write.test.ts
//
// Phase 6 / Plan 06-12a / Task 2 — DATA-04 audit-log emission e2e.
//
// Originally Plan 12 specified `auth.signin` as the canonical action,
// but per 06-05-SUMMARY the auth.* emissions are DEFERRED to a future
// Better-Auth-hooks plan (BA's databaseHooks fire outside the route's
// withTenant() tx, which requires a dedicated wiring story). Plan 12a
// pivots to `key.issued` — one of the 3 actions Plan 05 actually wired
// (account.delete / key.issued / key.revoked). `key.issued`:
//   * Exercises the tenant-scoped audit row write (RLS gate).
//   * Exercises partition routing via tableoid::regclass (D-A2).
//   * Has a clean POST request + JSON response (doesn't end session).
//   * Carries the T-bearer-leak sentinel — clear-text PAK MUST NOT
//     appear anywhere in the JSONB payload.
//
// Truths asserted:
//   1. POST /api/v1/keys/create succeeds (200) and returns
//      `{data: {id, key: "pak_…", key_prefix, …}}` (D-28 envelope).
//   2. A row exists in `audit_log` with action='key.issued',
//      tenant_id=DEFAULT_TENANT_ID, payload.key_id matching the
//      response id.
//   3. payload carries request_id (Fastify reqId — UUID-or-`req-N`
//      shape per D-05-4) + ip + user_agent (truncated to 512 chars
//      max).
//   4. payload does NOT contain the clear-text PAK or any
//      FORBIDDEN_AUDIT_KEYS (T-bearer-leak sentinel sweep).
//   5. `tableoid::regclass` resolves to a partman child table
//      (`audit_log_p…` or similar — must NOT equal the parent
//      `audit_log` name), confirming partition routing works
//      end-to-end (D-A2).
//
// CLAUDE.md `no mocks of internal logic`: Better Auth real signin,
// real /api/v1/keys/create handler, real withTenant() tx, real
// audit_log INSERT, real pg_partman child routing.

import { CookieJar } from "tough-cookie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKEND_URL,
  type Phase6Stack,
  phase6BringStackUp,
  psqlOwner,
} from "./helpers/phase6-compose.js";

const SUITE_TIMEOUT_MS = 300_000;
const FIXTURE_EMAIL = "fixture@conformance.test";
const FIXTURE_PASSWORD = "test-PW-12345!";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let stack: Phase6Stack | undefined;

interface CreateKeyResponse {
  data: {
    id: string;
    name: string;
    key: string;
    key_prefix: string;
    scopes: string[];
    created_at: string;
  };
}

interface AuditRow {
  action: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  partition_name: string;
  created_at: string;
}

/**
 * Sign in via Better Auth and return a cookie header string usable for
 * subsequent requests. Mirrors `tests/e2e/sign-in.ts` but inline so
 * the test is self-contained (the existing helper depends on
 * `compose-helper.js` BACKEND_URL which equals ours — but importing
 * across helpers risks circular setup since compose-helper boots a
 * different stack profile).
 */
async function signInAndGetCookie(): Promise<string> {
  const jar = new CookieJar();
  const res = await fetch(`${BACKEND_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BACKEND_URL,
      "x-forwarded-for": "10.20.30.40",
    },
    body: JSON.stringify({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD }),
    redirect: "manual",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`signIn failed: HTTP ${res.status} body=${text.slice(0, 300)}`);
  }
  // Aggregate set-cookie headers.
  const setCookies =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  for (const sc of setCookies) {
    await jar.setCookie(sc, BACKEND_URL, { ignoreError: true });
  }
  return jar.getCookieString(BACKEND_URL);
}

describe.skipIf(process.env.E2E !== "1")("audit log sync write e2e (DATA-04, OBS-03, D-A1)", () => {
  beforeAll(async () => {
    stack = await phase6BringStackUp({ seed: true });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (stack) await stack.down();
  }, 120_000);

  it("POST /api/v1/keys/create writes audit_log row with canonical D-A7 keys and partition-routed correctly", async () => {
    if (!stack) throw new Error("stack not initialized");
    const cookie = await signInAndGetCookie();
    expect(cookie.length).toBeGreaterThan(0);

    const keyName = `phase6-e2e-${Date.now()}`;
    const createRes = await fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: BACKEND_URL,
        "x-forwarded-for": "10.20.30.40",
        "user-agent": "openwhispr-phase6-e2e/1.0",
      },
      body: JSON.stringify({ name: keyName }),
    });
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as CreateKeyResponse;
    expect(createBody.data.key.startsWith("pak_")).toBe(true);
    const keyId = createBody.data.id;
    const clearPak = createBody.data.key;
    expect(keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Give the txn 1s to commit through PgBouncer's transaction-mode
    // pool. The audit row is written in the same withTenant() tx as
    // the api_keys INSERT (D-A1), so once /create returns 200 the
    // row is durable; the sleep is paranoia, not correctness.
    await new Promise((r) => setTimeout(r, 1000));

    // Query the audit_log directly via psql inside the postgres
    // container (no host port exposed; see helpers/phase6-compose.ts).
    // Pull tableoid::regclass to assert the row landed on a partman
    // child, NOT the parent (D-A2 partition routing).
    const sql = `
          SELECT
            action,
            tenant_id::text AS tenant_id,
            payload::text AS payload,
            (tableoid::regclass)::text AS partition_name,
            created_at::text AS created_at
          FROM audit_log
          WHERE action='key.issued'
            AND tenant_id='${DEFAULT_TENANT_ID}'::uuid
            AND payload->>'key_id'='${keyId}'
          ORDER BY created_at DESC
          LIMIT 1
        `;
    const stdout = await psqlOwner(stack.postgres, "openwhispr", sql);
    expect(stdout.trim().length).toBeGreaterThan(0);

    // psql -At emits one row, columns separated by '|'.
    const cols = stdout.trim().split("\n")[0]?.split("|") ?? [];
    expect(cols.length).toBe(5);
    const row: AuditRow = {
      action: cols[0] ?? "",
      tenant_id: cols[1] ?? "",
      payload: JSON.parse(cols[2] ?? "{}") as Record<string, unknown>,
      partition_name: cols[3] ?? "",
      created_at: cols[4] ?? "",
    };

    // Truth #1 — action + tenant.
    expect(row.action).toBe("key.issued");
    expect(row.tenant_id).toBe(DEFAULT_TENANT_ID);

    // Truth #2 — D-A7 required keys in payload.
    expect(row.payload.key_id).toBe(keyId);
    expect(typeof row.payload.request_id).toBe("string");
    expect((row.payload.request_id as string).length).toBeGreaterThan(0);
    // ip may be null (AUDIT_REDACT_IP=true) OR a string; assert it's
    // present as a key (the recordAudit helper always writes it).
    expect("ip" in row.payload).toBe(true);
    expect(typeof row.payload.user_agent).toBe("string");
    expect((row.payload.user_agent as string).length).toBeLessThanOrEqual(512);
    expect(row.payload.user_agent).toContain("openwhispr-phase6-e2e");

    // Truth #3 — sentinel sweep (T-bearer-leak).
    const payloadJson = JSON.stringify(row.payload);
    expect(payloadJson.includes(clearPak)).toBe(false);
    // Belt-and-suspenders — FORBIDDEN_AUDIT_KEYS top-level rejection
    // is enforced by recordAudit, but verify the absence here too.
    for (const forbidden of [
      "password",
      "token",
      "bearer",
      "access_token",
      "refresh_token",
      "api_key",
      "authorization",
    ]) {
      expect(Object.keys(row.payload).map((k) => k.toLowerCase())).not.toContain(forbidden);
    }

    // Truth #4 — partition routing (D-A2). The parent table is
    // `audit_log`; partman children carry a suffix (`audit_log_p…`
    // or similar). The exact suffix depends on partman's naming
    // template (verified against packages/data/src/__tests__/
    // audit-log-partitioning.test.ts which asserts `!== "audit_log"`
    // AND `matches /audit_log/`). We replicate those invariants.
    expect(row.partition_name).not.toBe("audit_log");
    expect(row.partition_name).toMatch(/audit_log/);
  }, 120_000);
});
