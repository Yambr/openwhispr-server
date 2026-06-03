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
  isRequestKind,
  QWEN_THINKING_OFF_EXTRAS,
  resolveLocale,
  resolveRequestClass,
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

describe("isCleanupRequest() — cleanup-shape detection matrix (FALLBACK heuristic)", () => {
  // cleanup-routing (#36): the FALLBACK heuristic is now WEAKENED — it no
  // longer consults `agentName`. The cleanup shape is: NO systemPrompt AND
  // empty/absent model. `agentName` is ALWAYS non-empty from the client's
  // localStorage, so it is useless for cleanup-vs-reasoning and was the root
  // cause of the live regression: a cleanup dictation made WHILE an agent is
  // configured sends a (non-empty) agentName but NO systemPrompt — the old
  // `agentAbsent && ...` formula made it `false`, wrongly routing cleanup to
  // the reasoning model. The discriminator is now `systemPrompt`: a real
  // agent dictation ALWAYS forwards a non-empty systemPrompt (verified in the
  // client: audioManager agent branch sends resolvePrompt("dictationAgent")),
  // so systemAbsent reliably distinguishes cleanup from agent. `model` is kept
  // as defence-in-depth (a future client sending an explicit model without a
  // systemPrompt routes to reasoning, not cleanup).
  //
  // This heuristic is the PERMANENT fallback for clients that do NOT send the
  // explicit `requestKind` field (≤v1.7.17 desktop + all upstream clients).
  // "absent" === undefined | null for systemPrompt; for model it ALSO
  // includes "".
  const absentLike = [undefined, null] as const;
  const modelAbsentLike = [undefined, null, ""] as const;
  const presentLike = ["x"] as const;
  const modelPresentLike = ["gpt-4o-mini"] as const;

  // Exhaustive matrix: agentName {3} × systemPrompt {3} × model {4} = 36.
  for (const agentName of [...absentLike, ...presentLike]) {
    for (const systemPrompt of [...absentLike, ...presentLike]) {
      for (const model of [...modelAbsentLike, ...modelPresentLike]) {
        const systemAbsent = systemPrompt === undefined || systemPrompt === null;
        const modelAbsent = model === undefined || model === null || model === "";
        // WEAKENED contract: agentName is NOT consulted.
        const expected = systemAbsent && modelAbsent;
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

  // Hand-written NON-PARAMETRIC pins. The matrix above recomputes `expected`
  // from the same formula as the implementation (a self-consistent mirror —
  // a weak oracle that would pass for ANY matching formula). These literal
  // assertions pin the INTENDED contract independently.
  it("PIN: cleanup-while-agent-configured (agentName set, NO systemPrompt, NO model) -> TRUE (the Nick regression fix)", () => {
    expect(isCleanupRequest(body({ agentName: "Whispr" }))).toBe(true);
  });
  it("PIN: agent dictation (non-empty systemPrompt) -> FALSE (stays reasoning)", () => {
    expect(isCleanupRequest(body({ agentName: "Whispr", systemPrompt: "You are Whispr." }))).toBe(
      false,
    );
  });
  it("PIN: explicit model without systemPrompt -> FALSE (defence-in-depth, reasoning)", () => {
    expect(isCleanupRequest(body({ agentName: "Whispr", model: "gpt-4o-mini" }))).toBe(false);
  });
  it("PIN: pure cleanup (nothing set) -> TRUE", () => {
    expect(isCleanupRequest(body())).toBe(true);
  });
});

describe("isRequestKind() — runtime narrowing of the requestKind literal", () => {
  it("is true for each of the 4 known literals", () => {
    for (const k of ["cleanup", "agent", "summary", "title"]) {
      expect(isRequestKind(k)).toBe(true);
    }
  });
  it("is false for an unknown string, empty string, null, undefined, number, object", () => {
    for (const v of ["chatbot", "", null, undefined, 7, {}]) {
      expect(isRequestKind(v)).toBe(false);
    }
  });
});

describe("resolveRequestClass() — PRIMARY router (requestKind → class)", () => {
  function withKind(requestKind: unknown): ReasonRequest {
    return body({ ...({ requestKind } as Partial<ReasonRequest>) });
  }
  it("'cleanup' -> 'cleanup'", () => {
    expect(resolveRequestClass(withKind("cleanup"))).toBe("cleanup");
  });
  it("'agent' -> 'reasoning'", () => {
    expect(resolveRequestClass(withKind("agent"))).toBe("reasoning");
  });
  it("'summary' -> 'reasoning'", () => {
    expect(resolveRequestClass(withKind("summary"))).toBe("reasoning");
  });
  it("'title' -> 'reasoning'", () => {
    expect(resolveRequestClass(withKind("title"))).toBe("reasoning");
  });
  it("garbage string -> undefined (fall back to heuristic)", () => {
    expect(resolveRequestClass(withKind("chatbot"))).toBeUndefined();
  });
  it("null -> undefined", () => {
    expect(resolveRequestClass(withKind(null))).toBeUndefined();
  });
  it("absent -> undefined", () => {
    expect(resolveRequestClass(body())).toBeUndefined();
  });
  it("IGNORES body shape: requestKind 'cleanup' wins over a fully agent-shaped body", () => {
    expect(
      resolveRequestClass(
        body({
          ...({ requestKind: "cleanup" } as Partial<ReasonRequest>),
          agentName: "Whispr",
          systemPrompt: "be a pirate",
          model: "gpt-4o-mini",
        }),
      ),
    ).toBe("cleanup");
  });
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

  it("customPrompt does NOT override the agent shape (systemPrompt-carrying agent stays its own system message)", () => {
    // cleanup-routing (#36): a REAL agent dictation carries a non-empty
    // systemPrompt (the discriminator). customPrompt is a cleanup-only
    // override and must not displace the agent's systemPrompt.
    const msgs = selectMessages(
      body({
        agentName: "Whispr",
        systemPrompt: "You are Whispr.",
        customPrompt: "some override",
        text: "do it",
      }),
      "en",
    );
    expect(msgs).toEqual([
      { role: "system", content: "You are Whispr." },
      { role: "user", content: "do it" },
    ]);
  });

  it("agent shape with systemPrompt -> [system(systemPrompt), user]", () => {
    const msgs = selectMessages(body({ systemPrompt: "You are a pirate.", text: "ahoy" }), "en");
    expect(msgs).toEqual([
      { role: "system", content: "You are a pirate." },
      { role: "user", content: "ahoy" },
    ]);
  });

  it("cleanup-while-agent-configured (agentName set, NO systemPrompt) -> cleanup persona (Nick regression fix)", () => {
    // cleanup-routing (#36): the OLD contract returned [user] only here
    // (treating bare agentName as agent). That was the bug — a cleanup
    // dictation made while an agent is configured. It now gets the cleanup
    // persona, like any other cleanup request.
    const msgs = selectMessages(body({ agentName: "Whispr", text: "uh do the thing" }), "en");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
    expect(msgs[1]).toEqual({ role: "user", content: "uh do the thing" });
  });
});

describe("selectMessages() — requestKind PRIMARY routing (cleanup-routing #36)", () => {
  /** Build a body with an explicit requestKind plus optional overrides. */
  function kindBody(requestKind: string, overrides: Partial<ReasonRequest> = {}): ReasonRequest {
    return body({ ...({ requestKind } as Partial<ReasonRequest>), ...overrides });
  }

  it("requestKind 'cleanup' with a stray systemPrompt -> cleanup persona (systemPrompt IGNORED)", () => {
    const msgs = selectMessages(
      kindBody("cleanup", { systemPrompt: "be a pirate", text: "uh one two" }),
      "en",
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
    expect(msgs[0]?.content).not.toBe("be a pirate");
    expect(msgs[1]).toEqual({ role: "user", content: "uh one two" });
  });

  it("requestKind 'cleanup' with stray agentName + model -> cleanup persona", () => {
    const msgs = selectMessages(
      kindBody("cleanup", { agentName: "X", model: "gpt-4o-mini", text: "uh one two" }),
      "en",
    );
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("requestKind 'cleanup' honours customPrompt tier-1 verbatim", () => {
    const msgs = selectMessages(kindBody("cleanup", { customPrompt: "STRIP.", text: "t" }), "en");
    expect(msgs[0]).toEqual({ role: "system", content: "STRIP." });
  });

  it("requestKind 'agent' with NO systemPrompt -> [user] only, NOT cleanup persona", () => {
    // The headline routing case: by shape alone (nothing set) the FALLBACK
    // heuristic would say cleanup, but the explicit requestKind forces
    // reasoning → no cleanup system message.
    const msgs = selectMessages(kindBody("agent", { text: "do it" }), "en");
    expect(msgs).toEqual([{ role: "user", content: "do it" }]);
  });

  it("requestKind 'agent' WITH systemPrompt -> [system(systemPrompt), user]", () => {
    const msgs = selectMessages(kindBody("agent", { systemPrompt: "P", text: "t" }), "en");
    expect(msgs).toEqual([
      { role: "system", content: "P" },
      { role: "user", content: "t" },
    ]);
  });

  it("requestKind 'summary' with no systemPrompt -> [user] only (reasoning)", () => {
    expect(selectMessages(kindBody("summary", { text: "t" }), "en")).toEqual([
      { role: "user", content: "t" },
    ]);
  });

  it("requestKind 'title' with no systemPrompt -> [user] only (reasoning)", () => {
    expect(selectMessages(kindBody("title", { text: "t" }), "en")).toEqual([
      { role: "user", content: "t" },
    ]);
  });

  it("garbage requestKind -> FALLBACK heuristic (cleanup shape -> cleanup persona)", () => {
    const msgs = selectMessages(kindBody("chatbot", { text: "t" }), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
  });

  it("garbage requestKind + agentName-only -> FALLBACK -> cleanup persona (weakened heuristic)", () => {
    // With the weakened fallback, agentName-only-without-systemPrompt is now
    // a cleanup shape — so a garbage requestKind on that body still cleanups.
    const msgs = selectMessages(kindBody("chatbot", { agentName: "Whispr", text: "x" }), "en");
    expect(msgs[0]?.content).toBe(EN_CLEANUP_PROMPT);
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

  it("agent shape (systemPrompt-carrying) -> defaultModel chain, NO thinking-off extras", () => {
    // cleanup-routing (#36): a genuine agent dictation is identified by its
    // non-empty systemPrompt (bare agentName is now cleanup-while-agent-set).
    const res = selectModelAndExtras(body({ agentName: "Whispr", systemPrompt: "be Whispr" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(DEFAULT_MODEL);
    expect(res.extras).toBeUndefined();
  });

  it("cleanup-while-agent-configured (agentName, NO systemPrompt) -> cleanupModel + thinking-off (Nick regression fix)", () => {
    // The OLD contract returned defaultModel/no-extras here; that was the bug
    // (cleanup wrongly routed to the reasoning model WITH thinking on).
    const res = selectModelAndExtras(body({ agentName: "Whispr" }), {
      cleanupModel: CLEANUP_MODEL,
      defaultModel: DEFAULT_MODEL,
    });
    expect(res.model).toBe(CLEANUP_MODEL);
    expect(
      (res.extras as { extra_body?: { chat_template_kwargs?: { enable_thinking?: boolean } } })
        .extra_body?.chat_template_kwargs?.enable_thinking,
    ).toBe(false);
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
    // cleanup-routing (#36): carry a systemPrompt so this stays a genuine
    // agent-shape test under the weakened fallback heuristic.
    const res = selectModelAndExtras(body({ agentName: "Whispr", systemPrompt: "be Whispr" }), {
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
      // cleanup-routing (#36): systemPrompt makes this a genuine agent shape.
      const res = selectModelAndExtras(body({ agentName: "Whispr", systemPrompt: "be Whispr" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [DEFAULT_MODEL]: { reasoning: { enabled: false }, temperature: 0 } },
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toEqual({ reasoning: { enabled: false }, temperature: 0 });
    });

    it("agent shape: NO modelParams entry → no extras (backward-compat)", () => {
      const res = selectModelAndExtras(body({ agentName: "Whispr", systemPrompt: "be Whispr" }), {
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

  // -------------------------------------------------------------------------
  // cleanup-routing (#36) — requestKind PRIMARY routing for model + extras.
  // -------------------------------------------------------------------------
  describe("requestKind PRIMARY routing", () => {
    function kindBody(requestKind: string, overrides: Partial<ReasonRequest> = {}): ReasonRequest {
      return body({ ...({ requestKind } as Partial<ReasonRequest>), ...overrides });
    }
    const thinkingOff = (extras: unknown) =>
      (extras as { extra_body?: { chat_template_kwargs?: { enable_thinking?: boolean } } })
        .extra_body?.chat_template_kwargs?.enable_thinking;

    it("requestKind 'cleanup' -> cleanupModel + thinking-off, IGNORING agent-shaped body", () => {
      const res = selectModelAndExtras(
        kindBody("cleanup", { agentName: "X", systemPrompt: "Y", model: "" }),
        { cleanupModel: CLEANUP_MODEL, defaultModel: DEFAULT_MODEL },
      );
      expect(res.model).toBe(CLEANUP_MODEL);
      expect(thinkingOff(res.extras)).toBe(false);
    });

    it("requestKind 'cleanup' with explicit non-empty body.model -> that model wins, still thinking-off", () => {
      const res = selectModelAndExtras(kindBody("cleanup", { model: "gpt-4o-mini" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe("gpt-4o-mini");
      expect(thinkingOff(res.extras)).toBe(false);
    });

    it("requestKind 'cleanup' with model:'' falls through to cleanupModel (|| not ??)", () => {
      const res = selectModelAndExtras(kindBody("cleanup", { model: "" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(CLEANUP_MODEL);
    });

    it("requestKind 'agent' with NO systemPrompt -> defaultModel, NO thinking-off (NOT cleanup)", () => {
      // Headline routing case: a bare body that the heuristic would call
      // cleanup, but requestKind forces the reasoning model with no extras.
      const res = selectModelAndExtras(kindBody("agent"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toBeUndefined();
    });

    it("requestKind 'summary' -> defaultModel, no extras", () => {
      const res = selectModelAndExtras(kindBody("summary"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toBeUndefined();
    });

    it("requestKind 'title' -> defaultModel, no extras", () => {
      const res = selectModelAndExtras(kindBody("title"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toBeUndefined();
    });

    it("requestKind 'agent' with explicit body.model -> that model wins (??)", () => {
      const res = selectModelAndExtras(kindBody("agent", { model: "gpt-4o-mini" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe("gpt-4o-mini");
    });

    it("requestKind 'cleanup': modelParams entry OVERRIDES thinking-off default", () => {
      const res = selectModelAndExtras(kindBody("cleanup"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [CLEANUP_MODEL]: { temperature: 0 } },
      });
      expect(res.extras).toEqual({ temperature: 0 });
    });

    it("requestKind 'agent': modelParams entry on the resolved alias applies extras", () => {
      const res = selectModelAndExtras(kindBody("agent"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [DEFAULT_MODEL]: { temperature: 0 } },
      });
      expect(res.extras).toEqual({ temperature: 0 });
    });

    it("garbage requestKind -> FALLBACK -> cleanup shape gets cleanupModel + thinking-off", () => {
      const res = selectModelAndExtras(kindBody("chatbot"), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(CLEANUP_MODEL);
      expect(thinkingOff(res.extras)).toBe(false);
    });

    it("garbage requestKind + systemPrompt -> FALLBACK -> reasoning, no extras", () => {
      const res = selectModelAndExtras(kindBody("chatbot", { systemPrompt: "be Whispr" }), {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
      });
      expect(res.model).toBe(DEFAULT_MODEL);
      expect(res.extras).toBeUndefined();
    });

    it("ANTI-INJECTION: a spoofed requestKind cannot inject extras — extras come ONLY from operator modelParams", () => {
      const malicious = kindBody("agent", {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately smuggling unknown body keys
        ...({
          extra_body: { chat_template_kwargs: { enable_thinking: true } },
          temperature: 1.9,
          reasoning: { injected: true },
          extras: { injected: true },
        } as any),
      });
      const res = selectModelAndExtras(malicious, {
        cleanupModel: CLEANUP_MODEL,
        defaultModel: DEFAULT_MODEL,
        modelParams: { [DEFAULT_MODEL]: { temperature: 0 } },
      });
      expect(res.extras).toEqual({ temperature: 0 });
      const serialized = JSON.stringify(res.extras);
      expect(serialized).not.toContain("1.9");
      expect(serialized).not.toContain("injected");
      expect(serialized).not.toContain("enable_thinking");
    });
  });
});
