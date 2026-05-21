// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — config loader tests.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_LITELLM_BASE_URL,
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
    expect(cfg.providerKeys.pyannote).toBeUndefined();
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
      PYANNOTE_API_KEY: "hf-1",
    });
    expect(cfg.providerKeys.openrouter).toBe("sk-or-1");
    expect(cfg.providerKeys.groq).toBe("gsk-1");
    expect(cfg.providerKeys.pyannote).toBe("hf-1");
  });

  it("treats empty-string provider keys as undefined", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      OPENROUTER_API_KEY: "",
      GROQ_API_KEY: "",
      PYANNOTE_API_KEY: "",
    });
    expect(cfg.providerKeys.openrouter).toBeUndefined();
    expect(cfg.providerKeys.groq).toBeUndefined();
    expect(cfg.providerKeys.pyannote).toBeUndefined();
  });

  it("honors LITELLM_DEFAULT_CHAT_MODEL override (D-06)", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_DEFAULT_CHAT_MODEL: "gemini-3-flash",
    });
    expect(cfg.defaultChatModel).toBe("gemini-3-flash");
  });

  it("falls back to default base URL when LITELLM_BASE_URL is empty string", () => {
    const cfg = loadLitellmConfigFromEnv({
      LITELLM_MASTER_KEY: "sk-master-x",
      LITELLM_BASE_URL: "",
    });
    expect(cfg.baseUrl).toBe(DEFAULT_LITELLM_BASE_URL);
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
});
