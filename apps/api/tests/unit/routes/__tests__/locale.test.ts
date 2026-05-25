// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 15 / Plan 02 / Task 1 — RED unit tests for GET /api/locale.
//
// New Fastify route that returns the request's negotiated locale as a
// small JSON body `{ locale: "en" | "ru" }`.  The route is mounted on
// the API container (port 3000) and is the GREEN payload of the
// `@cjm-traefik-host-split` Gherkin scenario (Task 1 of 15-02). The
// negotiation logic is the same Accept-Language → supported-language
// pickLocale already used by setup-admin.ts; we factor it into a small
// pure helper exported from `lib/pick-locale.ts` so it is unit-testable
// without a Fastify instance.
//
// Hermetic — no DB, no testcontainer. Builds a minimal Fastify app via
// `app.register(buildLocaleRoutes())` and uses `app.inject({...})`.

import fastifyCookie from "@fastify/cookie";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { i18nPlugin } from "../../../../src/i18n/init.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildLocaleRoutes } from "../../../../src/routes/locale.js";

// Quick-task 260524-u00 / Task A5 — buildLocaleRoutes now takes deps.db so
// the new POST sibling can UPDATE users.locale under withTenant(). These GET
// tests don't touch the DB; a permissive stub satisfies the type contract.
const stubDb = {} as unknown as TransactionalDb<ExecutableTx>;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Quick-task 260524-u00 / Task A5 — the new POST sibling uses Zod schemas
  // via @fastify/type-provider-zod (same as every other LOCKER-04 route);
  // the validator+serializer compilers MUST be wired before route registration
  // or Fastify rejects the schema with "data/required must be array".
  // @fastify/cookie is needed because the POST handler calls reply.setCookie.
  await app.register(zodTypeProvider);
  await app.register(fastifyCookie);
  await app.register(i18nPlugin);
  await app.register(buildLocaleRoutes({ db: stubDb }));
  await app.ready();
  return app;
}

describe("GET /api/locale — route behavior", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + { locale: 'en' } when no Accept-Language header is sent", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/locale" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as { locale: string };
    expect(body).toEqual({ locale: "en" });
  });

  it("returns 200 + { locale: 'ru' } when Accept-Language: ru", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/locale",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as { locale: string };
    expect(body).toEqual({ locale: "ru" });
  });

  it("returns 200 + { locale: 'en' } for an unsupported language (fallback)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/locale",
      headers: { "accept-language": "de-DE,de;q=0.9" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { locale: string };
    expect(body).toEqual({ locale: "en" });
  });

  it("honors q-weighted Accept-Language ordering — prefers ru when ranked first", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/locale",
      headers: { "accept-language": "ru-RU,ru;q=0.9,en;q=0.5" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { locale: string };
    expect(body).toEqual({ locale: "ru" });
  });

  it("response body keys are EXACTLY ['locale'] — info-leak gate", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/locale" });
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["locale"]);
  });
});

// Quick-task 260524-u00 / Task A5 — POST /api/locale.
//
// Hermetic — no DB call exercised because req.user is undefined in unit
// tests (no auth hook wired). The authenticated UPDATE path is exercised
// end-to-end in apps/api/tests/integration/locale-route.test.ts under
// the existing real-Postgres testcontainer pattern (Task A5 sub-task).
// Here we lock the wire contract: status code, body shape, Set-Cookie
// header, Zod validation, and the no-store cache header.
describe("POST /api/locale — anonymous + wire contract", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + { locale: 'ru' } and Set-Cookie i18next=ru for body {locale:'ru'}", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "ru" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { locale: string };
    expect(body).toEqual({ locale: "ru" });
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    expect(cookies.join("; ")).toMatch(/i18next=ru/);
    // SEED-F-LOCALE — httpOnly:false so the web client (LanguageSwitcher
    // + browser devtools / playwright traces) can read the cookie via
    // document.cookie. Locale is a non-credential preference, not a
    // security boundary.
    expect(cookies.join("; ")).not.toMatch(/HttpOnly/i);
    expect(cookies.join("; ")).toMatch(/SameSite=Lax/i);
    expect(cookies.join("; ")).toMatch(/Path=\//);
    // 1 year max-age (60*60*24*365 = 31536000)
    expect(cookies.join("; ")).toMatch(/Max-Age=31536000/i);
  });

  it("returns 200 + { locale: 'en' } and Set-Cookie i18next=en for body {locale:'en'}", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "en" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locale: "en" });
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    expect(cookies.join("; ")).toMatch(/i18next=en/);
  });

  it("returns 400 for an unsupported locale value (Zod enum)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "xx" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an empty body (Zod required)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for extra fields (Zod .strict)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "ru", extra: "smuggled" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("response body keys are EXACTLY ['locale'] — info-leak gate", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "en" },
    });
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["locale"]);
  });

  it("sets cache-control: no-store (mirror of GET sibling)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "ru" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // SEED-F-LOCALE — Next.js middleware reads `NEXT_LOCALE` cookie for
  // SSR locale negotiation; i18next-http-middleware reads `i18next` for
  // API-side negotiation. Setting both keeps server + web SSR aligned
  // without a translation layer. Peer ykoolfs5 surfaced 2026-05-25 18:53
  // UTC that the POST was 200-OK but emitted no Set-Cookie at all in
  // chart 1.0.8 — both layers must set their respective cookies.
  it("SEED-F-LOCALE — sets both `i18next` and `NEXT_LOCALE` cookies", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "ru" },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    const joined = cookies.join("; ");
    // i18next for the API-side i18next-http-middleware LanguageDetector
    expect(joined).toMatch(/i18next=ru/);
    // NEXT_LOCALE for the Next.js web SSR middleware
    expect(joined).toMatch(/NEXT_LOCALE=ru/);
    // Two distinct Set-Cookie response headers (not joined into one)
    expect(cookies.length).toBeGreaterThanOrEqual(2);
  });

  it("SEED-F-LOCALE — Set-Cookie headers omit HttpOnly so web client reads them", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/locale",
      payload: { locale: "en" },
    });
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    // Locale is not a credential; httpOnly would block the client-side
    // LanguageSwitcher from reading the cookie via document.cookie which
    // is the F-LOCALE peer surfaced as silently no-op behavior.
    expect(cookies.join("; ")).not.toMatch(/HttpOnly/i);
  });
});
