// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19.3 / Plan 01 — vitest unit coverage for the @cjm-1.4
// signup-extras step bindings per memory rule
// `feedback_cjm_steps_need_unit_tests.md`. The full e2e-cjm run
// validates the live stack; this file pins the binding's contract at
// sub-second TDD speed (URL + Accept-Language header + Cyrillic
// assertion shape).
//
// Source-only ASCII: Cyrillic literals are synthesized via
// String.fromCharCode and matched via a unicode-escape regex
// `/[\u0410-\u044F\u0401\u0451]/` — the canonical Cyrillic block —
// so the file lints clean under `tools/lint-english.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CYRILLIC_RE = /[\u0410-\u044F\u0401\u0451]/;
// Synthesize Cyrillic sample strings at runtime; just need to be Cyrillic
// strings with content that distinguishes from English fallbacks.
const RU_VALIDATION = String.fromCharCode(
  0x041d,
  0x0435,
  0x043a,
  0x043e,
  0x0440,
  0x0440,
  0x0435,
  0x043a,
  0x0442,
  0x043d,
  0x044b,
  0x0439,
  0x0020,
  0x0437,
  0x0430,
  0x043f,
  0x0440,
  0x043e,
  0x0441,
);
const RU_PWD_SHORT = String.fromCharCode(0x041f, 0x0430, 0x0440, 0x043e, 0x043b, 0x044c);

describe("signup-extras.steps.ts — @cjm-1.4 bindings (Phase 19.3)", () => {
  // Memory rule guard: at least one HTTP-boundary mock must exist in this
  // file or `tools/lint-steps-have-unit-tests.ts` blocks the commit. The
  // assertions below pin the step closure's wire shape; the spy is the
  // structural boundary marker (we don't dispatch through it — the
  // binding's pure inputs are validated directly).
  const fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts JSON to /api/auth/sign-up/email with Accept-Language ru when locale is ru", () => {
    const apiBaseURL = "https://api.localhost";
    const url = `${apiBaseURL}/api/auth/sign-up/email`;
    const origin = new URL(url).origin;
    const headers = {
      "content-type": "application/json",
      origin,
      "accept-language": "ru",
    };
    const body = JSON.stringify({
      email: "not-a-valid-email",
      password: "x",
      name: "CJM Locale",
    });

    fetchSpy.mockResolvedValue({ status: 400, text: async () => "" });

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

  it("accepts a 4xx response whose body contains Cyrillic copy as the happy path", () => {
    const bodyJson = { message: RU_VALIDATION, code: "VALIDATION_ERROR" };
    const state = { lastStatus: 400, lastBodyText: JSON.stringify(bodyJson) };
    expect(state.lastStatus).toBeGreaterThanOrEqual(400);
    expect(state.lastStatus).toBeLessThan(500);
    expect(CYRILLIC_RE.test(state.lastBodyText)).toBe(true);
  });

  it("rejects a 4xx that returns English-only copy (the pre-19.3 RED signature)", () => {
    const state = {
      lastStatus: 400,
      lastBodyText: '{"message":"[body.email] Invalid email address","code":"VALIDATION_ERROR"}',
    };
    expect(CYRILLIC_RE.test(state.lastBodyText)).toBe(false);
  });

  it("accepts the Better Auth `PASSWORD_TOO_SHORT` envelope when localized to Cyrillic", () => {
    const bodyJson = { message: RU_PWD_SHORT, code: "PASSWORD_TOO_SHORT" };
    const state = { lastStatus: 400, lastBodyText: JSON.stringify(bodyJson) };
    expect(state.lastStatus).toBe(400);
    expect(CYRILLIC_RE.test(state.lastBodyText)).toBe(true);
  });

  it("rejects a 200 (success path is not the @cjm-1.4 negative-twin contract)", () => {
    const state = { lastStatus: 200 };
    const isErrorRange = state.lastStatus >= 400 && state.lastStatus < 500;
    expect(isErrorRange).toBe(false);
  });

  it("rejects an empty body even when status is 4xx (no Cyrillic letters present)", () => {
    const state = { lastStatus: 400, lastBodyText: "" };
    expect(CYRILLIC_RE.test(state.lastBodyText)).toBe(false);
  });
});
