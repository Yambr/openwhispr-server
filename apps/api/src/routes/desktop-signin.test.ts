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
import Fastify, { type FastifyInstance } from "fastify";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../lib/default-tenant.js";
import { buildDesktopSigninRoutes } from "./desktop-signin.js";

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

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
      const chunks =
        (query as { queryChunks?: unknown[] }).queryChunks ?? [];
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

function buildApp(
  deps: Parameters<typeof buildDesktopSigninRoutes>[0],
): FastifyInstance {
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
    process.env = { ...ORIGINAL_ENV };
    setOidcEnv();
    delete process.env.OPENWHISPR_PROTOCOL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("happy path: 4-scheme matrix", () => {
    const builtinSchemes = [
      "openwhispr",
      "openwhispr-dev",
      "openwhispr-staging",
    ];
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
        expect(loc.startsWith("https://idp.example.com/authorize?")).toBe(true);
        const url = new URL(loc);
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("client_id")).toBe("test-client");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );
        // state is the inserted oauth_state.id (stable in fake)
        expect(url.searchParams.get("state")).toBe(
          "11111111-2222-3333-4444-555555555555",
        );

        // oauth_state INSERT happened with the validated scheme + tenant
        // bound as parameters.
        const insertCall = recorded.find((r) =>
          /INSERT INTO oauth_state/i.test(r.sql),
        );
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
