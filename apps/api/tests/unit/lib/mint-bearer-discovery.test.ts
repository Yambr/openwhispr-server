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
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test");
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
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "https://idp.test/discovered-token",
          userinfo_endpoint: "https://idp.test/discovered-userinfo",
        });
      }
      if (u === "https://idp.test/discovered-token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "https://idp.test/discovered-userinfo") {
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
        "https://idp.test/discovered-token",
    );
    expect(tokenCall).toBeDefined();
    expect((tokenCall?.[1] as RequestInit).method).toBe("POST");
  });

  it("Test 2 — discovers userinfo_endpoint from the same discovery doc", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "https://idp.test/discovered-token",
          userinfo_endpoint: "https://idp.test/discovered-userinfo",
        });
      }
      if (u === "https://idp.test/discovered-token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "https://idp.test/discovered-userinfo") {
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
        "https://idp.test/discovered-userinfo",
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
      if (u === "https://idp.test/.well-known/openid-configuration") {
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

  it("HI-04 — discovery doc missing token_endpoint fails schema validation (NOT cached)", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        // No token_endpoint — an unchecked cast would accept this.
        return jsonResponse({
          issuer: "https://idp.test",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/schema validation/);
    // A second call must re-fetch — the bad doc was NOT cached.
    await expect(mint(ARGS)).rejects.toThrow(/schema validation/);
    const discoveryCalls = fetchSpy.mock.calls.filter((c) => {
      const u = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
      return u.includes("/.well-known/openid-configuration");
    });
    expect(discoveryCalls.length).toBe(2);
  });

  it("HI-04 — discovery doc with a non-URL token_endpoint fails schema validation", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "not-a-url",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/schema validation/);
  });

  it("HI-04 — discovery doc whose token_endpoint is a cross-origin attacker URL is rejected", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        // Origin-swap attack — token endpoint points at an attacker.
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "https://attacker.example/steal",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/origin not affiliated/);
  });

  it("HI-04 — discovery doc with an http:// token_endpoint is rejected (https required)", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "http://idp.test/token",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/must be https/);
  });

  it("HI-04 — a cross-origin endpoint in OIDC_DISCOVERY_ALLOWED_ORIGINS is accepted", async () => {
    vi.stubEnv("OIDC_DISCOVERY_ALLOWED_ORIGINS", "https://idp-token.test");
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "https://idp-token.test/token",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      if (u === "https://idp-token.test/token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "https://idp.test/userinfo") {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).resolves.toBeDefined();
  });

  it("LRU — a 17th distinct issuer evicts the oldest entry (max:16)", async () => {
    // The discovery cache is bounded at max:16 entries; inserting a 17th
    // distinct issuer must evict the least-recently-used (the first one).
    // A subsequent call for the evicted issuer must re-fetch its doc.
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      const wellKnown = u.match(/^(https:\/\/idp-\d+\.test)\/\.well-known\/openid-configuration$/);
      if (wellKnown) {
        const origin = wellKnown[1];
        return jsonResponse({
          issuer: origin,
          token_endpoint: `${origin}/token`,
          userinfo_endpoint: `${origin}/userinfo`,
        });
      }
      if (/^https:\/\/idp-\d+\.test\/token$/.test(u)) {
        return jsonResponse({ access_token: "AT" });
      }
      if (/^https:\/\/idp-\d+\.test\/userinfo$/.test(u)) {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });

    const discoveryCallCountFor = (origin: string): number =>
      fetchSpy.mock.calls.filter((c) => {
        const u = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
        return u === `${origin}/.well-known/openid-configuration`;
      }).length;

    // Fill the cache with 16 distinct issuers (idp-0 .. idp-15).
    for (let i = 0; i < 16; i++) {
      vi.stubEnv("OIDC_ISSUER_URL", `https://idp-${i}.test`);
      await mint(ARGS);
    }
    expect(discoveryCallCountFor("https://idp-0.test")).toBe(1);

    // Insert a 17th issuer → idp-0 (LRU) is evicted.
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp-16.test");
    await mint(ARGS);

    // idp-0 was evicted → a fresh call for it re-fetches the discovery doc.
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp-0.test");
    await mint(ARGS);
    expect(discoveryCallCountFor("https://idp-0.test")).toBe(2);
  });

  it("HI-04 — a valid discovery doc is cached within TTL (one fetch) and re-fetched after expiry", async () => {
    const { auth } = buildFakeAuth();
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://idp.test",
          token_endpoint: "https://idp.test/token",
          userinfo_endpoint: "https://idp.test/userinfo",
        });
      }
      if (u === "https://idp.test/token") {
        return jsonResponse({ access_token: "AT" });
      }
      if (u === "https://idp.test/userinfo") {
        return jsonResponse({ sub: "s1", email: "u@x.test" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const mint = buildMintBearer({
      auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });

    const discoveryCallCount = (): number =>
      fetchSpy.mock.calls.filter((c) => {
        const u = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
        return u.includes("/.well-known/openid-configuration");
      }).length;

    // Two calls inside the TTL → discovery fetched exactly once (cached).
    // The discovery cache's TTL is driven by `lru-cache`, configured to
    // read its expiry clock from `Date.now()` — which Vitest fake timers
    // mock — so `setSystemTime` deterministically controls expiry.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-20T00:00:00Z"));
      await mint(ARGS);
      await mint(ARGS);
      expect(discoveryCallCount()).toBe(1);

      // Advance past the 60-minute TTL → next call re-fetches.
      vi.setSystemTime(new Date("2026-05-20T01:00:01Z"));
      await mint(ARGS);
      expect(discoveryCallCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
