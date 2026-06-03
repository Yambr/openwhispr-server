// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260603-dll / upstream #9 — server-side disable-local-login gate.
//
// When OPENWHISPR_DISABLE_LOCAL_LOGIN=1 the better-auth-handler catch-all
// preHandler must BLOCK all four anonymous local-credential routes with a
// localized 403 LOCAL_LOGIN_DISABLED, BEFORE Better Auth runs. The native BA
// layer only 400s sign-in/sign-up and does NOT gate the password-reset routes,
// so the preHandler is the authoritative gate (plan-checker B1/B2).
//
// W-1 (plan-checker): no in-repo precedent combines a ROUTE-LEVEL preHandler
// throw WITH localization. The throw routes through registerErrorHandler's
// setErrorHandler (precedent: middleware/require-cookie-only.ts:37 AuthError),
// which localizes by `code` (errors.LOCAL_LOGIN_DISABLED) when req.i18n is set.
// The localized-403 wire test below is the RED-first proof of that composition.
//
// ASCII-only source (english-only lefthook lint): the ru sample is synthesized
// at runtime; CYRILLIC_RE is the "is this localized?" assertion (same convention
// as better-auth-handler-i18n.test.ts).

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { buildBetterAuthHandlerRoutes } from "../../../../src/routes/better-auth-handler.js";

const CYRILLIC_SAMPLE = String.fromCharCode(0x0417, 0x0430, 0x043f); // "Zap" in Cyrillic
// Source stays ASCII-only (english-only lefthook lint): the range is the
// Cyrillic block U+0410..U+044F plus Yo (U+0401/U+0451), same convention as
// better-auth-handler-i18n.test.ts.
const CYRILLIC_RE = /[\u0410-\u044F\u0401\u0451]/;

/** A handler that records whether Better Auth was reached (it must NOT be, when blocked). */
function makeStubAuth(reached: { value: boolean }) {
  return {
    handler: async (_req: Request): Promise<Response> => {
      reached.value = true;
      return new Response("{}", { status: 200, headers: new Headers() });
    },
  };
}

/** Inject a fake req.i18n via an onRequest hook (mirrors the global i18n preHandler). */
function attachFakeI18n(app: FastifyInstance, lang: "en" | "ru"): void {
  app.addHook("onRequest", async (req) => {
    (req as unknown as { i18n: { t(k: string, o?: { defaultValue?: string }): string } }).i18n = {
      t(key, opts) {
        if (lang === "ru" && key === "errors.LOCAL_LOGIN_DISABLED") {
          return `${CYRILLIC_SAMPLE}-blocked`;
        }
        return opts?.defaultValue ?? key;
      },
    };
  });
}

const BLOCKED_PATHS = [
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
];

describe("upstream #9 — disable-local-login preHandler gate", () => {
  let app: FastifyInstance;
  const ORIGINAL = process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN;

  beforeEach(() => {
    app = Fastify();
    registerErrorHandler(app);
  });

  afterEach(async () => {
    await app.close();
    if (ORIGINAL === undefined) delete process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN;
    else process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN = ORIGINAL;
  });

  it("blocks all four credential routes with 403 LOCAL_LOGIN_DISABLED when disabled", async () => {
    process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN = "1";
    const reached = { value: false };
    attachFakeI18n(app, "en");
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(reached) as never }));
    await app.ready();

    for (const url of BLOCKED_PATHS) {
      const res = await app.inject({ method: "POST", url, payload: { email: "x@y.z" } });
      expect(res.statusCode, `${url} must 403`).toBe(403);
      const body = JSON.parse(res.body) as { error?: string };
      expect(typeof body.error, `${url} envelope`).toBe("string");
    }
    // Better Auth must NEVER run for a blocked request (no DB / handler work).
    expect(reached.value).toBe(false);
  });

  it("localizes the 403 body via setErrorHandler when Accept-Language is ru (W-1 wire proof)", async () => {
    process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN = "1";
    const reached = { value: false };
    attachFakeI18n(app, "ru");
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(reached) as never }));
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "accept-language": "ru" },
      payload: { email: "x@y.z" },
    });
    expect(res.statusCode).toBe(403);
    // The localized envelope's error string must be the Cyrillic copy — proving
    // the preHandler throw flowed through setErrorHandler's code-based localize.
    expect(CYRILLIC_RE.test(res.body)).toBe(true);
  });

  it("does NOT block when the flag is unset (default-safe ON) — request reaches Better Auth", async () => {
    delete process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN;
    const reached = { value: false };
    attachFakeI18n(app, "en");
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(reached) as never }));
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "x@y.z" },
    });
    expect(res.statusCode).toBe(200);
    expect(reached.value).toBe(true);
  });

  it("does NOT block GET on a credential path (POST-only matcher)", async () => {
    process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN = "1";
    const reached = { value: false };
    attachFakeI18n(app, "en");
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(reached) as never }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/auth/sign-in/email" });
    expect(res.statusCode).toBe(200);
    expect(reached.value).toBe(true);
  });

  it("does NOT block a non-credential auth route when disabled (e.g. get-session)", async () => {
    process.env.OPENWHISPR_DISABLE_LOCAL_LOGIN = "1";
    const reached = { value: false };
    attachFakeI18n(app, "en");
    await app.register(buildBetterAuthHandlerRoutes({ auth: makeStubAuth(reached) as never }));
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/auth/sign-out" });
    expect(res.statusCode).toBe(200);
    expect(reached.value).toBe(true);
  });
});
