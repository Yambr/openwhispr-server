// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — config loader tests.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLEANUP_MODEL,
  DEFAULT_LITELLM_BASE_URL,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_STT_MODEL,
  loadLitellmConfigFromEnv,
} from "../../src/config.js";

describe("loadLitellmConfigFromEnv", () => {
  it("returns defaults when only LITELLM_MASTER_KEY is set", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.baseUrl).toBe(DEFAULT_LITELLM_BASE_URL);
    expect(cfg.baseUrl).toBe("http://litellm:4000");
    expect(cfg.masterKey).toBe("sk-master-x");
    expect(cfg.defaultChatModel).toBe(DEFAULT_CHAT_MODEL);
    expect(cfg.providerKeys.openrouter).toBeUndefined();
    expect(cfg.providerKeys.groq).toBeUndefined();
  });

  it("honors operator override of LITELLM_BASE_URL (PROVIDER-01 / LITELLM-05)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "https://litellm.corp.example.com",
    });
    expect(cfg.baseUrl).toBe("https://litellm.corp.example.com");
  });

  it("throws when LITELLM_MASTER_KEY is missing", () => {
    expect(() => loadLitellmConfigFromEnv({})).toThrow(/LITELLM_MASTER_KEY is required/);
  });

  it("throws when LITELLM_MASTER_KEY is empty string", () => {
    expect(() => loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "" })).toThrow(
      /LITELLM_MASTER_KEY is required/,
    );
  });

  it("returns provider keys when present (used for 503-envelope routing)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      OPENROUTER_API_KEY: "sk-or-1",
      GROQ_API_KEY: "gsk-1",
    });
    expect(cfg.providerKeys.openrouter).toBe("sk-or-1");
    expect(cfg.providerKeys.groq).toBe("gsk-1");
  });

  it("treats empty-string provider keys as undefined", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      OPENROUTER_API_KEY: "",
      GROQ_API_KEY: "",
    });
    expect(cfg.providerKeys.openrouter).toBeUndefined();
    expect(cfg.providerKeys.groq).toBeUndefined();
  });

  it("honors LITELLM_DEFAULT_CHAT_MODEL override (D-06)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_DEFAULT_CHAT_MODEL: "gemini-3-flash",
    });
    expect(cfg.defaultChatModel).toBe("gemini-3-flash");
  });

  // -------------------------------------------------------------------------
  // REASONING_MODEL_PARAMS — per-model chat-param extras bag (#18).
  //
  // litellm-style: a JSON map alias → arbitrary extras bag that the server
  // spreads verbatim into the upstream chat-completion body (the same way
  // litellm forwards litellm_params). Operator puts provider-specific
  // syntax in the env BY HAND; the server does not translate intent.
  // Unset/empty → {} (back-compat). Malformed → throw (boot EX_CONFIG 78).
  // -------------------------------------------------------------------------
  describe("REASONING_MODEL_PARAMS — per-model extras bag", () => {
    it("defaults modelParams to {} when REASONING_MODEL_PARAMS is unset", () => {
      const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
      expect(cfg.modelParams).toEqual({});
    });

    it("defaults modelParams to {} when REASONING_MODEL_PARAMS is empty string", () => {
      const cfg = loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        REASONING_MODEL_PARAMS: "",
      });
      expect(cfg.modelParams).toEqual({});
    });

    it("parses a valid JSON map of alias → extras bag", () => {
      const cfg = loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        REASONING_MODEL_PARAMS: JSON.stringify({
          "qwen3.6-cleanup": { temperature: 0 },
          "some-reasoner": { reasoning: { enabled: false }, temperature: 0 },
        }),
      });
      expect(cfg.modelParams).toEqual({
        "qwen3.6-cleanup": { temperature: 0 },
        "some-reasoner": { reasoning: { enabled: false }, temperature: 0 },
      });
    });

    it("throws (EX_CONFIG path) on malformed JSON", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: "{not valid json",
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when top-level JSON is not an object (array)", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: JSON.stringify([{ temperature: 0 }]),
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when top-level JSON is not an object (string)", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: JSON.stringify("temperature=0"),
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when top-level JSON is null", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: "null",
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when a per-alias value is not a plain object", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: JSON.stringify({ "qwen3.6-cleanup": "temperature=0" }),
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when a per-alias value is an array", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: JSON.stringify({ "qwen3.6-cleanup": [0] }),
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("throws when a per-alias value is null", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          REASONING_MODEL_PARAMS: JSON.stringify({ "qwen3.6-cleanup": null }),
        }),
      ).toThrow(/REASONING_MODEL_PARAMS/);
    });

    it("accepts an empty object value for an alias (no-op bag)", () => {
      const cfg = loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        REASONING_MODEL_PARAMS: JSON.stringify({ "qwen3.6-cleanup": {} }),
      });
      expect(cfg.modelParams).toEqual({ "qwen3.6-cleanup": {} });
    });
  });

  // D2/D6 — STT model alias is operator-owned via LITELLM_STT_MODEL; the
  // route no longer bakes `whisper-large-v3` as a TypeScript literal.
  it("defaults defaultSttModel to DEFAULT_STT_MODEL when unset (D6)", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.defaultSttModel).toBe(DEFAULT_STT_MODEL);
    expect(cfg.defaultSttModel).toBe("whisper-large-v3");
  });

  it("honors LITELLM_STT_MODEL override (D2)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_STT_MODEL: "corp-whisper-internal",
    });
    expect(cfg.defaultSttModel).toBe("corp-whisper-internal");
  });

  it("treats an empty LITELLM_STT_MODEL as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_STT_MODEL: "",
    });
    expect(cfg.defaultSttModel).toBe(DEFAULT_STT_MODEL);
  });

  // D4/D1 — realtime model alias is operator-owned via LITELLM_REALTIME_MODEL.
  it("defaults defaultRealtimeModel to DEFAULT_REALTIME_MODEL when unset (D4)", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.defaultRealtimeModel).toBe(DEFAULT_REALTIME_MODEL);
    expect(cfg.defaultRealtimeModel).toBe("gpt-realtime");
  });

  it("honors LITELLM_REALTIME_MODEL override (D4)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_REALTIME_MODEL: "corp-realtime-internal",
    });
    expect(cfg.defaultRealtimeModel).toBe("corp-realtime-internal");
  });

  it("treats an empty LITELLM_REALTIME_MODEL as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_REALTIME_MODEL: "",
    });
    expect(cfg.defaultRealtimeModel).toBe(DEFAULT_REALTIME_MODEL);
  });

  // R33 — cleanup-class alias is operator-owned via REASONING_CLEANUP_MODEL.
  it("defaults defaultCleanupModel to DEFAULT_CLEANUP_MODEL when unset (R33)", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.defaultCleanupModel).toBe(DEFAULT_CLEANUP_MODEL);
    expect(cfg.defaultCleanupModel).toBe("qwen3.6-cleanup");
  });

  it("honors REASONING_CLEANUP_MODEL override (R33)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      REASONING_CLEANUP_MODEL: "corp-cleanup-internal",
    });
    expect(cfg.defaultCleanupModel).toBe("corp-cleanup-internal");
  });

  it("treats an empty REASONING_CLEANUP_MODEL as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      REASONING_CLEANUP_MODEL: "",
    });
    expect(cfg.defaultCleanupModel).toBe(DEFAULT_CLEANUP_MODEL);
  });

  // U65 — embeddings model alias is operator-owned via LITELLM_EMBEDDING_MODEL.
  // Unlike the STT/realtime/cleanup aliases there is NO literal default: when
  // unset the field is absent (undefined) so the route returns a clean 503 and
  // the capability flag is false. Generic placeholder alias only.
  it("carries defaultEmbeddingModel when LITELLM_EMBEDDING_MODEL is set (U65)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_EMBEDDING_MODEL: "op-embed-alias",
    });
    expect(cfg.defaultEmbeddingModel).toBe("op-embed-alias");
  });

  it("leaves defaultEmbeddingModel undefined when LITELLM_EMBEDDING_MODEL is unset (U65, no default)", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.defaultEmbeddingModel).toBeUndefined();
  });

  it("treats an empty LITELLM_EMBEDDING_MODEL as unset (undefined) (U65)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_EMBEDDING_MODEL: "",
    });
    expect(cfg.defaultEmbeddingModel).toBeUndefined();
  });

  // U65 — rerank model alias is operator-owned via LITELLM_RERANK_MODEL; same
  // no-literal-default seam as embeddings.
  it("carries defaultRerankModel when LITELLM_RERANK_MODEL is set (U65)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_RERANK_MODEL: "op-rerank-alias",
    });
    expect(cfg.defaultRerankModel).toBe("op-rerank-alias");
  });

  it("leaves defaultRerankModel undefined when LITELLM_RERANK_MODEL is unset (U65, no default)", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.defaultRerankModel).toBeUndefined();
  });

  it("treats an empty LITELLM_RERANK_MODEL as unset (undefined) (U65)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_RERANK_MODEL: "",
    });
    expect(cfg.defaultRerankModel).toBeUndefined();
  });

  it("falls back to default base URL when LITELLM_BASE_URL is empty string", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "",
    });
    expect(cfg.baseUrl).toBe(DEFAULT_LITELLM_BASE_URL);
  });

  // R32 — timeout env-overrides. The undici headers/body timeouts and the
  // non-2xx error-drain bound were hardcoded literals in index.ts. The
  // config loader is the canonical env boundary; it now surfaces them as
  // `headersTimeoutMs` / `bodyTimeoutMs` / `errorDrainTimeoutMs` so an
  // operator can retarget the timeout posture without a code change.
  it("R32: defaults timeouts to the prior literals when unset", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.headersTimeoutMs).toBe(30_000);
    expect(cfg.bodyTimeoutMs).toBe(120_000);
    expect(cfg.errorDrainTimeoutMs).toBe(15_000);
  });

  it("R32: honors LITELLM_HEADERS_TIMEOUT_MS override", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_HEADERS_TIMEOUT_MS: "45000",
    });
    expect(cfg.headersTimeoutMs).toBe(45_000);
  });

  it("R32: honors LITELLM_BODY_TIMEOUT_MS override", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BODY_TIMEOUT_MS: "300000",
    });
    expect(cfg.bodyTimeoutMs).toBe(300_000);
  });

  it("R32: honors LITELLM_ERROR_DRAIN_TIMEOUT_MS override", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_ERROR_DRAIN_TIMEOUT_MS: "5000",
    });
    expect(cfg.errorDrainTimeoutMs).toBe(5_000);
  });

  it("R32: treats an empty timeout env var as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_HEADERS_TIMEOUT_MS: "",
      LITELLM_BODY_TIMEOUT_MS: "",
      LITELLM_ERROR_DRAIN_TIMEOUT_MS: "",
    });
    expect(cfg.headersTimeoutMs).toBe(30_000);
    expect(cfg.bodyTimeoutMs).toBe(120_000);
    expect(cfg.errorDrainTimeoutMs).toBe(15_000);
  });

  it("R32: treats a non-integer timeout env var as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_HEADERS_TIMEOUT_MS: "not-a-number",
      LITELLM_BODY_TIMEOUT_MS: "12.5",
      LITELLM_ERROR_DRAIN_TIMEOUT_MS: "-1",
    });
    expect(cfg.headersTimeoutMs).toBe(30_000);
    expect(cfg.bodyTimeoutMs).toBe(120_000);
    expect(cfg.errorDrainTimeoutMs).toBe(15_000);
  });

  it("R32: tolerates surrounding whitespace in a timeout env var", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_HEADERS_TIMEOUT_MS: "  60000  ",
    });
    expect(cfg.headersTimeoutMs).toBe(60_000);
  });

  it("R32: treats a zero timeout env var as unset (falls back to default)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BODY_TIMEOUT_MS: "0",
    });
    expect(cfg.bodyTimeoutMs).toBe(120_000);
  });

  it("defaults env to process.env when no argument supplied", () => {
    // Smoke-call the no-arg path so the default-parameter branch is
    // covered. process.env in the vitest runner has no LITELLM_MASTER_KEY
    // by default, so this should throw.
    const prev = process.env.LITELLM_MASTER_KEY;
    delete process.env.LITELLM_MASTER_KEY;
    try {
      expect(() => loadLitellmConfigFromEnv()).toThrow(/LITELLM_MASTER_KEY is required/);
    } finally {
      if (prev !== undefined) process.env.LITELLM_MASTER_KEY = prev;
    }
  });
});

// Phase 68 / Plan 68-01 — REVIEW litellm-client HIGH HI-2.
// CLAUDE.md's corporate-override narrative names `LITELLM_VIRTUAL_KEY` as
// the credential operators set when pointing at their internal LiteLLM —
// but the loader never read it. HI-2 wires it with precedence over
// `LITELLM_MASTER_KEY`.
describe("HI-2 — LITELLM_VIRTUAL_KEY precedence", () => {
  it("HI-2: LITELLM_VIRTUAL_KEY wins over LITELLM_MASTER_KEY when both set", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_VIRTUAL_KEY: "sk-virtual-corp",
    });
    expect(cfg.masterKey).toBe("sk-virtual-corp");
  });

  it("HI-2: falls back to LITELLM_MASTER_KEY when LITELLM_VIRTUAL_KEY is unset", () => {
    const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
    expect(cfg.masterKey).toBe("sk-master-x");
  });

  it("HI-2: an empty LITELLM_VIRTUAL_KEY does not shadow LITELLM_MASTER_KEY", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_VIRTUAL_KEY: "",
    });
    expect(cfg.masterKey).toBe("sk-master-x");
  });
});

// Phase 68 / Plan 68-01 — REVIEW litellm-client HIGH HI-3.
// A non-https operator-overridden LITELLM_BASE_URL ships the upstream
// Authorization credential over plaintext HTTP. HI-3 refuses it in
// production unless an explicit LITELLM_ALLOW_PLAINTEXT opt-out is set or
// the host is the bundled `litellm` compose service.
describe("HI-3 — https assertion on production base-URL override", () => {
  it("HI-3: production + http override throws", () => {
    expect(() =>
      loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        LITELLM_BASE_URL: "http://aimodels.example.com",
        NODE_ENV: "production",
      }),
    ).toThrow(/https/i);
  });

  it("HI-3: production + http override + LITELLM_ALLOW_PLAINTEXT=1 does not throw", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "http://aimodels.example.com",
      NODE_ENV: "production",
      LITELLM_ALLOW_PLAINTEXT: "1",
    });
    expect(cfg.baseUrl).toBe("http://aimodels.example.com");
  });

  it("HI-3: production + https override does not throw", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "https://aimodels.example.com",
      NODE_ENV: "production",
    });
    expect(cfg.baseUrl).toBe("https://aimodels.example.com");
  });

  it("HI-3: production + bundled http://litellm:4000 default does not throw", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      NODE_ENV: "production",
    });
    expect(cfg.baseUrl).toBe(DEFAULT_LITELLM_BASE_URL);
  });

  it("HI-3: production + explicit override to the bundled litellm host does not throw", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "http://litellm:4000",
      NODE_ENV: "production",
    });
    expect(cfg.baseUrl).toBe("http://litellm:4000");
  });

  it("HI-3: non-production + http override does not throw (slim/dev stack)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "http://aimodels.example.com",
      NODE_ENV: "development",
    });
    expect(cfg.baseUrl).toBe("http://aimodels.example.com");
  });

  // -------------------------------------------------------------------------
  // Upstream #4 — LITELLM_USER_HEADER_NAME (configurable end-user email
  // header). Opt-in: when set, every gateway call emits that header carrying
  // the authenticated user's email (or fallback id). When unset the header is
  // OMITTED entirely (no literal default ships — LOCKER-03). The header NAME
  // is operator-controlled, so a CR/LF or colon in it is REFUSED at load
  // (T-oc4-01) — an operator typo cannot inject a second header / split the
  // request.
  // -------------------------------------------------------------------------
  describe("LITELLM_USER_HEADER_NAME — configurable end-user email header", () => {
    it("defaults userHeaderName to undefined when unset (opt-in)", () => {
      const cfg = loadLitellmConfigFromEnv({ LITELLM_MASTER_KEY: "sk-master-x" });
      expect(cfg.userHeaderName).toBeUndefined();
    });

    it("treats an empty LITELLM_USER_HEADER_NAME as unset (same seam as model envs)", () => {
      const cfg = loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        LITELLM_USER_HEADER_NAME: "",
      });
      expect(cfg.userHeaderName).toBeUndefined();
    });

    it("loads a valid header token from LITELLM_USER_HEADER_NAME", () => {
      const cfg = loadLitellmConfigFromEnv({
        LITELLM_MASTER_KEY: "sk-master-x",
        LITELLM_USER_HEADER_NAME: "X-OpenWhispr-User-Email",
      });
      expect(cfg.userHeaderName).toBe("X-OpenWhispr-User-Email");
    });

    it("refuses to load a header name containing CR/LF (T-oc4-01)", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          LITELLM_USER_HEADER_NAME: "X-Email\r\nX-Injected",
        }),
      ).toThrow(/LITELLM_USER_HEADER_NAME/);
    });

    it("refuses to load a header name containing a colon (T-oc4-01)", () => {
      expect(() =>
        loadLitellmConfigFromEnv({
          LITELLM_MASTER_KEY: "sk-master-x",
          LITELLM_USER_HEADER_NAME: "X-Email: value",
        }),
      ).toThrow(/LITELLM_USER_HEADER_NAME/);
    });
  });
});
