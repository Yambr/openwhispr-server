// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.f-hotfix — yaml parsing extracted into its own module so
// production callers of `model-aliases.ts` never pull the `yaml` package
// into the api bundle. Only the unit tests import this file; production
// code uses the codegen JSON via `litellm-aliases.generated.json`.
//
// Why this separation matters: tsup's ESM bundling cannot handle yaml@2.x's
// internal `require('process')`. Even a code-path that is structurally
// unreachable at runtime (the `if (yamlPath !== undefined)` branch) would
// still be statically reachable from the import graph and force the
// bundler to include the offending yaml CJS module. Isolating the yaml
// import here keeps the production module-aliases module yaml-free.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

interface RawLitellmConfig {
  model_list?: Array<{
    model_name?: unknown;
    litellm_params?: { model?: unknown };
  }>;
}

const KNOWN_PROVIDER_PREFIXES = ["openrouter", "groq"] as const;
type KnownProvider = (typeof KNOWN_PROVIDER_PREFIXES)[number];

function readYamlModelList(yamlPath: string): NonNullable<RawLitellmConfig["model_list"]> {
  const raw = readFileSync(yamlPath, "utf8");
  const doc = parseYaml(raw) as RawLitellmConfig | null;
  const list = doc?.model_list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `LiteLLM config at ${yamlPath} has no model_list entries (top-level model_list must be a non-empty array).`,
    );
  }
  return list;
}

/**
 * Strict alias parse — every entry MUST carry a non-empty `model_name`.
 * Mirrors the codegen script's invariant.
 */
export function parseYamlAliases(yamlPath: string): string[] {
  const list = readYamlModelList(yamlPath);
  const aliases: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const name = typeof entry?.model_name === "string" ? entry.model_name.trim() : "";
    if (!name) {
      throw new Error(
        `LiteLLM config at ${yamlPath}: model_list[${i}] is missing a non-empty model_name field.`,
      );
    }
    aliases.push(name);
  }
  return aliases;
}

/**
 * Permissive bundled-provider parse — entries that lack `model_name` or
 * whose `litellm_params.model` has no recognised provider prefix are
 * silently skipped (LiteLLM allows custom providers like `vertex_ai/`,
 * `bedrock/` that we don't precheck).
 */
export function parseYamlBundledProviders(yamlPath: string): Record<string, KnownProvider> {
  const list = readYamlModelList(yamlPath);
  const out: Record<string, KnownProvider> = {};
  for (const entry of list) {
    const name = typeof entry?.model_name === "string" ? entry.model_name.trim() : "";
    const upstream =
      typeof entry?.litellm_params?.model === "string" ? entry.litellm_params.model.trim() : "";
    if (!name || !upstream) continue;
    const prefix = upstream.split("/", 1)[0];
    if (!prefix) continue;
    const match = KNOWN_PROVIDER_PREFIXES.find((p) => p === prefix);
    if (match) out[name] = match;
  }
  return out;
}
