// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — `GET /api/auth/verify-email-complete` route unit tests.
//
// The route is hit by Better Auth's verify-email handler one 302 hop
// after a successful sign-up → verify. By then Better Auth has set a
// session cookie on the request; the route resolves that session via
// `auth.api.getSession`, extracts the raw `session.token`, and
// 302-redirects to the desktop auth-bridge with `?bearer_token=`.
//
// Coverage matrix:
//   * Happy path — a resolvable session → 302 to the SERVER-FIXED
//     `http://127.0.0.1:5199/oauth/callback?bearer_token=<urlencoded>`.
//   * Token containing URL-unsafe chars (signed-cookie `.`, `+`, `/`,
//     `=`) survives encodeURIComponent in the redirect target.
//   * No session at all → clean 401 + canonical {error:...} envelope
//     (NOT 500, NOT a hang).
//   * Session present but no raw token → same clean 401 envelope.
//   * `getSession` is called with a Web Headers instance carrying the
//     request cookie (the verify-email handler's just-set cookie).
//   * The redirect target is NEVER attacker-derived — a hostile
//     `?error=` query param does not influence the redirect origin.
//
// Only Better Auth's `getSession` is faked — that is the process
// boundary (it would otherwise need a live DB + cookie-signing secret).
// The route logic, the error envelope, and the redirect-building helper
// are all real.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import type { AuthLike, SessionResult } from "../../../src/middleware/dual-auth.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildVerifyEmailCompleteRoutes } from "../../../src/routes/verify-email-complete.js";

const BRIDGE_PREFIX = "http://127.0.0.1:5199/oauth/callback?bearer_token=";

/**
 * Build an `AuthLike` fake whose `getSession` returns `result`. Captures
 * the `headers` argument so a test can assert the request cookie was
 * forwarded.
 */
function makeAuth(result: SessionResult | null): {
  auth: AuthLike;
  calls: { headers: Headers }[];
} {
  const calls: { headers: Headers }[] = [];
  const auth: AuthLike = {
    api: {
      async getSession(opts: { headers: Headers }): Promise<SessionResult | null> {
        calls.push(opts);
        return result;
      },
    },
  };
  return { auth, calls };
}

function buildApp(auth: AuthLike): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // The route declares a Zod `querystring` schema; register the same
  // type provider production uses so Fastify compiles it.
  app.register(zodTypeProvider);
  app.register(buildVerifyEmailCompleteRoutes({ auth }));
  return app;
}

const RESOLVED_SESSION = (token: string): SessionResult => ({
  user: { id: "user-1", email: "verified@example.test" },
  session: { id: "sess-1", token },
});

describe("GET /api/auth/verify-email-complete", () => {
  it("302-redirects to the desktop bridge carrying the raw session token", async () => {
    const { auth } = makeAuth(RESOLVED_SESSION("raw-session-token-abc123"));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
      headers: { cookie: "openwhispr.session_token=signed.value" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${BRIDGE_PREFIX}raw-session-token-abc123`);
  });

  it("url-encodes tokens containing signed-cookie / base64 chars", async () => {
    // A signed-cookie value carries a `.` separator; base64 tokens may
    // carry `+` `/` `=`. encodeURIComponent must escape all of them so
    // the loopback HTTP hop + the client's URL parser see the verbatim
    // token.
    const tricky = "tok.en+with/url=chars";
    const { auth } = makeAuth(RESOLVED_SESSION(tricky));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
      headers: { cookie: "openwhispr.session_token=signed.value" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${BRIDGE_PREFIX}${encodeURIComponent(tricky)}`);
    // Round-trip: decoding the param recovers the exact token.
    const got = new URL(res.headers.location as string).searchParams.get("bearer_token");
    expect(got).toBe(tricky);
  });

  it("forwards the request cookie to getSession as a Web Headers instance", async () => {
    const { auth, calls } = makeAuth(RESOLVED_SESSION("tok"));
    const app = buildApp(auth);
    await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
      headers: { cookie: "openwhispr.session_token=signed.value" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toBeInstanceOf(Headers);
    expect(calls[0]?.headers.get("cookie")).toBe("openwhispr.session_token=signed.value");
  });

  it("no session → clean 401 with the canonical error envelope (never 500)", async () => {
    const { auth } = makeAuth(null);
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
    });
    expect(res.statusCode).toBe(401);
    // Body is the single-key {error:...} envelope, not an HTML 500 page.
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(res.headers.location).toBeUndefined();
  });

  it("session present but no raw token → clean 401 envelope", async () => {
    const { auth } = makeAuth({
      user: { id: "user-1", email: "verified@example.test" },
      session: { id: "sess-1" }, // token absent
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
  });

  it("redirect target is server-fixed — a hostile ?error= param cannot redirect it", async () => {
    // Better Auth's verify-email error path appends `?error=<code>`. The
    // schema accepts it as an optional passthrough, but the redirect
    // origin/path is the server-fixed bridge literal regardless.
    const { auth } = makeAuth(RESOLVED_SESSION("tok"));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete?error=https://evil.example/steal",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    expect(res.headers.location).not.toContain("evil.example");
  });

  it("rejects unexpected query params via the strict schema", async () => {
    const { auth } = makeAuth(RESOLVED_SESSION("tok"));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete?bearer_token=injected",
    });
    expect(res.statusCode).toBe(400);
  });

  it("never invokes getSession more than once per request", async () => {
    const { auth, calls } = makeAuth(RESOLVED_SESSION("tok"));
    const app = buildApp(auth);
    await app.inject({ method: "GET", url: "/api/auth/verify-email-complete" });
    expect(calls).toHaveLength(1);
  });

  it("does not throw out of the handler when getSession itself rejects", async () => {
    // Defensive: an infra failure inside getSession surfaces through the
    // centralized error handler as a 5xx envelope — never a hang.
    const auth: AuthLike = {
      api: {
        getSession: vi.fn().mockRejectedValue(new Error("db down")),
      },
    };
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
  });

  // F8 — web-flow detection via `?origin=<relative-path>` state-param.
  // The rewrite hook (verification-callback-url.ts) carries the original
  // client-supplied callbackURL through to this route, so we can route
  // back to the web app (cookie already in browser jar) instead of
  // 302-ing to the desktop loopback bridge.
  describe("F8 — origin state-param routing", () => {
    it("origin=relative-path → 302 to ${origin}, NO bearer_token in URL (cookie in browser jar)", async () => {
      // Web sign-up sets `callbackURL: "/sign-in?verified=1"` which the
      // rewrite hook preserves as `&origin=/sign-in?verified=1`. The
      // Better Auth verify-email handler 302s here AFTER setting the
      // session cookie on the response, so the browser already carries
      // the cookie when it follows the next 302 to ${origin}. No need to
      // expose the raw bearer in the URL (which would leak into history
      // / referer).
      const { auth } = makeAuth(RESOLVED_SESSION("raw-token"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete?origin=/sign-in%3Fverified%3D1",
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(302);
      // 302 target is the original relative path — verbatim, no
      // bearer_token appended, no host added.
      expect(res.headers.location).toBe("/sign-in?verified=1");
      // No bearer leakage anywhere in the URL.
      expect(res.headers.location).not.toContain("bearer_token");
      expect(res.headers.location).not.toContain("raw-token");
    });

    it("origin=/ → desktop bridge (Better Auth default, backward-compat with R22)", async () => {
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete?origin=%2F",
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    });

    it("origin absent → desktop bridge (legacy verification emails / R22 backward-compat)", async () => {
      // Pre-F8 emails carry no `?origin=` query — the route must keep
      // routing them to the desktop bridge.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete",
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    });

    it("origin=absolute-URL → 400 (open-redirect guard)", async () => {
      // Defense in depth: the rewrite hook drops absolute URLs, but if
      // an attacker crafts a verification link with an absolute origin
      // bypass somehow, the route MUST reject — never honor an absolute
      // redirect target.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/verify-email-complete?origin=${encodeURIComponent("https://attacker.example/phish")}`,
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(400);
      // Body is the canonical {error:...} envelope.
      expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      expect(res.headers.location).toBeUndefined();
    });

    it("origin=protocol-relative //host → 400 (open-redirect guard)", async () => {
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/verify-email-complete?origin=${encodeURIComponent("//attacker.example/path")}`,
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("origin=backslash-prefixed `/\\foo` → 400 (Windows path-style bypass)", async () => {
      // Some browsers normalize `/\foo` as protocol-relative in some
      // edge cases — reject explicitly.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/verify-email-complete?origin=${encodeURIComponent("/\\evil.example")}`,
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("origin=relative-with-existing-query → 302 verbatim (no bearer_token appended)", async () => {
      // The route does NOT mutate the origin path — the web app owns the
      // destination shape.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const path = "/welcome?source=email&utm=verify";
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/verify-email-complete?origin=${encodeURIComponent(path)}`,
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(path);
    });

    it("origin=relative-path with no session → still 401 (auth check runs first)", async () => {
      // The route MUST resolve the session before consulting origin —
      // an unverified user with a crafted origin must not get a free
      // redirect anywhere.
      const { auth } = makeAuth(null);
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete?origin=%2Fapp",
      });
      expect(res.statusCode).toBe(401);
      expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      expect(res.headers.location).toBeUndefined();
    });
  });

  // F8 (option 3) — legacy-email fallback via Sec-Fetch-Site detection.
  // Pre-F8 verification emails carry no `?origin=` query, but the
  // verify-email-complete route can still distinguish web-flow users
  // (top-level browser navigation, Sec-Fetch-Site: none) from the
  // Electron desktop client (which doesn't issue HTTP from a browser
  // context and won't send Sec-Fetch-Site: none). Web users on legacy
  // emails get 302 to /sign-in?verified=1 instead of the dead loopback.
  describe("F8 option-3 — Sec-Fetch-Site fallback for legacy emails", () => {
    it("origin absent + Sec-Fetch-Site: none → 302 to /sign-in?verified=1 (legacy web-flow fallback)", async () => {
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete",
        headers: {
          cookie: "openwhispr.session_token=signed.value",
          "sec-fetch-site": "none",
        },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/sign-in?verified=1");
      // No bearer leakage in the URL.
      expect(res.headers.location).not.toContain("bearer_token");
    });

    it("origin absent + Sec-Fetch-Site missing → desktop bridge (older browsers / Electron / curl)", async () => {
      // Conservative default: only `Sec-Fetch-Site: none` triggers the
      // web fallback. Missing header means we can't disambiguate, so
      // honor the R22 desktop-bridge default.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete",
        headers: { cookie: "openwhispr.session_token=signed.value" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    });

    it("origin absent + Sec-Fetch-Site: cross-site → desktop bridge (not a verify-email click pattern)", async () => {
      // `cross-site` shouldn't happen on a verify-email click — it
      // would mean the link was loaded from a different origin's page.
      // Don't second-guess; honor the R22 default.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete",
        headers: {
          cookie: "openwhispr.session_token=signed.value",
          "sec-fetch-site": "cross-site",
        },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    });

    it("origin=/ + Sec-Fetch-Site: none → STILL desktop bridge (explicit '/' wins over fallback)", async () => {
      // If the rewrite hook explicitly emitted `origin=/` (which it
      // doesn't today, but defensive coverage), the explicit value
      // wins over the implicit Sec-Fetch-Site heuristic.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete?origin=%2F",
        headers: {
          cookie: "openwhispr.session_token=signed.value",
          "sec-fetch-site": "none",
        },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${BRIDGE_PREFIX}tok`);
    });

    it("origin=relative + Sec-Fetch-Site: none → explicit origin wins", async () => {
      // Explicit origin always trumps the implicit fallback.
      const { auth } = makeAuth(RESOLVED_SESSION("tok"));
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete?origin=%2Fapp",
        headers: {
          cookie: "openwhispr.session_token=signed.value",
          "sec-fetch-site": "none",
        },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/app");
    });

    it("Sec-Fetch-Site: none + no session → still 401 (auth runs before fallback)", async () => {
      const { auth } = makeAuth(null);
      const app = buildApp(auth);
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify-email-complete",
        headers: { "sec-fetch-site": "none" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
