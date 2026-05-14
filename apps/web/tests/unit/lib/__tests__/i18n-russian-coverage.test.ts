// SPDX-License-Identifier: Apache-2.0
// Phase 10 / Plan 02 — Russian bundle parity gate (RED before GREEN).
//
// Asserts every key present in `apps/web/src/locales/en/{common,admin,end-user}.json`
// also exists in `apps/web/src/locales/ru/*.json` with a non-empty string
// value. This is a key-parity test only — translation quality is not graded
// here; the only structural requirement is non-empty Russian text.
import { describe, expect, it } from "vitest";

import adminEn from "../../../../src/locales/en/admin.json";
import commonEn from "../../../../src/locales/en/common.json";
import endUserEn from "../../../../src/locales/en/end-user.json";
import adminRu from "../../../../src/locales/ru/admin.json";
import commonRu from "../../../../src/locales/ru/common.json";
import endUserRu from "../../../../src/locales/ru/end-user.json";

type Bundle = Record<string, unknown>;

function flatten(obj: Bundle, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === "object") {
      for (const [kk, vv] of flatten(v as Bundle, path).entries()) {
        out.set(kk, vv);
      }
    } else if (typeof v === "string") {
      out.set(path, v);
    }
  }
  return out;
}

interface Pair {
  ns: string;
  en: Bundle;
  ru: Bundle;
}

const PAIRS: Pair[] = [
  { ns: "common", en: commonEn as Bundle, ru: commonRu as Bundle },
  { ns: "admin", en: adminEn as Bundle, ru: adminRu as Bundle },
  { ns: "end-user", en: endUserEn as Bundle, ru: endUserRu as Bundle },
];

describe("Russian bundle parity (Phase 10 / Plan 02)", () => {
  for (const { ns, en, ru } of PAIRS) {
    const flatEn = flatten(en);
    const flatRu = flatten(ru);

    it(`${ns}: every English key exists in Russian`, () => {
      const missing: string[] = [];
      for (const k of flatEn.keys()) {
        if (!flatRu.has(k)) missing.push(k);
      }
      expect(missing).toEqual([]);
    });

    it(`${ns}: every Russian value is a non-empty string`, () => {
      const empty: string[] = [];
      for (const [k, v] of flatRu.entries()) {
        if (typeof v !== "string" || v.trim().length === 0) empty.push(k);
      }
      expect(empty).toEqual([]);
    });

    it(`${ns}: no Russian-only orphan keys absent from English`, () => {
      const orphans: string[] = [];
      for (const k of flatRu.keys()) {
        if (!flatEn.has(k)) orphans.push(k);
      }
      expect(orphans).toEqual([]);
    });
  }
});
