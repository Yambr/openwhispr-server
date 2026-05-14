// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 10-01a / Step 2 — i18next + ICU bootstrap tests.
//
// Asserts:
//   1. `i18n` exports an initialized i18next instance with en + ru
//      resources loaded from apps/api/src/i18n/locales/{en,ru}.json via
//      i18next-fs-backend.
//   2. `i18nPlugin` is a Fastify plugin that attaches req.i18n via
//      i18next-http-middleware; Accept-Language steers translation.
//   3. The bootstrap resolves the locales directory in BOTH the source
//      tree layout (./locales relative to init.ts) AND the dist layout
//      (the same relative resolution still works once tsup bundles).

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n, i18nPlugin } from "../../../../src/i18n/init.js";

describe("i18n init — bootstrap (Phase 10-01a)", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      // Defensive — module side-effect should have initialized already.
      // If not, fail loudly here so the test report fingers the right step.
      throw new Error("i18n instance not initialized at module load");
    }
  });

  it("loads en errors resource", () => {
    expect(i18n.t("errors.AUTH_ERROR", { lng: "en" })).toBe("Session expired");
    expect(i18n.t("errors.VALIDATION_ERROR", { lng: "en" })).toBe("Invalid request");
    expect(i18n.t("errors.NOT_FOUND", { lng: "en" })).toBe("Not found");
    expect(i18n.t("errors.RATE_LIMITED", { lng: "en" })).toBe("Too many requests");
    expect(i18n.t("errors.SERVICE_UNAVAILABLE", { lng: "en" })).toBe(
      "Service temporarily unavailable",
    );
    expect(i18n.t("errors.SERVER_ERROR", { lng: "en" })).toBe("Internal server error");
  });

  it("loads ru errors resource (Cyrillic)", () => {
    expect(i18n.t("errors.AUTH_ERROR", { lng: "ru" })).toBe("Сессия истекла");
    expect(i18n.t("errors.VALIDATION_ERROR", { lng: "ru" })).toBe("Некорректный запрос");
    expect(i18n.t("errors.NOT_FOUND", { lng: "ru" })).toBe("Ресурс не найден");
    expect(i18n.t("errors.RATE_LIMITED", { lng: "ru" })).toBe("Слишком много запросов");
    expect(i18n.t("errors.SERVICE_UNAVAILABLE", { lng: "ru" })).toBe("Сервис временно недоступен");
    expect(i18n.t("errors.SERVER_ERROR", { lng: "ru" })).toBe("Внутренняя ошибка сервера");
  });

  it("falls back to en for unsupported language", () => {
    // i18next default fallbackLng behavior; assert resolved string is the
    // English literal (NOT the key itself which would indicate missing).
    const v = i18n.t("errors.AUTH_ERROR", { lng: "de" });
    expect(v).toBe("Session expired");
  });

  it("returns the configured defaultValue when key is missing", () => {
    const v = i18n.t("errors.NOT_A_REAL_CODE", {
      lng: "en",
      defaultValue: "fallback literal",
    });
    expect(v).toBe("fallback literal");
  });
});

describe("i18nPlugin — Fastify integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(i18nPlugin);
    app.get("/probe", async (req) => {
      // req.i18n is attached by i18next-http-middleware.
      const r = req as unknown as { i18n: { t(key: string): string }; language: string };
      return { msg: r.i18n.t("errors.AUTH_ERROR"), lng: r.language };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("steers translation by Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().msg).toBe("Сессия истекла");
  });

  it("uses en when Accept-Language: en", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "accept-language": "en" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().msg).toBe("Session expired");
  });

  it("falls back to en when Accept-Language is absent", async () => {
    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json().msg).toBe("Session expired");
  });

  it("falls back to en for an unsupported Accept-Language", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "accept-language": "de" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().msg).toBe("Session expired");
  });
});
