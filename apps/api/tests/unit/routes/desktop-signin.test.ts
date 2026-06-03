// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 05 / Task 1 — `/api/desktop-signin/:provider` plugin tests.
//
// Strategy mirrors `check-user.test.ts`: register the plugin against a
// hand-rolled fake `TransactionalDb` (Drizzle SQL chunk introspection)
// so we can drive the route end-to-end without standing up testcontainers
// Postgres for unit-level coverage. Plan 06 owns the real-backend
// conformance run.
//
// Coverage matrix:
//   * Happy path (4-scheme matrix): 302 → IdP authorize URL with the
//     expected query params; oauth_state row INSERT recorded with the
//     validated scheme.
//   * Reject: protocol=javascript → 400 + envelope (NEVER 302).
//   * Reject: protocol=JavaScript (uppercase) → 400 (case-bypass attempt).
//   * Reject: unsupported provider /api/desktop-signin/saml → 400.
//   * Reject: OIDC unconfigured → 503 + envelope.
//   * Reject: empty protocol → 400 + envelope.
//   * Quirk: protocol embedded in callbackURL via `?` → still validates.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import { __resetOidcDiscoveryCacheForTests } from "../../../src/lib/oidc-discovery.js";
import { rateLimitPlugin } from "../../../src/plugins/rate-limit.js";
import { buildDesktopSigninRoutes } from "../../../src/routes/desktop-signin.js";

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

// #10 — the handler now resolves the authorize URL from the IdP discovery doc
// (`${issuer}/.well-known/openid-configuration`) instead of hardcoding
// `${issuer}/authorize`. We stub `globalThis.fetch` to return a Dex-style doc
// whose `authorization_endpoint` is `/auth` (NOT `/authorize`) so the tests
// prove the discovered path is used. `OIDC_DISCOVERY_DOC` is mutated per-test
// for the failure/override cases.
const DEX_AUTHORIZE = "https://idp.example.com/auth";
let discoveryDoc: Record<string, unknown> | null;
let discoveryStatus: number;

function stubDiscoveryFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) {
        if (discoveryStatus !== 200) {
          return new Response("err", { status: discoveryStatus });
        }
        return new Response(JSON.stringify(discoveryDoc), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(insertedId = "11111111-2222-3333-4444-555555555555"): {
  db: Parameters<typeof buildDesktopSigninRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  type FakeTx = { execute(query: unknown): Promise<unknown> };
  const tx: FakeTx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push(String(c));
        }
      }
      const text = parts.join("");
      recorded.push({ sql: text, params });
      if (/INSERT INTO oauth_state/i.test(text)) {
        return { rows: [{ id: insertedId }] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

function buildApp(deps: Parameters<typeof buildDesktopSigninRoutes>[0]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(buildDesktopSigninRoutes(deps));
  return app;
}

const ORIGINAL_ENV = { ...process.env };

function setOidcEnv(): void {
  process.env.AUTH_URL = "https://auth.example.com";
  process.env.OIDC_ISSUER_URL = "https://idp.example.com";
  process.env.OIDC_CLIENT_ID = "test-client";
  process.env.OIDC_CLIENT_SECRET = "test-secret";
}

function clearOidcEnv(): void {
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_AUTHORIZE_URL;
}

describe("GET /api/desktop-signin/:provider", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
    __resetOidcDiscoveryCacheForTests();
    process.env = { ...ORIGINAL_ENV };
    setOidcEnv();
    delete process.env.OPENWHISPR_PROTOCOL;
    // Default: a healthy Dex-style discovery doc with authorize at `/auth`.
    discoveryDoc = {
      authorization_endpoint: DEX_AUTHORIZE,
      token_endpoint: "https://idp.example.com/token",
      userinfo_endpoint: "https://idp.example.com/userinfo",
    };
    discoveryStatus = 200;
    stubDiscoveryFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetOidcDiscoveryCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("happy path: 4-scheme matrix", () => {
    const builtinSchemes = ["openwhispr", "openwhispr-dev", "openwhispr-staging"];
    for (const scheme of builtinSchemes) {
      it(`accepts the builtin scheme '${scheme}' and 302s to IdP authorize`, async () => {
        const { db, recorded } = makeFakeDb();
        const app = buildApp({ db });
        const cb = `${scheme}://callback`;
        const res = await app.inject({
          method: "GET",
          url: `/api/desktop-signin/oidc?callbackURL=${encodeURIComponent(cb)}&protocol=${scheme}`,
        });
        expect(res.statusCode).toBe(302);
        const loc = res.headers.location as string;
        // #10 — proves the authorize URL came from discovery
        // (authorization_endpoint = `/auth`), NOT the old hardcoded `/authorize`.
        expect(loc.startsWith("https://idp.example.com/auth?")).toBe(true);
        const url = new URL(loc);
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("client_id")).toBe("test-client");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
        // state is the inserted oauth_state.id (stable in fake)
        expect(url.searchParams.get("state")).toBe("11111111-2222-3333-4444-555555555555");

        // oauth_state INSERT happened with the validated scheme + tenant
        // bound as parameters.
        const insertCall = recorded.find((r) => /INSERT INTO oauth_state/i.test(r.sql));
        expect(insertCall).toBeDefined();
        // Schemes containing `-` may not appear as a single Param when
        // drizzle's tagged-template breaks the string differently; assert
        // via a JSON dump that the validated scheme appears somewhere
        // in the recorder. Tenant UUID is always a Param (via withTenant).
        expect(JSON.stringify(insertCall)).toContain(scheme);
        const allRecorded = JSON.stringify(recorded);
        expect(allRecorded).toContain(DEFAULT_TENANT);
        await app.close();
      });
    }

    it("accepts the OPENWHISPR_PROTOCOL override scheme", async () => {
      process.env.OPENWHISPR_PROTOCOL = "mycorp-whispr";
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=mycorp-whispr%3A%2F%2Fcb&protocol=mycorp-whispr",
      });
      expect(res.statusCode).toBe(302);
      await app.close();
    });
  });

  // #10 (peer gr0flvsr) — desktop-signin resolves the authorize URL from the
  // IdP discovery doc, not a hardcoded `${issuer}/authorize`. Dex serves
  // `/auth`; the old hardcode 302'd to a 404.
  describe("#10 — authorize URL from OIDC discovery", () => {
    it("uses authorization_endpoint from discovery (Dex /auth, not /authorize)", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(302);
      const loc = res.headers.location as string;
      expect(loc.startsWith(`${DEX_AUTHORIZE}?`)).toBe(true);
      expect(loc).not.toContain("/authorize?");
      await app.close();
    });

    it("OIDC_AUTHORIZE_URL override wins and makes NO discovery fetch", async () => {
      process.env.OIDC_AUTHORIZE_URL = "https://idp.example.com/custom-authorize";
      const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(302);
      const loc = res.headers.location as string;
      expect(loc.startsWith("https://idp.example.com/custom-authorize?")).toBe(true);
      // override path must NOT hit discovery
      const discoveryCalls = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes("/.well-known/openid-configuration"),
      );
      expect(discoveryCalls).toHaveLength(0);
      await app.close();
    });

    it("discovery non-2xx → 503 + envelope, NEVER 302, NO oauth_state INSERT", async () => {
      discoveryStatus = 500;
      const { db, recorded } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(503);
      // discovery precedes the write — no oauth_state row burned on failure
      expect(recorded.find((r) => /INSERT INTO oauth_state/i.test(r.sql))).toBeUndefined();
      await app.close();
    });

    it("discovery doc missing authorization_endpoint → 503, NO INSERT", async () => {
      discoveryDoc = {
        token_endpoint: "https://idp.example.com/token",
        userinfo_endpoint: "https://idp.example.com/userinfo",
      };
      const { db, recorded } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(503);
      expect(recorded.find((r) => /INSERT INTO oauth_state/i.test(r.sql))).toBeUndefined();
      await app.close();
    });

    it("discovery authorization_endpoint on a non-affiliated origin → 503 (SSRF guard), NO INSERT", async () => {
      discoveryDoc = {
        authorization_endpoint: "https://evil.attacker.test/auth",
        token_endpoint: "https://idp.example.com/token",
        userinfo_endpoint: "https://idp.example.com/userinfo",
      };
      const { db, recorded } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(503);
      expect(recorded.find((r) => /INSERT INTO oauth_state/i.test(r.sql))).toBeUndefined();
      await app.close();
    });
  });

  // Phase 69 / Plan 69-04 (D-69-1 / A1) — the authorize scope is widened with
  // the configured group claim when JIT is enabled so Keycloak emits `groups`
  // in userinfo (the desktop bearer-mint path reads claims from userinfo).
  describe("Phase 69 — group scope in the authorize redirect", () => {
    it("JIT disabled (OIDC_TENANT_CLAIM unset): scope is the legacy 'openid email profile'", async () => {
      delete process.env.OIDC_TENANT_CLAIM;
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(302);
      const url = new URL(res.headers.location as string);
      expect(url.searchParams.get("scope")).toBe("openid email profile");
      await app.close();
    });

    it("JIT enabled (default group claim): scope appends 'groups'", async () => {
      process.env.OIDC_TENANT_CLAIM = "tenant";
      delete process.env.OIDC_GROUP_CLAIM;
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(302);
      const url = new URL(res.headers.location as string);
      expect(url.searchParams.get("scope")).toBe("openid email profile groups");
      delete process.env.OIDC_TENANT_CLAIM;
      await app.close();
    });

    it("JIT enabled (custom OIDC_GROUP_CLAIM): scope appends the configured claim", async () => {
      process.env.OIDC_TENANT_CLAIM = "tenant";
      process.env.OIDC_GROUP_CLAIM = "memberOf";
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(302);
      const url = new URL(res.headers.location as string);
      expect(url.searchParams.get("scope")).toBe("openid email profile memberOf");
      delete process.env.OIDC_TENANT_CLAIM;
      delete process.env.OIDC_GROUP_CLAIM;
      await app.close();
    });
  });

  describe("reject: invalid scheme NEVER 302s", () => {
    it("protocol=javascript → 400 + envelope", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=javascript%3Aalert(1)&protocol=javascript",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toEqual({ error: "invalid callback scheme" });
      expect(() => ErrorEnvelope.parse(body)).not.toThrow();
      await app.close();
    });

    it("protocol=JavaScript (uppercase, case-bypass attempt) → 400", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=cb&protocol=JavaScript",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid callback scheme" });
      await app.close();
    });

    it("protocol=data → 400 (deny-list)", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=cb&protocol=data",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid callback scheme" });
      await app.close();
    });

    it("missing protocol → 400 + envelope", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=cb",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid callback scheme" });
      await app.close();
    });
  });

  describe("reject: unsupported provider", () => {
    it("/api/desktop-signin/saml → 400 + envelope", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/saml?callbackURL=cb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "unsupported provider" });
      await app.close();
    });
  });

  describe("OIDC unconfigured → 503", () => {
    it("returns 503 + envelope when OIDC_ISSUER_URL is unset", async () => {
      clearOidcEnv();
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr",
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "oidc not configured" });
      await app.close();
    });
  });

  describe("HR-02 — desktop-signin route carries a rateLimit budget", () => {
    // Phase 63 / HR-02 — the route MUST declare an explicit
    // `config.rateLimit` budget (LOCKER-04 + abuse mitigation: each call
    // INSERTs an oauth_state row + 6 encryption sidecars + 302s to the
    // IdP → unauthenticated write-amplification + redirect-launcher).

    it("HR-02: route config carries a { max, timeWindow } rateLimit object", async () => {
      let captured: unknown;
      const { db } = makeFakeDb();
      const app = Fastify({ logger: false });
      app.addHook("onRoute", (routeOptions) => {
        if (routeOptions.url === "/api/desktop-signin/:provider") {
          captured = (routeOptions.config as { rateLimit?: unknown } | undefined)?.rateLimit;
        }
      });
      registerErrorHandler(app);
      app.register(buildDesktopSigninRoutes({ db }));
      await app.ready();
      expect(captured).toBeTypeOf("object");
      expect(captured).toMatchObject({ max: 60, timeWindow: "1 minute" });
      await app.close();
    });

    it("HR-02: a burst past 60 returns 429 and the 61st does NOT INSERT oauth_state", async () => {
      const { db, recorded } = makeFakeDb();
      const app = Fastify({ logger: false, trustProxy: true });
      registerErrorHandler(app);
      await app.register(rateLimitPlugin, { redis: undefined });
      await app.register(buildDesktopSigninRoutes({ db }));
      await app.ready();
      const url = "/api/desktop-signin/oidc?callbackURL=openwhispr%3A%2F%2Fcb&protocol=openwhispr";
      for (let i = 0; i < 60; i++) {
        const r = await app.inject({
          method: "GET",
          url,
          headers: { "x-forwarded-for": "10.0.0.62" },
        });
        expect(r.statusCode).toBe(302);
      }
      const blocked = await app.inject({
        method: "GET",
        url,
        headers: { "x-forwarded-for": "10.0.0.62" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "Too many requests" });
      // Regression-shape: the over-budget request was rejected BEFORE the
      // handler ran → at most 60 oauth_state INSERTs recorded.
      const inserts = recorded.filter((r) => /INSERT INTO oauth_state/i.test(r.sql));
      expect(inserts.length).toBe(60);
      await app.close();
    });
  });

  describe("desktop quirk: protocol embedded in callbackURL", () => {
    it("extracts protocol from `?protocol=...` inside callbackURL", async () => {
      const { db } = makeFakeDb();
      const app = buildApp({ db });
      const cb = "openwhispr-dev://callback?protocol=openwhispr-dev";
      const res = await app.inject({
        method: "GET",
        url: `/api/desktop-signin/oidc?callbackURL=${encodeURIComponent(cb)}`,
      });
      expect(res.statusCode).toBe(302);
      await app.close();
    });
  });
});
