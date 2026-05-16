// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19.3 / Plan 01 — vitest unit coverage for the BA-handler
// localization shim (`maybeLocalizeBetterAuthError`). Closes UICONF-03 at
// the wire surface; @cjm-1.4 e2e proves it end-to-end through real
// Traefik+api+postgres. This file pins the contract at sub-ms TDD speed
// so a refactor that drops i18n cannot silently re-introduce the gap.

import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { maybeLocalizeBetterAuthError } from "../../../../src/routes/better-auth-handler.js";

interface FakeI18n {
  t(key: string, opts?: { defaultValue?: string }): string;
}

function makeReq(i18n?: FakeI18n): FastifyRequest {
  return { i18n } as unknown as FastifyRequest;
}

function ruI18n(): FakeI18n {
  const dict: Record<string, string> = {
    "errors.VALIDATION_ERROR": "Некорректный запрос",
    "errors.PASSWORD_TOO_SHORT": "Пароль слишком короткий",
    "errors.USER_ALREADY_EXISTS": "Пользователь с такой электронной почтой уже зарегистрирован",
    "errors.INVALID_EMAIL": "Некорректный адрес электронной почты",
  };
  return {
    t(key, opts) {
      return dict[key] ?? opts?.defaultValue ?? key;
    },
  };
}

function enI18n(): FakeI18n {
  return {
    t(_key, opts) {
      return opts?.defaultValue ?? "";
    },
  };
}

describe("Phase 19.3 / Plan 01 — maybeLocalizeBetterAuthError", () => {
  it("translates VALIDATION_ERROR `message` to Russian when Accept-Language picks ru", () => {
    const text = JSON.stringify({
      message: "[body.email] Invalid email address",
      code: "VALIDATION_ERROR",
    });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    const parsed = JSON.parse(out) as { message: string; code: string };
    expect(parsed.code).toBe("VALIDATION_ERROR");
    expect(parsed.message).toBe("Некорректный запрос");
  });

  it("translates PASSWORD_TOO_SHORT to Russian (Better Auth internal validator path)", () => {
    const text = JSON.stringify({ message: "Password too short", code: "PASSWORD_TOO_SHORT" });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    const parsed = JSON.parse(out) as { message: string };
    expect(parsed.message).toBe("Пароль слишком короткий");
  });

  it("translates USER_ALREADY_EXISTS to Russian (anti-enumeration opt-out path)", () => {
    const text = JSON.stringify({
      message: "User with this email already exists",
      code: "USER_ALREADY_EXISTS",
    });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    const parsed = JSON.parse(out) as { message: string };
    expect(parsed.message).toBe("Пользователь с такой электронной почтой уже зарегистрирован");
  });

  it("preserves the original body when Accept-Language picks en (i18n returns the fallback)", () => {
    const text = JSON.stringify({ message: "Password too short", code: "PASSWORD_TOO_SHORT" });
    const out = maybeLocalizeBetterAuthError(makeReq(enI18n()), text);
    expect(out).toBe(text);
  });

  it("preserves the original body when req.i18n is missing (legacy boot path)", () => {
    const text = JSON.stringify({ message: "x", code: "VALIDATION_ERROR" });
    const out = maybeLocalizeBetterAuthError(makeReq(undefined), text);
    expect(out).toBe(text);
  });

  it("preserves the body when JSON is malformed (defensive)", () => {
    const text = "<!doctype html>not-json";
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    expect(out).toBe(text);
  });

  it("preserves the body when no `code` field is present", () => {
    const text = JSON.stringify({ message: "x" });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    expect(out).toBe(text);
  });

  it("preserves the body when no `message` field is present", () => {
    const text = JSON.stringify({ code: "VALIDATION_ERROR" });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    expect(out).toBe(text);
  });

  it("preserves the body when `code` is an unknown error key (defaultValue passthrough)", () => {
    const text = JSON.stringify({ message: "totally novel error", code: "BRAND_NEW_CODE" });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    expect(out).toBe(text);
  });

  it("preserves the body when the parsed JSON is a primitive or array (not object)", () => {
    expect(maybeLocalizeBetterAuthError(makeReq(ruI18n()), "42")).toBe("42");
    expect(maybeLocalizeBetterAuthError(makeReq(ruI18n()), "[1,2,3]")).toBe("[1,2,3]");
    expect(maybeLocalizeBetterAuthError(makeReq(ruI18n()), "null")).toBe("null");
  });

  it("preserves additional fields (e.g. statusCode, details) when localizing", () => {
    const text = JSON.stringify({
      message: "Password too short",
      code: "PASSWORD_TOO_SHORT",
      statusCode: 400,
      details: { min: 8 },
    });
    const out = maybeLocalizeBetterAuthError(makeReq(ruI18n()), text);
    const parsed = JSON.parse(out) as {
      message: string;
      code: string;
      statusCode: number;
      details: { min: number };
    };
    expect(parsed.message).toBe("Пароль слишком короткий");
    expect(parsed.code).toBe("PASSWORD_TOO_SHORT");
    expect(parsed.statusCode).toBe(400);
    expect(parsed.details).toEqual({ min: 8 });
  });
});
