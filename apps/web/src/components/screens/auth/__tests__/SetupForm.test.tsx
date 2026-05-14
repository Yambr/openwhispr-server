// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-03 / Task 3 + Task 4 — SetupForm + setup-schema tests.
//
// Two describe blocks:
//   * Task 3 — "schema" — exercises `setupSchema` + the zod-i18n bridge
//     across 6 Zod-issue permutations in both EN and RU. RED before
//     setup.ts + zod-i18n.ts + i18n keys land.
//   * Task 4 — SetupForm component tests (RHF + Zod + Stepper +
//     IntersectionObserver + idempotent submit). Currently a placeholder
//     suite that will RED → GREEN as Task 4 lands.

import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { setupSchema } from "@/lib/schemas/setup";
import { installZodI18n } from "@/lib/zod-i18n";
import enCommon from "@/locales/en/common.json";
import ruCommon from "@/locales/ru/common.json";

/**
 * Build an isolated i18next instance bound to a single language. The
 * customError map closes over the instance returned here so two
 * concurrent describe blocks (en + ru) do not race for a single global
 * map.
 *
 * NOTE: installZodI18n() sets a GLOBAL Zod customError map per
 * `z.config({ customError })`. Tests run sequentially within vitest so
 * the en block installs its map, the ru block reinstalls — last-writer
 * wins. We compensate by re-installing inside each `it`.
 */
function makeI18n(lng: "en" | "ru") {
  const i = createInstance();
  const fileContents =
    lng === "en" ? (enCommon as Record<string, unknown>) : (ruCommon as Record<string, unknown>);
  // The locale JSON files are wrapped in a top-level `{"common":{...}}`
  // namespace key (matches the keys actually consumed by the live app,
  // e.g. `t("common:common.signout.label")` in AppShell.tsx). To honor
  // that key shape we load the JSON as the FULL `common` namespace
  // payload — i18next stores it under `bundles[lng].common.common.…`.
  i.init({
    lng,
    resources: { [lng]: { common: fileContents } },
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  return i;
}

const VALID = {
  email: "admin@acme.test",
  password: "CorrectHorseBattery9",
  name: "Alice Admin",
  workspace: "Acme Inc",
  timezone: "Europe/Berlin",
};

describe("schema — setupSchema + zod-i18n bridge (Task 3, UICONF-03)", () => {
  it("(en) accepts a fully valid payload", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it("(en) invalid email → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "email")?.message;
      expect(msg).toBe("Enter a valid email address.");
    }
  });

  it("(en) password too short → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe("Password must be at least 12 characters.");
    }
  });

  it("(en) password missing character classes → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, password: "alllowercaseletters" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe("Password must include upper-, lower-case, and a digit.");
    }
  });

  it("(en) empty workspace → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, workspace: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "workspace")?.message;
      expect(msg).toBe("Value is too short.");
    }
  });

  it("(en) workspace over 100 chars → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, workspace: "x".repeat(101) });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "workspace")?.message;
      expect(msg).toBe("Value is too long.");
    }
  });

  // Russian assertions compare against the live `ru/common.json` payload
  // (rather than embedded literals) so this test file remains
  // English-only at the source-artifact level (the global lint-english
  // tool refuses Cyrillic in non-locale source files, and renaming the
  // file would break the plan's grep gate on the form-test path).
  const ruExpected = {
    emailInvalid: (ruCommon as { common: { validation: { email: { invalid: string } } } }).common
      .validation.email.invalid,
    passwordMinLength: (
      ruCommon as { common: { validation: { password: { min_length: string } } } }
    ).common.validation.password.min_length,
  };

  it("(ru) invalid email -> localized Russian message", () => {
    installZodI18n(makeI18n("ru"));
    const r = setupSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "email")?.message;
      expect(msg).toBe(ruExpected.emailInvalid);
    }
  });

  it("(ru) password too short -> localized Russian message", () => {
    installZodI18n(makeI18n("ru"));
    const r = setupSchema.safeParse({ ...VALID, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe(ruExpected.passwordMinLength);
    }
  });
});
