// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11e — REVIEW web HI-02 (full close).
// Plan 51-11d closed the 7 AlertDialogCancel sites; this commit
// closes the remaining HI-02 surfaces with new locale keys:
//   - AdminShell "OpenWhispr — Admin"  → common.brand.admin.title.label
//   - AdminShell "Admin mode"          → common.brand.mode.admin.label
//   - AppShell   "OpenWhispr"          → common.brand.app.title.label
//   - AuthShell  "OpenWhispr Server"   → common.brand.auth.title.label
//   - SessionsTable "this device"      → common.session.thisDevice.label
//   - NotesSearchClient "(untitled)"   → common.placeholder.untitled.label
//   - ConfigClient "Yes"/"No"          → common.action.{yes,no}.label
//
// error-boundary.tsx remains static English on purpose — comment at
// L9-12 documents the defence-against-i18n-chunk-failure rationale
// and the review explicitly allowed it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(__dirname, "../../../..");

interface KeyAssertion {
  rel: string;
  key: string;
  forbidden: RegExp;
}

const ASSERTIONS: KeyAssertion[] = [
  {
    rel: "src/components/screens/AdminShell.tsx",
    key: "common:common.brand.admin.title.label",
    forbidden: /OpenWhispr — Admin"|OpenWhispr — Admin</,
  },
  {
    rel: "src/components/screens/AdminShell.tsx",
    key: "common:common.brand.mode.admin.label",
    forbidden: />Admin mode</,
  },
  {
    rel: "src/components/screens/AppShell.tsx",
    key: "common:common.brand.app.title.label",
    forbidden: />OpenWhispr</,
  },
  {
    rel: "src/components/screens/auth/AuthShell.tsx",
    key: "common:common.brand.auth.title.label",
    forbidden: />OpenWhispr Server</,
  },
  {
    rel: "src/components/screens/account/SessionsTable.tsx",
    key: "common:common.session.thisDevice.label",
    forbidden: /^\s*this device\s*$/m,
  },
  {
    rel: "src/components/screens/notes/NotesSearchClient.tsx",
    key: "common:common.placeholder.untitled.label",
    forbidden: /"\(untitled\)"/,
  },
  {
    rel: "src/components/screens/admin/ConfigClient.tsx",
    key: "common:common.action.yes.label",
    forbidden: /\?\s*"Yes"\s*:/,
  },
  {
    rel: "src/components/screens/admin/ConfigClient.tsx",
    key: "common:common.action.no.label",
    forbidden: /:\s*"No"/,
  },
];

describe("Plan 51-11e — HI-02 locale parity sweep", () => {
  it.each(ASSERTIONS)("$rel uses t('$key')", ({ rel, key }) => {
    const src = readFileSync(resolve(WEB_ROOT, rel), "utf8");
    expect(src).toMatch(new RegExp(`t\\(\\s*"${key.replace(/\./g, "\\.")}"`));
  });

  it.each(ASSERTIONS)("$rel removed the literal", ({ rel, forbidden }) => {
    const src = readFileSync(resolve(WEB_ROOT, rel), "utf8");
    expect(src).not.toMatch(forbidden);
  });

  it("both locales define every new key (parity)", () => {
    type NestedLocale = {
      common?: {
        action?: { yes?: { label?: string }; no?: { label?: string } };
        brand?: {
          app?: { title?: { label?: string } };
          admin?: { title?: { label?: string } };
          auth?: { title?: { label?: string } };
          mode?: { admin?: { label?: string } };
        };
        session?: { thisDevice?: { label?: string } };
        placeholder?: { untitled?: { label?: string } };
      };
    };
    const en = JSON.parse(
      readFileSync(resolve(WEB_ROOT, "src/locales/en/common.json"), "utf8"),
    ) as NestedLocale;
    const ru = JSON.parse(
      readFileSync(resolve(WEB_ROOT, "src/locales/ru/common.json"), "utf8"),
    ) as NestedLocale;

    const paths: Array<(l: NestedLocale) => string | undefined> = [
      (l) => l.common?.action?.yes?.label,
      (l) => l.common?.action?.no?.label,
      (l) => l.common?.brand?.app?.title?.label,
      (l) => l.common?.brand?.admin?.title?.label,
      (l) => l.common?.brand?.auth?.title?.label,
      (l) => l.common?.brand?.mode?.admin?.label,
      (l) => l.common?.session?.thisDevice?.label,
      (l) => l.common?.placeholder?.untitled?.label,
    ];
    for (const p of paths) {
      expect(p(en)).toBeTypeOf("string");
      expect(p(en)?.length ?? 0).toBeGreaterThan(0);
      expect(p(ru)).toBeTypeOf("string");
      expect(p(ru)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
