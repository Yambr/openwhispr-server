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
});
