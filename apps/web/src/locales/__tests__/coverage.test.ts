// Phase 07.1 / Plan 06 — locale-bundle coverage gate (RED before GREEN).
//
// Parses the canonical Appendix C key index from both UI-SPEC files at
// test time and asserts every key resolves to a non-empty string in the
// matching `apps/web/src/locales/en/{admin,end-user,common}.json` bundle.
//
// Source of truth: UI-SPEC files. If a UI-SPEC adds a key, this test
// fails until the locale bundle picks it up — no separate inventory.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import adminBundle from "../en/admin.json";
import commonBundle from "../en/common.json";
import endUserBundle from "../en/end-user.json";
import adminBundleRu from "../ru/admin.json";
import commonBundleRu from "../ru/common.json";
import endUserBundleRu from "../ru/end-user.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = <repo>/apps/web/src/locales/__tests__ → five `..` steps to repo root.
const REPO_ROOT = resolve(__dirname, "../../../../..");
const ADMIN_SPEC = resolve(REPO_ROOT, ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md");
const END_USER_SPEC = resolve(
  REPO_ROOT,
  ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md",
);

// Match a row like: | `admin.foo.bar.baz.label` | English copy |
// The key must start with one of the three known namespaces.
const KEY_ROW = /^\|\s*`(admin|end-user|common)\.([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm;

interface ExtractedKey {
  ns: string;
  key: string;
  english: string;
}

function extractKeys(specPath: string): ExtractedKey[] {
  const text = readFileSync(specPath, "utf8");
  const out: ExtractedKey[] = [];
  KEY_ROW.lastIndex = 0;
  for (;;) {
    const m = KEY_ROW.exec(text);
    if (m === null) break;
    out.push({
      ns: m[1] as string,
      key: `${m[1]}.${m[2]}`,
      english: (m[3] as string).trim(),
    });
  }
  return out;
}

function resolveKey(bundle: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in (acc as object)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, bundle);
}

function bundleFor(ns: string): Record<string, unknown> {
  if (ns === "admin") return adminBundle as Record<string, unknown>;
  if (ns === "end-user") return endUserBundle as Record<string, unknown>;
  if (ns === "common") return commonBundle as Record<string, unknown>;
  throw new Error(`unknown namespace ${ns}`);
}

function bundleForRu(ns: string): Record<string, unknown> {
  if (ns === "admin") return adminBundleRu as Record<string, unknown>;
  if (ns === "end-user") return endUserBundleRu as Record<string, unknown>;
  if (ns === "common") return commonBundleRu as Record<string, unknown>;
  throw new Error(`unknown namespace ${ns}`);
}

// Cyrillic codepoint detector (U+0400..U+04FF, U+0500..U+052F). Built only
// from \u escapes so this source stays ASCII-clean and does not self-trip
// `tools/lint-english.ts`.
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F]/;

const allKeys: ExtractedKey[] = [...extractKeys(ADMIN_SPEC), ...extractKeys(END_USER_SPEC)];
// Same Appendix C appears in both UI-SPEC files; de-duplicate by key.
const uniqueKeys: ExtractedKey[] = Object.values(
  allKeys.reduce<Record<string, ExtractedKey>>((acc, k) => {
    acc[k.key] = k;
    return acc;
  }, {}),
);

describe("locale-bundle coverage (Phase 07.1 / Plan 06)", () => {
  it("extracted >= 200 keys from Appendix C across both UI-SPEC files", () => {
    expect(uniqueKeys.length).toBeGreaterThanOrEqual(200);
  });

  for (const { ns, key, english } of uniqueKeys) {
    it(`bundle '${ns}' contains '${key}' with non-empty English value`, () => {
      const value = resolveKey(bundleFor(ns), key);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
      // Soft check: bundle value must match the Appendix C English column
      // (the UI-SPEC is the single source of truth).
      expect(value).toBe(english);
    });
  }

  // Phase 10 / Plan 02 — Russian parity: every UI-SPEC key must also exist
  // in the matching ru bundle with a non-empty Cyrillic string (the UI-SPEC
  // is English-only, so we cannot match a Russian source column — we only
  // assert structural presence + Cyrillic content as a translation
  // sanity check).
  for (const { ns, key } of uniqueKeys) {
    it(`ru bundle '${ns}' contains '${key}' with a Russian string`, () => {
      const value = resolveKey(bundleForRu(ns), key);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
      expect(CYRILLIC.test(value as string)).toBe(true);
    });
  }
});
