// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.16 — Group H closure.
//
// mintBearer must derive token_endpoint / userinfo_endpoint from the
// OIDC issuer's discovery doc when explicit OIDC_TOKEN_URL /
// OIDC_USERINFO_URL env overrides are unset. Real-world operators set
// ONE env var (OIDC_ISSUER_URL) and rely on RFC 8414 / OpenID Connect
// Discovery 1.0 to resolve the rest. The previous behavior (require
// three env vars) was a coupling bug surfaced by Phase 02.15 closing
// Group G transport: the contract-test profile sets only OIDC_ISSUER_URL
// (matching how real operators configure OIDC), and mintBearer threw
// "OIDC_TOKEN_URL is not configured" before any IdP call → 500 from
// the centralized envelope.
//
// Behaviour under test:
//   1. When OIDC_TOKEN_URL is unset, mintBearer fetches
//      `${OIDC_ISSUER_URL}/.well-known/openid-configuration` and uses
//      its `token_endpoint`.
//   2. Same for `userinfo_endpoint`.
//   3. When the explicit env override IS set, it wins (no discovery
//      fetch — operator-overrides are for non-conforming IdPs and must
//      not pay the discovery roundtrip cost).
//
// Reverts: removing the discoverOidc helper from mint-bearer.ts (or
// restoring `requireEnv("OIDC_TOKEN_URL")`) → all three tests RED.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOidcDiscoveryCacheForTests,
  buildMintBearer,
} from "../../../src/lib/mint-bearer.js";

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
    findUserByEmail: vi.fn().mockResolvedValue({ user: { id: "u1" }, accounts: [] }),
    createOAuthUser: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ token: FAKE_TOKEN, userId: "u1" }),
  };
  const auth = {
    $context: Promise.resolve({ internalAdapter: ia }),
  };
  return { auth, ia };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_ENV = { ...process.env };

describe("buildMintBearer — OIDC discovery (Phase 02.16 / Group H)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
    __resetOidcDiscoveryCacheForTests();
    vi.stubEnv("OIDC_CLIENT_ID", "client-id-fixture");
    vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret-fixture");
    vi.stubEnv("OIDC_ISSUER_URL", "http://idp.test");
    // Explicit endpoint env vars intentionally NOT stubbed — that is the
    // fixture-idp / real-operator config we are closing Group H against.
    delete process.env.OIDC_TOKEN_URL;
    delete process.env.OIDC_USERINFO_URL;
    vi.stubEnv("AUTH_URL", "https://api.localhost");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
  });

  it("Test 1 — discovers token_endpoint from ${OIDC_ISSUER_URL}/.well-known/openid-configuration", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const u = typeof url === "string" ? url : url.toString();
      if (u === "http://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "http://idp.test",
          token_endpoint: "http://idp.test/discovered-token",
          userinfo_endpoint: "http://idp.test/discovered-userinfo",
        });
      }
      if (u === "http://idp.test/discovered-token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "http://idp.test/discovered-userinfo") {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    const tokenCall = fetchSpy.mock.calls.find(
      (c) =>
        (typeof c[0] === "string" ? c[0] : (c[0] as URL).toString()) ===
        "http://idp.test/discovered-token",
    );
    expect(tokenCall).toBeDefined();
    expect((tokenCall?.[1] as RequestInit).method).toBe("POST");
  });

  it("Test 2 — discovers userinfo_endpoint from the same discovery doc", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "http://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "http://idp.test",
          token_endpoint: "http://idp.test/discovered-token",
          userinfo_endpoint: "http://idp.test/discovered-userinfo",
        });
      }
      if (u === "http://idp.test/discovered-token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "http://idp.test/discovered-userinfo") {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    const uiCall = fetchSpy.mock.calls.find(
      (c) =>
        (typeof c[0] === "string" ? c[0] : (c[0] as URL).toString()) ===
        "http://idp.test/discovered-userinfo",
    );
    expect(uiCall).toBeDefined();
  });

  it("Test 3 — explicit OIDC_TOKEN_URL / OIDC_USERINFO_URL env override wins (no discovery fetch)", async () => {
    vi.stubEnv("OIDC_TOKEN_URL", "https://override.test/token");
    vi.stubEnv("OIDC_USERINFO_URL", "https://override.test/userinfo");
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://override.test/token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "https://override.test/userinfo") {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await mint(ARGS);

    // No call to discovery doc — explicit overrides bypass it entirely.
    const discoveryCall = fetchSpy.mock.calls.find((c) => {
      const u = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
      return u.includes("/.well-known/openid-configuration");
    });
    expect(discoveryCall).toBeUndefined();
  });

  it("Test 4 — discovery doc non-2xx surfaces as 'discovery <status>' error (no body leak)", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "http://idp.test/.well-known/openid-configuration") {
        return new Response("PII-LEAK-IN-DISCOVERY-BODY", { status: 502 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/discovery 502/);
    await expect(mint(ARGS)).rejects.not.toThrow(/PII-LEAK-IN-DISCOVERY-BODY/);
  });
});
