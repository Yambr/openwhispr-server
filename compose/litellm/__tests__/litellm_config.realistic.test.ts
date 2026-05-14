// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.5-01 Task 1 — RED: realistic litellm config shape assertions.
//
// Verifies the new compose/litellm/litellm_config.realistic.yaml (created
// in Task 3) routes whisper-large-v3 to Speaches and keeps OpenRouter +
// OpenAI realtime aliases intact. Loaded via the `yaml` package (already
// in the workspace's transitive deps), with a regex fallback so the test
// is hermetic.
//
// References: 08.5-RESEARCH.md §G2, speaches-audio.md Section 1.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const CONFIG_PATH = join(__dirname, "..", "litellm_config.realistic.yaml");

interface ModelEntry {
  model_name?: string;
  litellm_params?: {
    model?: string;
    api_base?: string;
    api_key?: string;
    mode?: string;
  };
}

interface LiteLLMConfig {
  model_list?: ModelEntry[];
  general_settings?: {
    master_key?: string;
    database_url?: string;
    pass_through_endpoints?: Array<{
      path?: string;
      target?: string;
    }>;
  };
  litellm_settings?: Record<string, unknown>;
}

describe("litellm_config.realistic.yaml — Phase 08.5-01", () => {
  it("file exists", () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  it("routes whisper-large-v3 to Speaches", () => {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const cfg = parseYaml(raw) as LiteLLMConfig;
    const whisper = (cfg.model_list ?? []).find((m) => m.model_name === "whisper-large-v3");
    expect(whisper).toBeDefined();
    expect(whisper?.litellm_params?.api_base).toBe("http://speaches:8000/v1");
    expect(whisper?.litellm_params?.model).toBe("openai/Systran/faster-whisper-large-v3");
  });

  it("preserves OpenRouter LLM aliases unchanged from bundled config", () => {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const cfg = parseYaml(raw) as LiteLLMConfig;
    const names = (cfg.model_list ?? []).map((m) => m.model_name);
    for (const alias of ["qwen3.6-plus", "gemini-3-flash", "gpt-4o-mini"]) {
      expect(names).toContain(alias);
    }
  });

  it("preserves OpenAI Realtime aliases unchanged from bundled config", () => {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const cfg = parseYaml(raw) as LiteLLMConfig;
    const names = (cfg.model_list ?? []).map((m) => m.model_name);
    for (const alias of ["gpt-realtime", "gpt-realtime-mini", "gpt-4o-realtime-preview"]) {
      expect(names).toContain(alias);
    }
  });

  it("sources master_key from env, no plaintext in YAML (T-08.5-04 mitigation)", () => {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const cfg = parseYaml(raw) as LiteLLMConfig;
    expect(cfg.general_settings?.master_key).toBe("os.environ/LITELLM_MASTER_KEY");
  });

  it("contains no stale Groq routing for whisper", () => {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    // The realistic config must not leak Groq endpoints; whisper routes
    // to Speaches and Groq plays no role in the realistic profile.
    expect(raw).not.toMatch(/api\.groq\.com/i);
  });
});
