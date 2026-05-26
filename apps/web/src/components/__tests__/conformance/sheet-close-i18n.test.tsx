// SPDX-License-Identifier: FSL-1.1-ALv2
// Pre-prod blocker B2 (quick 260526-lgn) — translate sheet close sr-only.
//
// `apps/web/src/components/ui/sheet.tsx` (vendored shadcn primitive) line
// 75 renders `<span className="sr-only">Close</span>` — the audible label
// announced by NVDA/VoiceOver whenever the mobile-folders Sheet close
// button is read. A ru-locale user hears "Close" in English.
//
// The shadcn primitive is intentionally presentational (excluded from
// vitest.config.ts coverage `src/components/ui/**`), so it does NOT call
// useTranslation itself. Instead `SheetContent` accepts a REQUIRED
// `closeLabel: string` prop and renders it inside the sr-only span. The
// localization happens at the call-site, which holds `t` from
// useTranslation(...).
//
// Discovery: `<SheetContent>` currently has ZERO call-sites in apps/web —
// the mobile-folders Sheet is annotated as a "P0 polish task in Plan 12
// (final pass)" in AppShell.tsx. Making the prop required pre-emptively
// locks future call-sites into the localized pattern: no English fallback
// default exists, so TS forces every consumer to pass a localized string.
//
// What this asserts (source-level + locale-parity):
//   1. sheet.tsx source declares `closeLabel: string` on SheetContent's
//      prop type AND renders `{closeLabel}` inside the sr-only span.
//   2. The literal `sr-only">Close<` no longer appears in sheet.tsx.
//   3. en + ru common.json both define `common.action.close.label` with
//      non-empty string values; ru differs from en.
//
// No render assertion: sheet.tsx is coverage-excluded vendored shadcn;
// future call-site render tests will own behavioural coverage at the
// consumer layer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(__dirname, "../../../..");

const SHEET_REL = "src/components/ui/sheet.tsx";
const EN_REL = "src/locales/en/common.json";
const RU_REL = "src/locales/ru/common.json";

interface CommonLocale {
  common?: {
    action?: {
      close?: { label?: string };
    };
  };
}

function readCloseLabel(rel: string): string | undefined {
  const json = JSON.parse(readFileSync(resolve(WEB_ROOT, rel), "utf8")) as CommonLocale;
  return json.common?.action?.close?.label;
}

describe("Pre-prod blocker B2 — Sheet close sr-only i18n", () => {
  it("sheet.tsx declares required `closeLabel: string` prop on SheetContent", () => {
    const src = readFileSync(resolve(WEB_ROOT, SHEET_REL), "utf8");
    expect(src).toContain("closeLabel: string");
  });

  it("sheet.tsx renders `{closeLabel}` inside the sr-only span", () => {
    const src = readFileSync(resolve(WEB_ROOT, SHEET_REL), "utf8");
    expect(src).toMatch(/<span\s+className="sr-only">\s*\{closeLabel\}\s*<\/span>/);
  });

  it("sheet.tsx no longer contains the hardcoded `>Close<` sr-only literal", () => {
    const src = readFileSync(resolve(WEB_ROOT, SHEET_REL), "utf8");
    expect(src).not.toMatch(/sr-only">Close</);
  });

  it("en common.json defines common.action.close.label as a non-empty string", () => {
    const value = readCloseLabel(EN_REL);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it("ru common.json defines common.action.close.label as a non-empty string", () => {
    const value = readCloseLabel(RU_REL);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it("ru value for common.action.close.label differs from en (translation present)", () => {
    expect(readCloseLabel(RU_REL)).not.toEqual(readCloseLabel(EN_REL));
  });
});
