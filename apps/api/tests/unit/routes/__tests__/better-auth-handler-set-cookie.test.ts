// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 35 / 35.b — CR-3 (CRIT-FIX-05): better-auth-handler MUST forward
// each Set-Cookie value as an INDEPENDENT header. The legacy `forEach`
// iterator on the Web Headers object combines same-named entries with
// ", " for most headers; for Set-Cookie that produces a malformed
// `set-cookie: a=1; ..., b=2; ...` line which RFC 6265 forbids and
// browsers / jars then store only the first cookie of (or reject).
//
// This test goes RED on the old `forEach`-only implementation when the
// runtime collapses multi-Set-Cookie via comma-join. Post-fix the handler
// uses `Headers.getSetCookie()` to enumerate each cookie value
// individually and `reply.header("set-cookie", v)` per value. Fastify
// already coalesces repeated `set-cookie` calls into a string[] in
// `reply.getHeaders()` (no special API needed).
//
// Companion to apps/api/tests/unit/routes/__tests__/better-auth-handler.test.ts;
// kept separate so the CR-3 regression diff is small + auditable.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBetterAuthHandlerRoutes } from "../../../../src/routes/better-auth-handler.js";

/**
 * Build a stub Better-Auth-shaped object whose `handler` resolves a Web
 * Response carrying TWO Set-Cookie values. Mirrors what Better Auth emits
 * at sign-in when `session.cookieCache.enabled === true`:
 *   * `openwhispr.session_token=...` (HttpOnly session id)
 *   * `openwhispr.session_data=...`  (encoded session payload)
 */
function makeStubAuthWithTwoCookies() {
  return {
    handler: vi.fn(async () => {
      const headers = new Headers();
      headers.append("set-cookie", "openwhispr.session_token=tok; Path=/; HttpOnly");
      headers.append("set-cookie", "openwhispr.session_data=payload; Path=/");
      headers.set("content-type", "application/json");
      return new Response('{"ok":true}', { status: 200, headers });
    }),
  };
}

describe("Phase 35 / 35.b — better-auth-handler multi-Set-Cookie integrity (CR-3)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("emits TWO independent set-cookie headers, NOT one comma-joined value", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({ auth: makeStubAuthWithTwoCookies() as never }),
    );
    const res = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: {} });

    expect(res.statusCode).toBe(200);

    const raw = res.headers["set-cookie"];
    const cookies = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

    // RED on `forEach`-only path: cookies arrives as a single string like
    // `"openwhispr.session_token=tok; ..., openwhispr.session_data=payload; ..."`
    // GREEN via getSetCookie(): cookies has exactly 2 entries, each
    // containing exactly ONE cookie definition.
    expect(cookies, "expected two distinct set-cookie headers").toHaveLength(2);

    // Per-value integrity: no comma-joining contamination.
    for (const c of cookies) {
      // A well-formed cookie has at most one "=" before the first ";" pair,
      // and no comma followed by another `<name>=<value>` token. Reject any
      // value containing the canonical "<name>=<value>, <name>=<value>"
      // signature.
      expect(c).not.toMatch(/=[^;]*,\s*openwhispr\./);
    }

    // Each expected cookie appears in exactly one slot.
    expect(cookies.some((c) => c.startsWith("openwhispr.session_token="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("openwhispr.session_data="))).toBe(true);
  });

  it("preserves non-Set-Cookie headers via forEach (regression net)", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({ auth: makeStubAuthWithTwoCookies() as never }),
    );
    const res = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: {} });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("emits zero set-cookie headers when the upstream Response has none", async () => {
    const auth = {
      handler: vi.fn(async () => {
        const h = new Headers();
        h.set("content-type", "application/json");
        return new Response('{"ok":true}', { status: 200, headers: h });
      }),
    };
    await app.register(buildBetterAuthHandlerRoutes({ auth: auth as never }));
    const res = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
