// SPDX-License-Identifier: Apache-2.0
// Phase 3 / Plan 02 / Task 1 — guard the contract-test LiteLLM config.
//
// CRITICAL CORRECTNESS: every chat/audio model in litellm_config.contract.yaml
// MUST carry `mock_response`. Without it, contract-test runs would pass
// real chat-completions / transcription requests through to provider
// APIs — defeating hermetic CI and burning real keys (or 401-failing
// the suite). Realtime entries (mode: realtime) are exempt: LiteLLM's
// WSS upgrade short-circuits before mock_response is consulted.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface LitellmModel {
  model_name: string;
  litellm_params: {
    model: string;
    api_key: string;
    mock_response?: string;
    mode?: string;
  };
}

interface LitellmConfig {
  model_list: LitellmModel[];
  general_settings: Record<string, unknown>;
  litellm_settings: Record<string, unknown>;
}

const repoRoot = process.cwd();
const configPath = join(
  repoRoot,
  "compose/litellm/litellm_config.contract.yaml",
);

describe("compose/litellm/litellm_config.contract.yaml", () => {
  const raw = readFileSync(configPath, "utf8");
  const cfg = parse(raw) as LitellmConfig;

  it("parses as valid YAML with model_list", () => {
    expect(Array.isArray(cfg.model_list)).toBe(true);
    expect(cfg.model_list.length).toBeGreaterThan(0);
  });

  it("every non-realtime model carries mock_response (hermetic CI guard)", () => {
    for (const m of cfg.model_list) {
      if (m.litellm_params.mode === "realtime") continue;
      expect(
        m.litellm_params.mock_response,
        `model ${m.model_name} is missing mock_response — contract-test would hit real provider`,
      ).toBeTruthy();
    }
  });

  it("uses fake-key-for-mock api_key on every model (no real keys committed)", () => {
    for (const m of cfg.model_list) {
      expect(m.litellm_params.api_key).toBe("fake-key-for-mock");
    }
  });

  it("includes the four chat/audio models the API depends on", () => {
    const names = cfg.model_list.map((m) => m.model_name);
    expect(names).toContain("qwen3.6-plus");
    expect(names).toContain("gemini-3-flash");
    expect(names).toContain("gpt-4o-mini");
    expect(names).toContain("whisper-large-v3");
  });

  it("declares D-12 realtime entries with mode: realtime (parity with default config)", () => {
    const realtime = cfg.model_list.filter(
      (m) => m.litellm_params.mode === "realtime",
    );
    expect(realtime.length).toBeGreaterThanOrEqual(3);
    const names = realtime.map((m) => m.model_name);
    expect(names).toContain("gpt-realtime");
    expect(names).toContain("gpt-realtime-mini");
    expect(names).toContain("gpt-4o-realtime-preview");
  });

  it("references LITELLM_MASTER_KEY and LITELLM_DATABASE_URL from env (no inline secrets)", () => {
    expect(cfg.general_settings.master_key).toBe("os.environ/LITELLM_MASTER_KEY");
    expect(cfg.general_settings.database_url).toBe(
      "os.environ/LITELLM_DATABASE_URL",
    );
  });
});
