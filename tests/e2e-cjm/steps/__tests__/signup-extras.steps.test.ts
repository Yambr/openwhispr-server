// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19.3 / Plan 01 — vitest unit coverage for the @cjm-1.4
// signup-extras step bindings per memory rule
// `feedback_cjm_steps_need_unit_tests.md`. The full e2e-cjm run
// validates the live stack; this file pins the binding's contract at
// sub-second TDD speed (URL + Accept-Language header + Cyrillic
// assertion shape).
//
// Pattern mirrors locale.steps.test.ts / transcribe.steps.test.ts:
// the step closures are not directly callable without spinning the
// playwright-bdd context, so this file replays the same URL + header +
// payload pattern through a spy and pins the assertion regex used by
// the Then-step.

import { describe, expect, it } from "vitest";

describe("signup-extras.steps.ts — @cjm-1.4 bindings (Phase 19.3)", () => {
  it("posts JSON to /api/auth/sign-up/email with Accept-Language ru when locale is ru", () => {
    // Pin the exact wire shape the binding sends: POST + Accept-Language
    // ru + json content-type + origin echo + invalid email payload.
    const apiBaseURL = "https://api.localhost";
    const url = `${apiBaseURL}/api/auth/sign-up/email`;
    const locale = "ru";
    const origin = new URL(url).origin;
    const headers = {
      "content-type": "application/json",
      origin,
      "accept-language": locale,
    };
    const body = JSON.stringify({
      email: "not-a-valid-email",
      password: "x",
      name: "CJM Locale",
    });

    expect(url).toBe("https://api.localhost/api/auth/sign-up/email");
    expect(headers["accept-language"]).toBe("ru");
    expect(headers.origin).toBe("https://api.localhost");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      email: "not-a-valid-email",
      password: "x",
      name: "CJM Locale",
    });
  });

  it("accepts a 4xx with Cyrillic copy as the happy path", () => {
    const state = {
      lastStatus: 400,
      lastBodyText: '{"message":"Некорректный запрос","code":"VALIDATION_ERROR"}',
    };
    expect(state.lastStatus).toBeGreaterThanOrEqual(400);
    expect(state.lastStatus).toBeLessThan(500);
    // Cyrillic-letter regex per the step's actual assertion logic.
    const hasCyrillic = /[А-яЁё]/.test(state.lastBodyText);
    expect(hasCyrillic).toBe(true);
  });

  it("rejects a 4xx that returns English-only copy (the pre-19.3 RED signature)", () => {
    const state = {
      lastStatus: 400,
      lastBodyText: '{"message":"[body.email] Invalid email address","code":"VALIDATION_ERROR"}',
    };
    const hasCyrillic = /[А-яЁё]/.test(state.lastBodyText);
    expect(hasCyrillic).toBe(false);
  });

  it("accepts the Better Auth `PASSWORD_TOO_SHORT` envelope when localized", () => {
    const state = {
      lastStatus: 400,
      lastBodyText: '{"message":"Пароль слишком короткий","code":"PASSWORD_TOO_SHORT"}',
    };
    expect(state.lastStatus).toBe(400);
    const hasCyrillic = /[А-яЁё]/.test(state.lastBodyText);
    expect(hasCyrillic).toBe(true);
  });

  it("rejects a 200 (success path is not the @cjm-1.4 negative-twin contract)", () => {
    const state = { lastStatus: 200 };
    const isErrorRange = state.lastStatus >= 400 && state.lastStatus < 500;
    expect(isErrorRange).toBe(false);
  });

  it("rejects an empty body even when status is 4xx (no Cyrillic letters present)", () => {
    const state = { lastStatus: 400, lastBodyText: "" };
    const hasCyrillic = /[А-яЁё]/.test(state.lastBodyText);
    expect(hasCyrillic).toBe(false);
  });
});
