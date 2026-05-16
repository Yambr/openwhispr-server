// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.b / HI-01 — model alias loader reads compose/litellm/litellm_config.yaml.
//
// The loader is the SINGLE source of truth for "what model_name aliases does
// the bundled LiteLLM proxy expose". Production code MUST NOT hardcode
// alias strings that could drift from the yaml. The loader is also
// consumed by Phase 41.f for the same reason.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDefaultAgentModel,
  loadBundledModelProviders,
  loadLitellmModelAliases,
} from "../../src/model-aliases.js";

let tmpDir: string;
let yamlPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "owrl-yaml-"));
  yamlPath = join(tmpDir, "litellm_config.yaml");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadLitellmModelAliases", () => {
  it("returns the ordered model_name set from model_list", () => {
    writeFileSync(
      yamlPath,
      `
model_list:
  - model_name: alpha-model
    litellm_params:
      model: openrouter/foo/alpha
  - model_name: beta-model
    litellm_params:
      model: openrouter/foo/beta
`,
      "utf8",
    );
    const aliases = loadLitellmModelAliases(yamlPath);
    expect(aliases).toEqual(["alpha-model", "beta-model"]);
  });

  it("throws when model_list is missing or empty", () => {
    writeFileSync(yamlPath, "general_settings:\n  master_key: x\n", "utf8");
    expect(() => loadLitellmModelAliases(yamlPath)).toThrow(/model_list/);
  });

  it("throws when an entry lacks a model_name field", () => {
    writeFileSync(yamlPath, "model_list:\n  - litellm_params:\n      model: foo/bar\n", "utf8");
    expect(() => loadLitellmModelAliases(yamlPath)).toThrow(/model_name/);
  });

  it("ignores leading-/trailing-whitespace in model_name", () => {
    writeFileSync(
      yamlPath,
      `model_list:\n  - model_name: '  ws-model  '\n    litellm_params:\n      model: openrouter/foo/ws\n`,
      "utf8",
    );
    expect(loadLitellmModelAliases(yamlPath)).toEqual(["ws-model"]);
  });

  it("defaults to repository compose/litellm/litellm_config.yaml when no path given", () => {
    // Smoke: reads real file. Asserts the production yaml contains
    // qwen3.6-plus (current bundled default).
    const aliases = loadLitellmModelAliases();
    expect(aliases).toContain("qwen3.6-plus");
    expect(aliases).toContain("whisper-large-v3");
  });
});

describe("getDefaultAgentModel", () => {
  it("returns model_list[0].model_name from the supplied yaml", () => {
    writeFileSync(
      yamlPath,
      `
model_list:
  - model_name: first-model
    litellm_params:
      model: openrouter/foo/first
  - model_name: second-model
    litellm_params:
      model: openrouter/foo/second
`,
      "utf8",
    );
    expect(getDefaultAgentModel(yamlPath)).toBe("first-model");
  });

  it("returns 'qwen3.6-plus' from the real repo yaml (HI-01 contract)", () => {
    // This is the constitutional anchor: HI-01 was opened because the
    // route hardcoded 'qwen/qwen3.6-plus' while the yaml carries
    // 'qwen3.6-plus' (no slash prefix). The default returned by the
    // loader MUST match the yaml verbatim.
    expect(getDefaultAgentModel()).toBe("qwen3.6-plus");
  });

  it("returns a string never carrying a provider-prefix slash", () => {
    // Negative regression — the bug class HI-01 closes is a slashed alias.
    expect(getDefaultAgentModel()).not.toMatch(/^[a-z0-9]+\//);
  });
});

describe("loadBundledModelProviders (HI-3 / ME-01)", () => {
  it("derives the provider map from litellm_params.model prefix", () => {
    writeFileSync(
      yamlPath,
      `
model_list:
  - model_name: alpha
    litellm_params:
      model: openrouter/foo/alpha
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: beta
    litellm_params:
      model: groq/whisper-large-v3
      api_key: os.environ/GROQ_API_KEY
`,
      "utf8",
    );
    expect(loadBundledModelProviders(yamlPath)).toEqual({
      alpha: "openrouter",
      beta: "groq",
    });
  });

  it("drops entries whose provider prefix is outside the known set (openai realtime)", () => {
    writeFileSync(
      yamlPath,
      `
model_list:
  - model_name: gpt-realtime
    litellm_params:
      model: openai/gpt-realtime
      mode: realtime
  - model_name: alpha
    litellm_params:
      model: openrouter/foo/alpha
`,
      "utf8",
    );
    const out = loadBundledModelProviders(yamlPath);
    expect(out).toEqual({ alpha: "openrouter" });
    expect(out["gpt-realtime"]).toBeUndefined();
  });

  it("matches the repo yaml: qwen3.6-plus -> openrouter, whisper-large-v3 -> groq", () => {
    const out = loadBundledModelProviders();
    expect(out["qwen3.6-plus"]).toBe("openrouter");
    expect(out["gemini-3-flash"]).toBe("openrouter");
    expect(out["gpt-4o-mini"]).toBe("openrouter");
    expect(out["whisper-large-v3"]).toBe("groq");
  });

  it("throws when model_list is missing", () => {
    writeFileSync(yamlPath, "general_settings: {}\n", "utf8");
    expect(() => loadBundledModelProviders(yamlPath)).toThrow(/model_list/);
  });

  it("skips entries with missing model_name or missing litellm_params.model", () => {
    writeFileSync(
      yamlPath,
      `
model_list:
  - model_name: complete
    litellm_params:
      model: groq/whisper-large-v3
  - model_name: partial
  - litellm_params:
      model: openrouter/foo/bar
`,
      "utf8",
    );
    const out = loadBundledModelProviders(yamlPath);
    expect(out).toEqual({ complete: "groq" });
  });
});
