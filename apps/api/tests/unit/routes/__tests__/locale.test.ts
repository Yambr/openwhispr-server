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

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { i18nPlugin } from "../../../../src/i18n/init.js";
import { buildLocaleRoutes } from "../../../../src/routes/locale.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(i18nPlugin);
  await app.register(buildLocaleRoutes());
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
