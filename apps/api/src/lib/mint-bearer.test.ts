// SPDX-License-Identifier: Apache-2.0
// Phase 02.7 / Plan 02.7-02 / D-01 — `buildMintBearer` adapter unit tests.
//
// Source-of-record commit: <filled at commit time>
//
// Reverts: restoring the old auth.handler('/api/auth/oauth2/callback/...')
// delegation in mint-bearer.ts → Better Auth's callbackOAuth route reads
// PKCE state from its own `verification` table (not our `oauth_state`
// table) → 400 state_not_found → all tests below RED.
//
// Behaviour under test (per RESEARCH §D-01 "Recommended (plain fetch)"):
//   1. POSTs to OIDC_TOKEN_URL with form-urlencoded body containing
//      grant_type=authorization_code, code, code_verifier, redirect_uri,
//      client_id, client_secret.
//   2. GETs OIDC_USERINFO_URL with `Authorization: Bearer <access_token>`.
//   3. Calls auth.$context.internalAdapter.findUserByEmail(email.toLowerCase()).
//   4. If user exists → reuses user.id; else createOAuthUser({email: lowercased, ...},
//      {providerId, accountId: profile.sub, ...}).
//   5. createSession(userId, false) → returns the raw session.token (32 chars).
//   6. On token-exchange non-2xx, throws Error matching /token exchange <status>/.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMintBearer } from "./mint-bearer.js";

const ARGS = {
  code: "abc",
  codeVerifier: "verifier-xyz",
  stateId: "11111111-2222-3333-4444-555555555555",
  provider: "oidc",
  tenantId: "00000000-0000-0000-0000-000000000000",
  scheme: "openwhispr",
};

const FAKE_TOKEN = "a".repeat(32);

interface FakeInternalAdapter {
  findUserByEmail: ReturnType<typeof vi.fn>;
  createOAuthUser: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
}

function buildFakeAuth(): {
  auth: { $context: Promise<{ internalAdapter: FakeInternalAdapter }> };
  ia: FakeInternalAdapter;
} {
  const ia: FakeInternalAdapter = {
    findUserByEmail: vi.fn(),
    createOAuthUser: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ token: FAKE_TOKEN, userId: "u1" }),
  };
  const auth = {
    $context: Promise.resolve({ internalAdapter: ia }),
  };
  return { auth, ia };
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_ENV = { ...process.env };

describe("buildMintBearer (Phase 02.7 / D-01)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
    vi.stubEnv("OIDC_CLIENT_ID", "client-id-fixture");
    vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret-fixture");
    vi.stubEnv("OIDC_TOKEN_URL", "https://idp.test/token");
    vi.stubEnv("OIDC_USERINFO_URL", "https://idp.test/userinfo");
    vi.stubEnv("AUTH_URL", "https://api.localhost");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
  });

  it("Test 1 — POSTs to token endpoint with correct form body", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({ user: { id: "u1" }, accounts: [] });
    const fetchSpy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT", id_token: "IT" });
      }
      return tokenResponse({ sub: "sub-1", email: "user@example.com" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    expect(fetchSpy).toHaveBeenCalled();
    const tokenCall = fetchSpy.mock.calls.find(
      (c) =>
        (typeof c[0] === "string" ? c[0] : (c[0] as URL).toString()) === "https://idp.test/token",
    );
    expect(tokenCall).toBeDefined();
    const init = tokenCall![1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    const ct = headers["content-type"] ?? headers["Content-Type"] ?? "";
    expect(ct).toMatch(/application\/x-www-form-urlencoded/);
    const body =
      init.body instanceof URLSearchParams ? init.body : new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("abc");
    expect(body.get("code_verifier")).toBe("verifier-xyz");
    expect(body.get("redirect_uri")).toBe("https://api.localhost/api/auth/desktop-callback/oidc");
    expect(body.get("client_id")).toBe("client-id-fixture");
    expect(body.get("client_secret")).toBe("client-secret-fixture");
  });

  it("Test 2 — GETs userinfo with Authorization: Bearer <access_token>", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({ user: { id: "u1" }, accounts: [] });
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "ACCESS-TOKEN-XYZ" });
      }
      // Userinfo
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.authorization ?? headers.Authorization ?? "";
      expect(auth).toBe("Bearer ACCESS-TOKEN-XYZ");
      return tokenResponse({ sub: "sub-1", email: "user@example.com" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    const uiCall = fetchSpy.mock.calls.find(
      (c) =>
        (typeof c[0] === "string" ? c[0] : (c[0] as URL).toString()) ===
        "https://idp.test/userinfo",
    );
    expect(uiCall).toBeDefined();
  });

  it("Test 3 — lowercases the IdP-returned email before findUserByEmail AND createOAuthUser", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null); // force createOAuthUser
    ia.createOAuthUser.mockResolvedValue({
      user: { id: "new-user-id" },
      account: {},
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT" });
      }
      return tokenResponse({ sub: "sub-1", email: "Mixed@Case.test", name: "M C" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    expect(ia.findUserByEmail).toHaveBeenCalledWith("mixed@case.test");
    expect(ia.createOAuthUser).toHaveBeenCalledTimes(1);
    const userArg = ia.createOAuthUser.mock.calls[0]![0] as { email: string };
    expect(userArg.email).toBe("mixed@case.test");
  });

  it("Test 4 — existing user → createSession(user.id) → returns session.token", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue({
      user: { id: "u1" },
      accounts: [],
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT" });
      }
      return tokenResponse({ sub: "sub-1", email: "user@example.com" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    const bearer = await mint(ARGS);

    expect(ia.createOAuthUser).not.toHaveBeenCalled();
    expect(ia.createSession).toHaveBeenCalledTimes(1);
    expect(ia.createSession.mock.calls[0]![0]).toBe("u1");
    expect(bearer).toBe(FAKE_TOKEN);
  });

  it("Test 5 — new user → createOAuthUser({providerId, accountId:profile.sub}) → createSession(new id)", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    ia.createOAuthUser.mockResolvedValue({
      user: { id: "newly-created-uid" },
      account: {},
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT", id_token: "IDT" });
      }
      return tokenResponse({
        sub: "idp-sub-42",
        email: "newuser@example.com",
        name: "New User",
        picture: "https://idp.test/avatar.png",
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    const bearer = await mint(ARGS);

    expect(ia.createOAuthUser).toHaveBeenCalledTimes(1);
    const [userArg, accountArg] = ia.createOAuthUser.mock.calls[0]! as [
      { email: string; name: string; emailVerified: boolean; image: string | null },
      { providerId: string; accountId: string; accessToken?: string; idToken?: string | null },
    ];
    expect(userArg.email).toBe("newuser@example.com");
    expect(userArg.name).toBe("New User");
    expect(userArg.emailVerified).toBe(true);
    expect(userArg.image).toBe("https://idp.test/avatar.png");
    expect(accountArg.providerId).toBe("oidc");
    expect(accountArg.accountId).toBe("idp-sub-42");
    expect(accountArg.accessToken).toBe("AT");
    expect(accountArg.idToken).toBe("IDT");
    expect(ia.createSession.mock.calls[0]![0]).toBe("newly-created-uid");
    expect(bearer).toBe(FAKE_TOKEN);
  });

  it("Test 6 — token-exchange non-2xx throws with status in message", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return new Response("bad request", { status: 400 });
      }
      return tokenResponse({ sub: "x", email: "x@y.test" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/token exchange 400/);
  });

  it("Test 7a — userinfo non-2xx throws with status (provider name only, no body leak)", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT" });
      }
      return new Response("PII-LEAK-IN-BODY", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/userinfo 401/);
    // T-02.7-07: error must NOT include the response body.
    await expect(mint(ARGS)).rejects.not.toThrow(/PII-LEAK-IN-BODY/);
  });

  it("Test 7b — new user without name/picture defaults name to email + image to null", async () => {
    const { auth, ia } = buildFakeAuth();
    ia.findUserByEmail.mockResolvedValue(null);
    ia.createOAuthUser.mockResolvedValue({
      user: { id: "uid-2" },
      account: {},
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return tokenResponse({ access_token: "AT" }); // no id_token
      }
      // No name, no picture
      return tokenResponse({ sub: "sub-7b", email: "noname@example.com" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);
    const [userArg, accountArg] = ia.createOAuthUser.mock.calls[0]! as [
      { email: string; name: string; image: string | null },
      { idToken: string | null },
    ];
    expect(userArg.name).toBe("noname@example.com"); // name ?? email
    expect(userArg.image).toBeNull(); // picture ?? null
    expect(accountArg.idToken).toBeNull(); // id_token ?? null
  });

  it("Test 8 — missing OIDC_CLIENT_ID throws fast (fail-fast env validation)", async () => {
    vi.stubEnv("OIDC_CLIENT_ID", "");
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/OIDC_CLIENT_ID/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
