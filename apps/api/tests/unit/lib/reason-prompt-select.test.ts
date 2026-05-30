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
  QWEN_THINKING_OFF_EXTRAS,
  resolveLocale,
  selectMessages,
  selectModelAndExtras,
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

  it("cleanup shape with non-empty customPrompt -> [system(customPrompt VERBATIM), user] (tier 1)", () => {
    // Tier 1 of the three-tier precedence: the user's Prompt-Studio
    // cleanup override wins over the server localized default.
    const custom = "Strip filler. Output only cleaned text. Nothing else.";
    const msgs = selectMessages(body({ customPrompt: custom, text: "uh one two" }), "en");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: custom });
    expect(msgs[0]?.content).not.toBe(EN_CLEANUP_PROMPT);
    expect(msgs[1]).toEqual({ role: "user", content: "uh one two" });
  });

  it("cleanup shape with empty-string customPrompt -> falls through to localized default (tier 2)", () => {
    const msgs = selectMessages(body({ customPrompt: "" }), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("cleanup shape with whitespace-only customPrompt -> falls through to localized default (tier 2)", () => {
    const msgs = selectMessages(body({ customPrompt: "   \n  " }), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("cleanup shape with absent customPrompt -> server localized default (tier 2)", () => {
    const msgs = selectMessages(body(), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("cleanup shape with null customPrompt -> server localized default (tier 2)", () => {
    const msgs = selectMessages(
      body({ customPrompt: null as ReasonRequest["customPrompt"] }),
      "ru",
    );
    expect(msgs[0]?.content).toBe(RU_CLEANUP_PROMPT);
  });

  it("customPrompt does NOT override the agent shape (agentName-only stays system-message-free)", () => {
    // customPrompt is a cleanup-shape-only override; an agent-shape
    // request must not gain a system message from it (no regression).
    const msgs = selectMessages(
      body({ agentName: "Whispr", customPrompt: "some override", text: "do it" }),
      "en",
    );
    expect(msgs).toEqual([{ role: "user", content: "do it" }]);
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

describe("selectModelAndExtras() — LAYER 2 model routing + thinking-off", () => {
  const CLEANUP_MODEL = "qwen3.6-cleanup";
  const DEFAULT_MODEL = "qwen3.6-plus";

  it("cleanup shape -> cleanupModel + thinking-off extras", () => {
    const res = selectModelAndExtras(body(), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(CLEANUP_MODEL);
    expect(res.extras).toBeDefined();
    expect(
      (res.extras as { extra_body?: { chat_template_kwargs?: { enable_thinking?: boolean } } })
        .extra_body?.chat_template_kwargs?.enable_thinking,
    ).toBe(false);
  });

  it("cleanup shape with model==='' falls through to cleanupModel (|| not ??)", () => {
    const res = selectModelAndExtras(body({ model: "" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(CLEANUP_MODEL);
    expect(res.extras).toBeDefined();
  });

  it("agent shape (agentName) -> defaultModel chain, NO thinking-off extras", () => {
    const res = selectModelAndExtras(body({ agentName: "Whispr" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(DEFAULT_MODEL);
    expect(res.extras).toBeUndefined();
  });

  it("agent shape (systemPrompt) -> defaultModel, no extras", () => {
    const res = selectModelAndExtras(body({ systemPrompt: "be a pirate" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(DEFAULT_MODEL);
    expect(res.extras).toBeUndefined();
  });

  it("explicit non-empty body.model wins (model-only -> agent branch)", () => {
    const res = selectModelAndExtras(body({ model: "gpt-4o-mini" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    // model non-empty -> NOT cleanup shape -> agent branch -> model wins.
    expect(res.model).toBe("gpt-4o-mini");
    expect(res.extras).toBeUndefined();
  });

  it("explicit non-empty body.model wins in the agent branch", () => {
    const res = selectModelAndExtras(body({ agentName: "Whispr", model: "gpt-4o-mini" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe("gpt-4o-mini");
  });

  it("agent shape falls back to DEFAULT_CHAT_MODEL when defaultModel omitted", () => {
    const res = selectModelAndExtras(body({ agentName: "Whispr" }), {
      cleanupModel: CLEANUP_MODEL,
    });
    expect(res.model).toBe("qwen3.6-plus");
  });

  it("cleanup shape falls back to DEFAULT_CHAT_MODEL when cleanupModel omitted", () => {
    const res = selectModelAndExtras(body(), { defaultModel: DEFAULT_MODEL });
    expect(res.model).toBe("qwen3.6-plus");
    expect(res.extras).toBeDefined();
  });

  it("QWEN_THINKING_OFF_EXTRAS has the documented Qwen3 chat-template shape", () => {
    expect(QWEN_THINKING_OFF_EXTRAS).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  // -------------------------------------------------------------------------
  // #18 — per-model extras bag from config (litellm-style). When deps carry
  // a modelParams map, the resolved alias's bag becomes `extras` for ALL
  // request shapes; absent → backward-compat (cleanup keeps thinking-off
  // default, agent keeps none). The bag comes ONLY from operator config,
  // never from the request body (anti-injection).
  // -------------------------------------------------------------------------
  describe("#18 — config-driven per-model extras (modelParams)", () => {
    it("cleanup shape: modelParams entry for the cleanup alias OVERRIDES the thinking-off default", () => {
      const res = selectModelAndExtras(body(), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [CLEANUP_MODEL]: { temperature: 0 } },
      });
      expect(res.model).toBe(CLEANUP_MODEL);
      // the config bag wins — NOT the hardcoded QWEN_THINKING_OFF_EXTRAS
      expect(res.extras).toEqual({ temperature: 0 });
    });

    it("cleanup shape: NO modelParams entry → backward-compat thinking-off default", () => {
      const res = selectModelAndExtras(body(), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { "some-other-model": { temperature: 0.5 } },
      });
      expect(res.model).toBe(CLEANUP_MODEL);
      expect(res.extras).toEqual(QWEN_THINKING_OFF_EXTRAS);
    });

    it("agent shape: modelParams entry for the resolved model applies extras (not just cleanup)", () => {
      const res = selectModelAndExtras(body({ agentName: "Whispr" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [DEFAULT_MODEL]: { reasoning: { enabled: false }, temperature: 0 } },
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toEqual({ reasoning: { enabled: false }, temperature: 0 });
    });

    it("agent shape: NO modelParams entry → no extras (backward-compat)", () => {
      const res = selectModelAndExtras(body({ agentName: "Whispr" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [CLEANUP_MODEL]: { temperature: 0 } },
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toBeUndefined();
    });

    it("explicit body.model: modelParams keyed on the EXPLICIT alias applies", () => {
      const res = selectModelAndExtras(body({ model: "gpt-4o-mini" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { "gpt-4o-mini": { reasoning_effort: "minimal" } },
      });
      expect(res.model).toBe("gpt-4o-mini");
      expect(res.extras).toEqual({ reasoning_effort: "minimal" });
    });

    it("empty modelParams map → identical to no map (cleanup thinking-off default)", () => {
      const res = selectModelAndExtras(body(), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: {},
      });
      expect(res.extras).toEqual(QWEN_THINKING_OFF_EXTRAS);
    });

    it("ANTI-INJECTION: extras come ONLY from config, never from request body fields", () => {
      // A malicious/confused client crams extras-like keys into the body.
      // None of them may leak into the resolved extras — only the operator
      // config bag (here: none for this alias) governs.
      const malicious = body({
        // biome-ignore lint/suspicious/noExplicitAny: deliberately smuggling unknown body keys
        ...({
          reasoning: { enabled: true },
          temperature: 1.9,
          extra_body: { chat_template_kwargs: { enable_thinking: true } },
          extras: { injected: true },
        } as any),
      });
      const res = selectModelAndExtras(malicious, {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [CLEANUP_MODEL]: { temperature: 0 } },
      });
      // Only the operator config bag — the smuggled body keys are ignored.
      expect(res.extras).toEqual({ temperature: 0 });
      const serialized = JSON.stringify(res.extras);
      expect(serialized).not.toContain("1.9");
      expect(serialized).not.toContain("injected");
      expect(serialized).not.toContain("enable_thinking");
    });
  });
});
