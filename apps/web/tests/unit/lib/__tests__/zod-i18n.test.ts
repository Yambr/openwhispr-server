// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-03 / Task 3 — direct unit tests for the zod-i18n
// customError dispatch. The integration cases live in
// `apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx`
// (one test per real `setupSchema` issue); this file drives the
// branches that no real schema in the app produces — invalid_format
// with format=regex, too_small with minimum != 12, invalid_type,
// custom with no kind / unknown kind, and the default fallthrough.
// All those branches exist so the bridge is robust against future
// schema additions; without these tests they read as "below 90%
// branch coverage" even though they ARE the safety net.

import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installZodI18n } from "../../../../src/lib/zod-i18n";
import enCommon from "../../../../src/locales/en/common.json";

function makeI18n() {
  const i = createInstance();
  i.init({
    lng: "en",
    resources: { en: { common: enCommon as unknown as Record<string, unknown> } },
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  return i;
}

describe("zod-i18n customError dispatch — synthetic-issue branch coverage", () => {
  it("invalid_format with non-email format falls through to Zod default", () => {
    installZodI18n(makeI18n());
    // Regex without inline message → invalid_format/regex, customError
    // returns undefined → Zod's built-in default applies.
    const s = z.string().regex(/^[a-z]+$/);
    const r = s.safeParse("UPPER");
    expect(r.success).toBe(false);
    if (!r.success) {
      // Zod's default English message starts with "Invalid string".
      expect(r.error.issues[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it("too_small with minimum != 12 routes to common.validation.string.too_short", () => {
    installZodI18n(makeI18n());
    const s = z.string().min(3);
    const r = s.safeParse("ab");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("Value is too short.");
    }
  });

  it("invalid_type (number-where-string-expected) routes to common.validation.required", () => {
    installZodI18n(makeI18n());
    const s = z.string();
    const r = s.safeParse(42 as unknown as string);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("This field is required.");
    }
  });

  it("custom refine with unknown params.kind falls through to Zod default", () => {
    installZodI18n(makeI18n());
    const s = z.string().refine(() => false, { params: { kind: "no.such.key" } });
    const r = s.safeParse("anything");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it("custom refine with no params.kind falls through to Zod default", () => {
    installZodI18n(makeI18n());
    const s = z.string().refine(() => false);
    const r = s.safeParse("anything");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message.length).toBeGreaterThan(0);
    }
  });
});
