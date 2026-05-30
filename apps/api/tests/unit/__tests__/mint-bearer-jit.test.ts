// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-04 / Task 1 — desktop bearer-mint JIT seam (unit, boundary-mocked).
//
// D-69-1 Option C, second call-site: the desktop path bypasses genericOAuth, so
// mapProfileToUser never fires there. mint-bearer must call the SAME pure
// `resolveJitDecision` on BOTH branches:
//   * NEW user  (createOAuthUser path)   — project {tenantId, role} into the user arg.
//   * RETURNING user (the if(existing) reuse-userId path) — re-sync role (mode 5) or
//     reject tenant-mismatch (mode 6), full web/desktop parity.
//
// Mock strategy (CLAUDE.md no-internal-mocks): we mock ONLY the HTTP boundary
// (the userinfo/token fetch) and the Better Auth internalAdapter + the DB
// surface that mint-bearer uses for the returning-user re-sync persist + audit.
// The resolver + the audit payload schema (real recordAudit) are NOT mocked —
// they run for real against an in-memory tx fake so we assert the real shapes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMintBearer } from "../../../src/lib/mint-bearer.js";

const ARGS = {
  code: "abc",
  codeVerifier: "verifier-xyz",
  stateId: "11111111-2222-3333-4444-555555555555",
  provider: "oidc",
  tenantId: "00000000-0000-0000-0000-000000000000",
  scheme: "openwhispr",
};

const FAKE_TOKEN = "a".repeat(32);

// acme maps to the DEFAULT tenant — the ONLY tenant a JIT create may land in
// under the v1 single-installation-single-tenant posture (CLAUDE.md rule 16),
// matching the live @sso fixture (keycloak-api-env.yml: acme.example →
// 00000000-…). globex maps to a NON-default tenant, used to exercise the
// new-user-into-foreign-tenant + returning-user-mismatch rejections.
const ACME_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const GLOBEX_TENANT_ID = "22222222-2222-2222-2222-222222222222";

// The JIT config the seam reads is loaded from process.env via readJitConfig();
// `jitEnv()` below stubs the matching env vars so the production loader sees the
// same acme/globex mapping + admin/member group mapping the assertions expect.

interface FakeInternalAdapter {
  findUserByEmail: ReturnType<typeof vi.fn>;
  createOAuthUser: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
}

/** Captured INSERT/UPDATE SQL from the in-memory tx fake (real recordAudit runs through it). */
interface CapturedSql {
  text: string;
  values: unknown[];
}

function chunksToText(query: unknown): CapturedSql {
  const q = query as { queryChunks?: unknown[]; strings?: string[]; params?: unknown[] };
  const chunks = q.queryChunks ?? [];
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        parts.push((v as string[]).join(""));
      } else {
        parts.push("?");
        values.push(v);
      }
    } else {
      parts.push(String(c));
    }
  }
  return { text: parts.join(""), values };
}

/**
 * In-memory DB fake matching the `withTenant(db, tenant, cb)` contract: `db.transaction`
 * yields a tx whose `.execute` records SQL. Returns a usersRow for the identity SELECT so
 * the returning-user branch can read the persisted {tenant_id, role}.
 */
function makeFakeDb(opts: {
  captured: CapturedSql[];
  identityRow?: { tenant_id: string; role: string } | null;
}) {
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const parsed = chunksToText(query);
      opts.captured.push(parsed);
      if (/set_config/i.test(parsed.text)) return { rows: [] };
      if (/SELECT\s+tenant_id,\s*role\s+FROM\s+users/i.test(parsed.text)) {
        return { rows: opts.identityRow ? [opts.identityRow] : [] };
      }
      return { rows: [] };
    },
  };
  return {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
}

function buildFakeAuth(): {
  auth: { $context: Promise<{ internalAdapter: FakeInternalAdapter }> };
  ia: FakeInternalAdapter;
} {
  const ia: FakeInternalAdapter = {
    findUserByEmail: vi.fn(),
    createOAuthUser: vi
      .fn()
      .mockResolvedValue({ user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000005" }, account: {} }),
    createSession: vi.fn().mockResolvedValue({ token: FAKE_TOKEN, userId: "u1" }),
  };
  const auth = { $context: Promise.resolve({ internalAdapter: ia }) };
  return { auth, ia };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Boundary-mock: token endpoint + userinfo (carrying the supplied claims). */
function stubFetch(userinfo: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u === "https://idp.test/token") {
      return jsonResponse({ access_token: "AT", id_token: "IDT" });
    }
    return jsonResponse(userinfo);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function jitEnv(): void {
  vi.stubEnv("OIDC_TENANT_CLAIM", "tenant");
  vi.stubEnv("OIDC_GROUP_CLAIM", "groups");
  vi.stubEnv(
    "OIDC_TENANT_MAPPING",
    JSON.stringify({ acme: ACME_TENANT_ID, globex: GLOBEX_TENANT_ID }),
  );
  vi.stubEnv(
    "OIDC_ROLE_MAPPING",
    JSON.stringify({ "openwhispr-admins": "admin", "openwhispr-engineering": "member" }),
  );
}

describe("buildMintBearer JIT seam (Phase 69 / Plan 69-04 / D-69-1)", () => {
  beforeEach(() => {
    // NOTE: never reassign `process.env` — readJitConfig captures the
    // `process.env` reference at module load (DEFAULT_ENV). Reassigning the
    // object would orphan that reference; `vi.stubEnv` mutates in place, so the
    // stubbed JIT vars are visible to the loader.
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("OIDC_CLIENT_ID", "client-id-fixture");
    vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret-fixture");
    vi.stubEnv("OIDC_TOKEN_URL", "https://idp.test/token");
    vi.stubEnv("OIDC_USERINFO_URL", "https://idp.test/userinfo");
    vi.stubEnv("AUTH_URL", "https://api.localhost");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ── NEW-user branch ─────────────────────────────────────────────────────
  it("new user: projects resolved {tenantId, role} into createOAuthUser's user arg", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({
      sub: "sub-1",
      email: "alice@acme.example",
      name: "Alice",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    const bearer = await mint(ARGS);

    expect(ia.createOAuthUser).toHaveBeenCalledTimes(1);
    const userArg = ia.createOAuthUser.mock.calls[0]?.[0] as {
      tenantId?: string;
      role?: string;
    };
    expect(userArg.tenantId).toBe(ACME_TENANT_ID);
    expect(userArg.role).toBe("member");
    expect(bearer).toBe(FAKE_TOKEN);
  });

  it("new user: account.scope includes the group scope (no longer the bare 'openid email profile')", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({ sub: "s", email: "a@acme.example", tenant: "acme", groups: ["openwhispr-admins"] });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await mint(ARGS);

    const accountArg = ia.createOAuthUser.mock.calls[0]?.[1] as { scope?: string };
    expect(accountArg.scope).toContain("groups");
  });

  it("new user, unknown tenant: does NOT call createOAuthUser and surfaces the rejection (no bearer)", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({ sub: "s", email: "x@unknown.example", tenant: "no-such", groups: [] });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_unknown_tenant" });
    expect(ia.createOAuthUser).not.toHaveBeenCalled();
    expect(ia.createSession).not.toHaveBeenCalled();
  });

  it("new user resolving to a NON-default tenant: refuses cleanly (403 forbidden_tenant_mismatch), no createOAuthUser, no RLS 500", async () => {
    // v1 single-tenant: only DEFAULT_TENANT_ID is a valid JIT landing tenant
    // (CLAUDE.md rule 16). A known-but-non-default tenant (globex) must be
    // refused BEFORE createOAuthUser, else the users RLS policy rejects the
    // INSERT and the DrizzleQueryError leaks as an unmapped HTTP 500
    // (live @cjm-sso-1.5a: carol@globex.example).
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({
      sub: "s",
      email: "newcomer@globex.example",
      tenant: "globex",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_tenant_mismatch" });
    expect(ia.createOAuthUser).not.toHaveBeenCalled();
    expect(ia.createSession).not.toHaveBeenCalled();
    // sso.jit.rejected audit row scoped to the DEFAULT tenant, never globex.
    const auditIdx = captured.findIndex(
      (c) => /INSERT INTO audit_log/i.test(c.text) && /sso\.jit\.rejected/.test(c.text),
    );
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    const rejectionSetConfig = [...captured.slice(0, auditIdx + 1)]
      .reverse()
      .find((c) => /set_config/i.test(c.text));
    expect(rejectionSetConfig?.text ?? "").not.toContain(GLOBEX_TENANT_ID);
    expect(rejectionSetConfig?.text ?? "").toContain("00000000-0000-0000-0000-000000000000");
  });

  // ── RETURNING-user branch (the if(existing) parity gap) ──────────────────
  it("returning user, group changed (admin → member): re-syncs role + emits sso.jit.role.updated; bearer still minted", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000001" },
      accounts: [],
    });
    // userinfo now carries only the engineering (member) group; existing role is admin.
    stubFetch({
      sub: "s",
      email: "bob@acme.example",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured, identityRow: { tenant_id: ACME_TENANT_ID, role: "admin" } });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    const bearer = await mint(ARGS);

    expect(ia.createOAuthUser).not.toHaveBeenCalled();
    expect(bearer).toBe(FAKE_TOKEN);
    // a role UPDATE on the existing user row was issued
    const roleUpdate = captured.find((c) => /UPDATE\s+users\s+SET\s+role/i.test(c.text));
    expect(roleUpdate).toBeDefined();
    // a sso.jit.role.updated audit row was inserted
    const audit = captured.find(
      (c) => /INSERT INTO audit_log/i.test(c.text) && /sso\.jit\.role\.updated/.test(c.text),
    );
    expect(audit).toBeDefined();
  });

  it("returning user, tenant claim changed: 403 forbidden_tenant_mismatch + sso.jit.rejected; no reuse, no bearer", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000002" },
      accounts: [],
    });
    // existing row is in acme; userinfo now claims globex.
    stubFetch({
      sub: "s",
      email: "carol@acme.example",
      tenant: "globex",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    // identity lookup under the RESOLVED (globex) tenant returns nothing — the row is in acme.
    const db = makeFakeDb({ captured, identityRow: null });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_tenant_mismatch" });
    expect(ia.createSession).not.toHaveBeenCalled();
    const roleUpdate = captured.find((c) => /UPDATE\s+users\s+SET\s+role/i.test(c.text));
    expect(roleUpdate).toBeUndefined();
    const auditIdx = captured.findIndex(
      (c) => /INSERT INTO audit_log/i.test(c.text) && /sso\.jit\.rejected/.test(c.text),
    );
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    // The mode-6 rejection audit MUST be scoped to the DEFAULT tenant, NOT the
    // resolved-but-mismatched (globex) tenant. The mismatched tenant may have no
    // seeded row (it does not in the live realm), so a withTenant() under it
    // FK/RLS-fails and masks the intended 403 with a 500 (live @cjm-sso-1.5a).
    // The set_config that opens the rejection-audit tx is the LAST set_config
    // captured at-or-before the audit INSERT; assert it binds the DEFAULT tenant,
    // not globex. (globex legitimately appears earlier — the persisted-identity
    // read runs under the resolved tenant to DETECT the mismatch.)
    const rejectionSetConfig = [...captured.slice(0, auditIdx + 1)]
      .reverse()
      .find((c) => /set_config/i.test(c.text));
    expect(rejectionSetConfig?.text ?? "").not.toContain(GLOBEX_TENANT_ID);
    expect(rejectionSetConfig?.text ?? "").toContain("00000000-0000-0000-0000-000000000000");
  });

  it("returning user, unchanged group + tenant: no role write, no audit, bearer minted", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000003" },
      accounts: [],
    });
    stubFetch({
      sub: "s",
      email: "dan@acme.example",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured, identityRow: { tenant_id: ACME_TENANT_ID, role: "member" } });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    const bearer = await mint(ARGS);

    expect(bearer).toBe(FAKE_TOKEN);
    const roleUpdate = captured.find((c) => /UPDATE\s+users\s+SET\s+role/i.test(c.text));
    expect(roleUpdate).toBeUndefined();
    const audit = captured.find((c) => /INSERT INTO audit_log/i.test(c.text));
    expect(audit).toBeUndefined();
  });

  it("returning user, claims resolve to an unknown tenant: rejects (no bearer, no role write, sso.jit.rejected)", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000006" },
      accounts: [],
    });
    // The returning user's tenant claim is no longer in the mapping → the FIRST
    // resolveJitDecision (no existing arg) rejects before the identity read.
    stubFetch({
      sub: "s",
      email: "ghost@no-such.example",
      tenant: "no-such",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured, identityRow: { tenant_id: ACME_TENANT_ID, role: "member" } });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_unknown_tenant" });
    expect(ia.createSession).not.toHaveBeenCalled();
    const roleUpdate = captured.find((c) => /UPDATE\s+users\s+SET\s+role/i.test(c.text));
    expect(roleUpdate).toBeUndefined();
    const audit = captured.find(
      (c) => /INSERT INTO audit_log/i.test(c.text) && /sso\.jit\.rejected/.test(c.text),
    );
    expect(audit).toBeDefined();
  });

  // ── Structured STDOUT emit (Phase 69 fix — @cjm-sso 1.1/1.3) ─────────────
  // The desktop path uses the RAW internal adapter (createOAuthUser); its
  // Better-Auth create.after/update.after hooks are queued post-transaction and
  // were observed NOT to flush a sso.jit.* stdout line under the RLS-wrapped
  // adapter (live run15). The @cjm-sso e2e greps `docker compose logs api` for
  // the structured event (there is no audit-read route), so mint-bearer MUST emit
  // the event to the injected `log` itself — not rely on the queued DB hook.
  function makeLog(): {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    events: () => string[];
  } {
    const info = vi.fn();
    const warn = vi.fn();
    return {
      info,
      warn,
      events: () =>
        [...info.mock.calls, ...warn.mock.calls]
          .map((c) => (c[0] as { event?: string } | undefined)?.event)
          .filter((e): e is string => typeof e === "string"),
    };
  }

  it("new user: emits sso.jit.user.created to the structured log (not just the audit row)", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({
      sub: "sub-1",
      email: "alice@acme.example",
      name: "Alice",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });
    const log = makeLog();

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
      log,
    });
    await mint(ARGS);

    expect(log.events()).toContain("sso.jit.user.created");
    const call = log.info.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "sso.jit.user.created",
    );
    expect(call?.[0]).toMatchObject({ tenant_id: ACME_TENANT_ID, role: "member" });
  });

  it("returning user, group changed: emits sso.jit.role.updated to the structured log", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000001" },
      accounts: [],
    });
    stubFetch({
      sub: "s",
      email: "bob@acme.example",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured, identityRow: { tenant_id: ACME_TENANT_ID, role: "admin" } });
    const log = makeLog();

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
      log,
    });
    await mint(ARGS);

    expect(log.events()).toContain("sso.jit.role.updated");
    const call = log.info.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "sso.jit.role.updated",
    );
    expect(call?.[0]).toMatchObject({
      before: "admin",
      after: "member",
      reason: "revocation_downgrade",
    });
  });

  it("returning user, tenant mismatch: emits sso.jit.rejected to the structured log (warn)", async () => {
    jitEnv();
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000002" },
      accounts: [],
    });
    stubFetch({
      sub: "s",
      email: "carol@acme.example",
      tenant: "globex",
      groups: ["openwhispr-engineering"],
    });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured, identityRow: null });
    const log = makeLog();

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
      log,
    });
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_tenant_mismatch" });

    expect(log.events()).toContain("sso.jit.rejected");
    const call = log.warn.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "sso.jit.rejected",
    );
    expect(call?.[0]).toMatchObject({ code: "forbidden_tenant_mismatch" });
  });

  it("token response failing schema validation throws (no body leak) — UNCHANGED guard", async () => {
    jitEnv();
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        // missing access_token → OidcTokenResponseSchema.safeParse fails
        return jsonResponse({ id_token: "IDT" });
      }
      return jsonResponse({ sub: "s", email: "x@acme.example", tenant: "acme" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/token response failed schema validation/);
  });

  // ── Backward-compat: JIT disabled ────────────────────────────────────────
  it("JIT disabled (OIDC_TENANT_CLAIM unset): new user createOAuthUser arg has no tenantId/role, scope is the legacy string", async () => {
    // No jitEnv() → readJitConfig returns null.
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    stubFetch({ sub: "s", email: "legacy@example.com", name: "Legacy" });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    const bearer = await mint(ARGS);

    expect(bearer).toBe(FAKE_TOKEN);
    const userArg = ia.createOAuthUser.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(userArg.tenantId).toBeUndefined();
    expect(userArg.role).toBeUndefined();
    const accountArg = ia.createOAuthUser.mock.calls[0]?.[1] as { scope?: string };
    expect(accountArg.scope).toBe("openid email profile");
  });

  it("JIT disabled: returning user is reused verbatim with no resolver call, no role write", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "aaaaaaaa-bbbb-cccc-dddd-000000000004" },
      accounts: [],
    });
    stubFetch({ sub: "s", email: "old@example.com" });
    const captured: CapturedSql[] = [];
    const db = makeFakeDb({ captured });

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
      db: db as unknown as Parameters<typeof buildMintBearer>[0]["db"],
    });
    const bearer = await mint(ARGS);

    expect(bearer).toBe(FAKE_TOKEN);
    expect(ia.createSession).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-000000000004", false);
    const roleUpdate = captured.find((c) => /UPDATE\s+users\s+SET\s+role/i.test(c.text));
    expect(roleUpdate).toBeUndefined();
  });
});
