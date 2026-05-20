// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track E — api-routes-rest:CR-01 regression.
//
// better-auth-handler.ts:buildRequestUrl reconstructs the request URL
// Better Auth uses for CSRF / Origin / redirect-uri validation. The
// pre-fix code fell back to the attacker-controlled `req.headers.host`
// header when neither INGRESS_BASE_URL nor AUTH_URL was set — and even
// the AUTH_TRUSTED_ORIGINS_EXTRA "allowlist-pass" branch returned the
// SAME `${proto}://${host}` value as the allowlist-fail branch, so a
// forged `Host: evil.example.com` was always trusted.
//
// Post-fix: validateIngressBoot() guarantees one env var is set, and
// buildRequestUrl reads ONLY the validated env value. A request with a
// bogus Host header is forced through the canonical INGRESS_BASE_URL
// origin regardless of allowlist state.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBetterAuthHandlerRoutes } from "../../src/routes/better-auth-handler.js";

interface CapturedRequest {
  url: string;
}

function makeStubAuth(capture: CapturedRequest[]) {
  return {
    handler: async (req: Request): Promise<Response> => {
      capture.push({ url: req.url });
      return new Response("{}", { status: 200 });
    },
  };
}

describe("api-routes-rest:CR-01 — Host header injection", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
  });

  it("api-routes-rest:CR-01 — req.headers.host is never used as origin (bogus Host → canonical INGRESS_BASE_URL)", async () => {
    const capture: CapturedRequest[] = [];
    const prevIngress = process.env.INGRESS_BASE_URL;
    process.env.INGRESS_BASE_URL = "https://canonical.example.com";
    try {
      await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(capture) as never }));
      await app.inject({
        method: "GET",
        url: "/api/auth/sign-in/social",
        headers: {
          "x-forwarded-proto": "https",
          host: "evil.example.com",
        },
      });
      expect(capture).toHaveLength(1);
      expect(capture[0]?.url).toBe("https://canonical.example.com/api/auth/sign-in/social");
      expect(capture[0]?.url).not.toMatch(/evil\.example\.com/);
    } finally {
      if (prevIngress === undefined) delete process.env.INGRESS_BASE_URL;
      else process.env.INGRESS_BASE_URL = prevIngress;
    }
  });

  it("api-routes-rest:CR-01 — forged Host is ignored even when AUTH_TRUSTED_ORIGINS_EXTRA names it", async () => {
    // The pre-fix allowlist-pass branch returned the attacker-controlled
    // Host. Post-fix the env value is the only origin source — an
    // attacker who can also set AUTH_TRUSTED_ORIGINS_EXTRA already owns
    // the box, but the canonical origin must still win for defense.
    const capture: CapturedRequest[] = [];
    const prevIngress = process.env.INGRESS_BASE_URL;
    const prevExtra = process.env.AUTH_TRUSTED_ORIGINS_EXTRA;
    process.env.INGRESS_BASE_URL = "https://canonical.example.com";
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = "https://evil.example.com,evil.example.com";
    try {
      await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(capture) as never }));
      await app.inject({
        method: "GET",
        url: "/api/auth/foo",
        headers: { "x-forwarded-proto": "https", host: "evil.example.com" },
      });
      expect(capture[0]?.url).toBe("https://canonical.example.com/api/auth/foo");
    } finally {
      if (prevIngress === undefined) delete process.env.INGRESS_BASE_URL;
      else process.env.INGRESS_BASE_URL = prevIngress;
      if (prevExtra === undefined) delete process.env.AUTH_TRUSTED_ORIGINS_EXTRA;
      else process.env.AUTH_TRUSTED_ORIGINS_EXTRA = prevExtra;
    }
  });

  it("api-routes-rest:CR-01 — no env set: Host header is NEVER reflected into the origin", async () => {
    // The pre-fix code, with both env vars unset, fell through to
    // `${proto}://${req.headers.host}` — an attacker-controlled origin.
    // Post-fix validateIngressBoot() makes this state impossible at
    // boot; if it is somehow reached, buildRequestUrl must NOT echo the
    // forged Host. We assert the constructed URL never contains the
    // attacker's host.
    const capture: CapturedRequest[] = [];
    const prevIngress = process.env.INGRESS_BASE_URL;
    const prevAuth = process.env.AUTH_URL;
    delete process.env.INGRESS_BASE_URL;
    delete process.env.AUTH_URL;
    try {
      await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(capture) as never }));
      await app.inject({
        method: "GET",
        url: "/api/auth/foo",
        headers: { "x-forwarded-proto": "https", host: "evil.example.com" },
      });
      // Either the handler refused (no capture) or it built a URL — but
      // in no case may the URL contain the attacker-controlled Host.
      if (capture.length > 0) {
        expect(capture[0]?.url).not.toMatch(/evil\.example\.com/);
      }
    } finally {
      if (prevIngress !== undefined) process.env.INGRESS_BASE_URL = prevIngress;
      if (prevAuth !== undefined) process.env.AUTH_URL = prevAuth;
    }
  });

  it("api-routes-rest:CR-01 — falls back to AUTH_URL when INGRESS_BASE_URL unset, still ignores Host", async () => {
    const capture: CapturedRequest[] = [];
    const prevIngress = process.env.INGRESS_BASE_URL;
    const prevAuth = process.env.AUTH_URL;
    delete process.env.INGRESS_BASE_URL;
    process.env.AUTH_URL = "https://auth.example.com";
    try {
      await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(capture) as never }));
      await app.inject({
        method: "GET",
        url: "/api/auth/foo",
        headers: { host: "evil.example.com" },
      });
      expect(capture[0]?.url).toBe("https://auth.example.com/api/auth/foo");
    } finally {
      if (prevIngress !== undefined) process.env.INGRESS_BASE_URL = prevIngress;
      if (prevAuth === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = prevAuth;
    }
  });
});
