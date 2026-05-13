// SPDX-License-Identifier: Apache-2.0
// Phase 10 / Plan 10-01a / Step 5 — i18n integration in the centralized
// error handler. Asserts:
//   1. When `req.i18n` is present (i18nPlugin mounted) and an
//      Accept-Language: ru request hits a typed-error throw, the
//      envelope `{error: ...}` is the Russian translation.
//   2. When `req.i18n` is absent (legacy / pre-Plan-10 boot path), the
//      handler falls back to the English literal so the existing
//      error-handler.test.ts contract is preserved (advisor B10).
//   3. The original throwing-site message (the constructor arg)
//      remains the `defaultValue` so future codes that lack a locale
//      entry still surface a non-empty string instead of the raw key.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../error-handler.js";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "../errors.js";
import { i18nPlugin } from "../i18n/init.js";

describe("error-handler — i18n localized envelope (Phase 10-01a)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(i18nPlugin);
    app.get("/throw-auth", async () => {
      throw new AuthError("session expired");
    });
    app.get("/throw-validation", async () => {
      throw new ValidationError("body is invalid");
    });
    app.get("/throw-notfound", async () => {
      throw new NotFoundError("user not found");
    });
    app.get("/throw-ratelimit", async () => {
      throw new RateLimitError("too many requests");
    });
    app.get("/throw-503", async () => {
      throw new ServiceUnavailable("db unavailable");
    });
    app.get("/throw-server", async () => {
      throw new ServerError("intentional bug");
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("AuthError -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-auth",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Сессия истекла");
  });

  it("ValidationError -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-validation",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Некорректный запрос");
  });

  it("NotFoundError -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-notfound",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Ресурс не найден");
  });

  it("RateLimitError -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-ratelimit",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("Слишком много запросов");
  });

  it("ServiceUnavailable -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-503",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("Сервис временно недоступен");
  });

  it("ServerError -> Cyrillic on Accept-Language: ru", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-server",
      headers: { "accept-language": "ru" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Внутренняя ошибка сервера");
  });

  it("AuthError -> English literal on Accept-Language: en", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/throw-auth",
      headers: { "accept-language": "en" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Session expired");
  });
});

describe("error-handler — fallback when req.i18n absent (Phase 10-01a)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Intentionally NO i18nPlugin registration — proves the legacy
    // call sites (existing error-handler.test.ts) still resolve to the
    // English literal (constructor arg) when i18n isn't wired.
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get("/throw-auth", async () => {
      throw new AuthError("session expired");
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("falls back to the constructor message when req.i18n is undefined", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-auth" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("session expired");
  });
});
