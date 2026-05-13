// Phase 10 / Plan 02 — Web ICU plural-rules parity (RED before GREEN).
//
// Instantiates a client-style i18next instance with the `i18next-icu`
// plugin and the Russian common bundle, then exercises the CLDR Russian
// plural categories at boundary integers. The Russian plural rule is:
//   n % 10 == 1 && n % 100 != 11           → one
//   n % 10 ∈ [2,4] && n % 100 ∉ [12,14]    → few
//   n % 10 == 0 || n % 10 ∈ [5,9] ||
//     n % 100 ∈ [11,14]                    → many
//   otherwise                              → other (fractional)
//
// We embed a small ICU MessageFormat string at the dedicated key
// `common.test.plural.unread`:
//   "{count, plural, one{# unread message} few{# unread} many{# unread} other{# unread}}"
// — its Russian translation supplies natural surface forms, and we assert
// that each boundary integer routes to the expected category.
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { describe, expect, it } from "vitest";

import commonRu from "../../locales/ru/common.json";

interface Case {
  n: number;
  expected: "one" | "few" | "many";
}

// Sample integers covering each CLDR ru plural category at canonical
// boundaries. Pure "other" is for fractional n; we omit it here because
// the unread-count surface only takes integers.
const CASES: Case[] = [
  { n: 0, expected: "many" },
  { n: 1, expected: "one" },
  { n: 2, expected: "few" },
  { n: 3, expected: "few" },
  { n: 5, expected: "many" },
  { n: 11, expected: "many" },
  { n: 21, expected: "one" },
  { n: 22, expected: "few" },
  { n: 25, expected: "many" },
  { n: 101, expected: "one" },
  { n: 105, expected: "many" },
];

// Marker substrings keyed by category. The actual Russian translation
// must include each marker exactly once in the matching plural arm of
// `common.test.plural.unread` (see ru/common.json).
const MARKERS: Record<"one" | "few" | "many", string> = {
  one: "ONE_ARM",
  few: "FEW_ARM",
  many: "MANY_ARM",
};

describe("web ICU plural rules — ru (Phase 10 / Plan 02)", () => {
  it("each CLDR boundary integer routes to the expected plural arm", async () => {
    const i = createInstance();
    i.use(ICU);
    await i.init({
      lng: "ru",
      resources: { ru: commonRu as unknown as Record<string, Record<string, unknown>> },
      ns: ["common"],
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });

    for (const { n, expected } of CASES) {
      const out = i.t("common.test.plural.unread", { count: n });
      expect(out, `n=${n}`).toContain(MARKERS[expected]);
    }
  });
});
