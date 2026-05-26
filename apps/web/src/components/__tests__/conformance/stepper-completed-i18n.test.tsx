// SPDX-License-Identifier: FSL-1.1-ALv2
// Pre-prod blocker B3 (quick 260526-lgn) — translate stepper completed sr-only.
//
// `apps/web/src/components/ui/stepper.tsx` line 146 renders
// `<span className="sr-only">Completed</span>` inside the StepIndicator
// component's `status === "complete"` branch. This is announced verbatim
// by NVDA/VoiceOver on every completed step indicator of the /setup
// wizard (universal first-launch flow), so a ru-locale user hears
// "Completed" in English on each completed step.
//
// The stepper.tsx primitive is intentionally presentational (vendored
// shadcn-stepper community port, excluded from vitest coverage). The
// localization happens at the call-site (SetupForm.tsx, already holds
// `t` from useTranslation(["end-user", "common"])). StepIndicator gains
// a REQUIRED `completedLabel: string` prop (no default) — TS forces the
// single existing call-site to pass a localized value.
//
// What this asserts (source-level + locale-parity):
//   1. stepper.tsx declares `completedLabel: string` on StepIndicatorProps
//      AND renders `{completedLabel}` inside the sr-only span.
//   2. The literal `sr-only">Completed<` no longer appears in stepper.tsx.
//   3. SetupForm.tsx passes
//      `completedLabel={t("end-user:end-user.setup.step.completed.aria.label")}`
//      to the <StepIndicator>.
//   4. en + ru end-user.json both define
//      `setup.step.completed.aria.label` with non-empty string values;
//      ru differs from en.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(__dirname, "../../../..");

const STEPPER_REL = "src/components/ui/stepper.tsx";
const SETUPFORM_REL = "src/components/screens/auth/SetupForm.tsx";
const EN_REL = "src/locales/en/end-user.json";
const RU_REL = "src/locales/ru/end-user.json";

interface EndUserLocale {
  "end-user"?: {
    setup?: {
      step?: {
        completed?: {
          aria?: { label?: string };
        };
      };
    };
  };
}

function readCompletedLabel(rel: string): string | undefined {
  const json = JSON.parse(readFileSync(resolve(WEB_ROOT, rel), "utf8")) as EndUserLocale;
  return json["end-user"]?.setup?.step?.completed?.aria?.label;
}

describe("Pre-prod blocker B3 — Stepper completed sr-only i18n", () => {
  it("stepper.tsx declares required `completedLabel: string` on StepIndicatorProps", () => {
    const src = readFileSync(resolve(WEB_ROOT, STEPPER_REL), "utf8");
    expect(src).toContain("completedLabel: string");
  });

  it("stepper.tsx renders `{completedLabel}` inside the sr-only span", () => {
    const src = readFileSync(resolve(WEB_ROOT, STEPPER_REL), "utf8");
    expect(src).toMatch(/<span\s+className="sr-only">\s*\{completedLabel\}\s*<\/span>/);
  });

  it("stepper.tsx no longer contains the hardcoded `>Completed<` sr-only literal", () => {
    const src = readFileSync(resolve(WEB_ROOT, STEPPER_REL), "utf8");
    expect(src).not.toMatch(/sr-only">Completed</);
  });

  it("SetupForm.tsx passes completedLabel={t(...)} to <StepIndicator>", () => {
    const src = readFileSync(resolve(WEB_ROOT, SETUPFORM_REL), "utf8");
    expect(src).toMatch(
      /completedLabel=\{\s*t\(\s*["']end-user:end-user\.setup\.step\.completed\.aria\.label["']/,
    );
  });

  it("en end-user.json defines setup.step.completed.aria.label as a non-empty string", () => {
    const value = readCompletedLabel(EN_REL);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it("ru end-user.json defines setup.step.completed.aria.label as a non-empty string", () => {
    const value = readCompletedLabel(RU_REL);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it("ru value for setup.step.completed.aria.label differs from en", () => {
    expect(readCompletedLabel(RU_REL)).not.toEqual(readCompletedLabel(EN_REL));
  });
});
