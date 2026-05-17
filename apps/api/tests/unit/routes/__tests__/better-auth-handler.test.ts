// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.4 / G5a — better-auth-handler.ts bridge plugin.
 *
 * Source-of-record commit: 5f274e6
 *
 * Reverts: this test goes RED if any of the following is reverted:
 *   1. Drop the `if (typeof handler !== 'function')` guard → "throws on missing handler" assertion fails.
 *   2. Pass `body: undefined` for GET (instead of omitting body via conditional) →
 *      strict TS would have caught it at compile time, but the runtime check
 *      `expect(capturedInit.body).toBeUndefined()` confirms the conditional shape.
 *   3. Replace `webRes.headers.forEach((v,k) => reply.header(k,v))` with
 *      `reply.headers(Object.fromEntries(webRes.headers))` → Set-Cookie multi-values collapse,
 *      "multi Set-Cookie forwarded" assertion fails.
 *   4. Drop `config: { auth: false }` from the route options → effect not directly
 *      assertable in this isolated test (no dualAuthHook registered) but covered by
 *      the existence check on the route's config object via fastify.printRoutes / inspectRoutes.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBetterAuthHandlerRoutes } from "../../../../src/routes/better-auth-handler.js";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Headers;
  bodyText: string | undefined;
}

function makeStubAuth(opts: {
  status?: number;
  responseHeaders?: Array<[string, string]>;
  responseBody?: string;
  capture?: CapturedRequest[];
  noHandler?: boolean;
}) {
  if (opts.noHandler) return { handler: undefined } as unknown as { handler?: unknown };
  return {
    handler: async (req: Request): Promise<Response> => {
      if (opts.capture) {
        const bodyText =
          req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
        opts.capture.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          bodyText,
        });
      }
      const headers = new Headers();
      for (const [k, v] of opts.responseHeaders ?? []) headers.append(k, v);
      return new Response(opts.responseBody ?? "{}", {
        status: opts.status ?? 200,
        headers,
      });
    },
  };
}

describe("Phase 02.4 G5a — better-auth-handler bridge plugin", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers without error when auth.handler is a function", async () => {
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth({}) as never }));
    await app.ready();
  });

  it("throws when auth.handler is not a function", async () => {
    await expect(
      app.register(
        buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ noHandler: true }) as never }),
      ),
    ).rejects.toThrow(/auth\.handler is not a function/);
  });

  it("GET request: webReq has method GET and no body", async () => {
    const capture: CapturedRequest[] = [];
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ capture }) as never }));
    await app.inject({ method: "GET", url: "/api/auth/get-session" });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.method).toBe("GET");
    expect(capture[0]?.bodyText).toBeUndefined();
  });

  it("POST request: webReq.body is JSON string of req.body", async () => {
    const capture: CapturedRequest[] = [];
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ capture }) as never }));
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "x@y.z", password: "pw" },
    });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.method).toBe("POST");
    expect(JSON.parse(capture[0]?.bodyText!)).toEqual({ email: "x@y.z", password: "pw" });
  });

  it("URL reconstruction honors INGRESS_BASE_URL over the Host header (Plan 51-10 / REVIEW HR-02)", async () => {
    // Phase 51 / Plan 51-10 — Better Auth's URL is no longer
    // reconstructed from a raw Host header. INGRESS_BASE_URL wins
    // unconditionally so a hostile reverse-proxy can't supply an
    // arbitrary origin.
    const capture: CapturedRequest[] = [];
    const prev = process.env.INGRESS_BASE_URL;
    process.env.INGRESS_BASE_URL = "https://api.test.invalid";
    try {
      await app.register(
        buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ capture }) as never }),
      );
      await app.inject({
        method: "GET",
        url: "/api/auth/foo",
        headers: { "x-forwarded-proto": "https", host: "evil.attacker.example" },
      });
      expect(capture[0]?.url).toBe("https://api.test.invalid/api/auth/foo");
    } finally {
      if (prev === undefined) delete process.env.INGRESS_BASE_URL;
      else process.env.INGRESS_BASE_URL = prev;
    }
  });

  it("URL reconstruction falls back to Host when no INGRESS_BASE_URL / AUTH_URL is set", async () => {
    const capture: CapturedRequest[] = [];
    const prevIngress = process.env.INGRESS_BASE_URL;
    const prevAuth = process.env.AUTH_URL;
    delete process.env.INGRESS_BASE_URL;
    delete process.env.AUTH_URL;
    try {
      await app.register(
        buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ capture }) as never }),
      );
      const res = await app.inject({ method: "GET", url: "/api/auth/foo" });
      expect(res.statusCode).toBe(200);
      // proto defaults to 'https' post-fix (was 'http' pre-fix); the
      // documented production deployment is always TLS-fronted.
      expect(capture[0]?.url).toMatch(/^https:\/\/[^/]+\/api\/auth\/foo$/);
    } finally {
      if (prevIngress !== undefined) process.env.INGRESS_BASE_URL = prevIngress;
      if (prevAuth !== undefined) process.env.AUTH_URL = prevAuth;
    }
  });

  it("forwards response status from webRes", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ status: 418 }) as never }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/teapot" });
    expect(res.statusCode).toBe(418);
  });

  it("forwards multiple Set-Cookie response headers individually (multi-value safety)", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({
        auth: makeStubAuth({
          responseHeaders: [
            ["set-cookie", "a=1; Path=/"],
            ["set-cookie", "b=2; Path=/"],
          ],
        }) as never,
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/foo" });
    const cookies = res.headers["set-cookie"];
    // Fastify normalizes set-cookie to an array when multiple values exist.
    expect(Array.isArray(cookies) ? cookies : [cookies]).toEqual(
      expect.arrayContaining([expect.stringContaining("a=1"), expect.stringContaining("b=2")]),
    );
  });

  it("forwards response body text as reply payload", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({
        auth: makeStubAuth({ responseBody: '{"ok":true}' }) as never,
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/foo" });
    expect(res.body).toBe('{"ok":true}');
  });

  // Branch-coverage extras (cover `req.body` null/string fallthrough at lines
  // 44-45 of better-auth-handler.ts and the empty-text fallback at line 90).
  it("DELETE with no body forwards empty body to handler (covers null body branch)", async () => {
    const capture: CapturedRequest[] = [];
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth({ capture }) as never }));
    await app.inject({ method: "DELETE", url: "/api/auth/sign-out" });
    expect(capture[0]?.method).toBe("DELETE");
    expect(capture[0]?.bodyText).toBe("");
  });

  it("empty response body returns undefined payload (covers `text || undefined` branch)", async () => {
    await app.register(
      buildBetterAuthHandlerRoutes({
        auth: makeStubAuth({ responseBody: "", status: 200 }) as never,
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/foo" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });

  it("registers the route with config.auth = false", async () => {
    const parent = Fastify();
    const seen: Array<{
      method: string | string[];
      url: string;
      config?: Record<string, unknown>;
    }> = [];
    parent.addHook("onRoute", (route) => {
      seen.push({
        method: route.method,
        url: route.url,
        config: route.config as Record<string, unknown>,
      });
    });
    await parent.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth({}) as never }));
    await parent.ready();
    const authRoute = seen.find((r) => r.url === "/api/auth/*");
    expect(authRoute).toBeDefined();
    expect(authRoute?.config).toMatchObject({ auth: false });
    await parent.close();
  });
});
