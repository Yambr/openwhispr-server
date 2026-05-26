// SPDX-License-Identifier: FSL-1.1-ALv2
// Pre-prod blocker B1 (quick 260526-lgn) — translate AdminForbidden 403 surface.
//
// `apps/web/src/app/(admin)/layout.tsx`'s `AdminForbidden()` renders a
// hardcoded EN "403 — Forbidden" heading + English body on the first paint
// for any signed-in non-admin user — a ru-locale user sees English even
// though every other admin-route string flows through getServerI18n.
//
// This conformance test asserts (source-level + locale-parity):
//   1. layout.tsx now imports getServerI18n + next/headers and calls
//      t("admin:admin.forbidden.title.text") on the title surface.
//   2. The literal "403 — Forbidden" no longer appears anywhere in the
//      source file.
//   3. en + ru admin.json both define the new four-key surface
//      (title.text, body_prefix.text, body_middle.text, body_suffix.text)
//      with non-empty string values.
//   4. en value !== ru value for every key (loose smoke check — catches
//      accidental EN copy-paste into ru bundle).
//
// Pattern mirrors src/components/screens/__tests__/locale-parity-sweep.test.tsx
// (Plan 51-11e). No render assertion because (admin)/layout.tsx is in the
// vitest coverage `exclude` list (RSC route, exercised by Playwright).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(__dirname, "../../../..");

const LAYOUT_REL = "src/app/(admin)/layout.tsx";
const EN_REL = "src/locales/en/admin.json";
const RU_REL = "src/locales/ru/admin.json";

const KEYS = ["title.text", "body_prefix.text", "body_middle.text", "body_suffix.text"] as const;

interface ForbiddenSurface {
  title?: { text?: string };
  body_prefix?: { text?: string };
  body_middle?: { text?: string };
  body_suffix?: { text?: string };
}
interface AdminLocale {
  admin?: { forbidden?: ForbiddenSurface };
}

function readForbidden(rel: string): ForbiddenSurface {
  const json = JSON.parse(readFileSync(resolve(WEB_ROOT, rel), "utf8")) as AdminLocale;
  return json.admin?.forbidden ?? {};
}

function pick(surface: ForbiddenSurface, key: (typeof KEYS)[number]): string | undefined {
  if (key === "title.text") return surface.title?.text;
  if (key === "body_prefix.text") return surface.body_prefix?.text;
  if (key === "body_middle.text") return surface.body_middle?.text;
  return surface.body_suffix?.text;
}

describe("Pre-prod blocker B1 — AdminForbidden 403 surface i18n", () => {
  it("layout.tsx imports getServerI18n + next/headers + calls t() on the title surface", () => {
    const src = readFileSync(resolve(WEB_ROOT, LAYOUT_REL), "utf8");
    expect(src).toMatch(/getServerI18n\s*\(/);
    expect(src).toMatch(/from\s+["']next\/headers["']/);
    expect(src).toMatch(/t\(\s*["']admin:admin\.forbidden\.title\.text["']/);
  });

  it("layout.tsx no longer contains the hardcoded '403 — Forbidden' literal", () => {
    const src = readFileSync(resolve(WEB_ROOT, LAYOUT_REL), "utf8");
    expect(src).not.toMatch(/403 — Forbidden/);
  });

  it.each(KEYS)("en admin.json defines admin.forbidden.%s as a non-empty string", (key) => {
    const value = pick(readForbidden(EN_REL), key);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it.each(KEYS)("ru admin.json defines admin.forbidden.%s as a non-empty string", (key) => {
    const value = pick(readForbidden(RU_REL), key);
    expect(value).toBeTypeOf("string");
    expect((value ?? "").length).toBeGreaterThan(0);
  });

  it.each(KEYS)("ru value for admin.forbidden.%s differs from en (translation present)", (key) => {
    const en = pick(readForbidden(EN_REL), key);
    const ru = pick(readForbidden(RU_REL), key);
    expect(ru).not.toEqual(en);
  });
});
