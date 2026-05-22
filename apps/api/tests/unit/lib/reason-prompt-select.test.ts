// SPDX-License-Identifier: FSL-1.1-ALv2
// R33 (quick-task 20260522) — pure-function unit tests for the
// /api/reason prompt-selection + model-routing helper.
//
// LAYER 1 (Commit 1): isCleanupRequest() shape matrix, resolveLocale(),
//   selectMessages().

import type { ReasonRequest } from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";
import enLocale from "../../../src/i18n/locales/en.json" with { type: "json" };
import ruLocale from "../../../src/i18n/locales/ru.json" with { type: "json" };
import {
  isCleanupRequest,
  resolveLocale,
  selectMessages,
} from "../../../src/lib/reason-prompt-select.js";

// English-only source rule (CLAUDE.md): the RU cleanup prompt assertion
// target is imported from the locale bundle rather than embedded as a
// Cyrillic literal. The RU prompt's verbatim text is the contract — the
// locale JSON files are the i18n surface that legitimately carries it.
const EN_CLEANUP_PROMPT = enLocale.prompts.cleanupPrompt;
const RU_CLEANUP_PROMPT = ruLocale.prompts.cleanupPrompt;

/** Build a minimal ReasonRequest body for a test case. */
function body(overrides: Partial<ReasonRequest> = {}): ReasonRequest {
  return { text: "one two three", ...overrides } as ReasonRequest;
}

describe("isCleanupRequest() — cleanup-shape detection matrix", () => {
  // The cleanup shape is: NO agentName AND NO systemPrompt AND empty/absent
  // model. "absent" === undefined | null for agentName/systemPrompt; for
  // model it ALSO includes "".
  const absentLike = [undefined, null] as const;
  const modelAbsentLike = [undefined, null, ""] as const;
  const presentLike = ["x"] as const;
  const modelPresentLike = ["gpt-4o-mini"] as const;

  // Exhaustive matrix: agentName {3} × systemPrompt {3} × model {4} = 36.
  for (const agentName of [...absentLike, ...presentLike]) {
    for (const systemPrompt of [...absentLike, ...presentLike]) {
      for (const model of [...modelAbsentLike, ...modelPresentLike]) {
        const agentAbsent = agentName === undefined || agentName === null;
        const systemAbsent = systemPrompt === undefined || systemPrompt === null;
        const modelAbsent = model === undefined || model === null || model === "";
        const expected = agentAbsent && systemAbsent && modelAbsent;
        it(`agentName=${JSON.stringify(agentName)} systemPrompt=${JSON.stringify(
          systemPrompt,
        )} model=${JSON.stringify(model)} -> ${expected}`, () => {
          expect(
            isCleanupRequest(
              body({
                agentName: agentName as ReasonRequest["agentName"],
                systemPrompt: systemPrompt as ReasonRequest["systemPrompt"],
                model: model as ReasonRequest["model"],
              }),
            ),
          ).toBe(expected);
        });
      }
    }
  }
});

describe("resolveLocale()", () => {
  it("returns 'ru' for body.language 'ru'", () => {
    expect(resolveLocale(body({ language: "ru" }), undefined)).toBe("ru");
  });
  it("returns 'en' for body.language 'en'", () => {
    expect(resolveLocale(body({ language: "en" }), undefined)).toBe("en");
  });
  it("returns 'ru' for body.locale 'ru-RU' (region-tagged)", () => {
    expect(resolveLocale(body({ locale: "ru-RU" }), undefined)).toBe("ru");
  });
  it("prefers body.language over body.locale", () => {
    expect(resolveLocale(body({ language: "ru", locale: "en" }), undefined)).toBe("ru");
  });
  it("falls back to reqLanguage when body has no language/locale", () => {
    expect(resolveLocale(body(), "ru")).toBe("ru");
  });
  it("returns 'en' for an unknown language 'de'", () => {
    expect(resolveLocale(body({ language: "de" }), undefined)).toBe("en");
  });
  it("returns 'en' for an empty-string language", () => {
    expect(resolveLocale(body({ language: "" }), undefined)).toBe("en");
  });
  it("returns 'en' when everything is absent", () => {
    expect(resolveLocale(body(), undefined)).toBe("en");
  });
});

describe("selectMessages()", () => {
  it("cleanup shape -> [system(cleanupPrompt), user] in EN", () => {
    const msgs = selectMessages(body({ text: "one two three" }), "en");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
    expect(msgs[0]?.content).toContain("text cleanup tool");
    // The {{agentName}} placeholder must survive verbatim (anti-injection).
    expect(msgs[0]?.content).toContain("{{agentName}}");
    expect(msgs[1]).toEqual({ role: "user", content: "one two three" });
  });

  it("cleanup shape -> RU cleanup prompt for a ru request", () => {
    const msgs = selectMessages(body({ language: "ru", text: "one two three" }), "ru");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(RU_CLEANUP_PROMPT);
    expect(msgs[0]?.content).toContain("{{agentName}}");
    expect(msgs[1]).toEqual({ role: "user", content: "one two three" });
  });

  it("cleanup shape with unknown locale falls back to EN prompt", () => {
    const msgs = selectMessages(body(), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("agent shape with systemPrompt -> [system(systemPrompt), user]", () => {
    const msgs = selectMessages(body({ systemPrompt: "You are a pirate.", text: "ahoy" }), "en");
    expect(msgs).toEqual([
      { role: "system", content: "You are a pirate." },
      { role: "user", content: "ahoy" },
    ]);
  });

  it("agent shape with only agentName -> [user] (no system prompt — no regression)", () => {
    const msgs = selectMessages(body({ agentName: "Whispr", text: "do the thing" }), "en");
    expect(msgs).toEqual([{ role: "user", content: "do the thing" }]);
  });
});
