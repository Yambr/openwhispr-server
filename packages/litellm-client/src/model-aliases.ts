// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.b / HI-01 — single source of truth for LiteLLM model aliases.
//
// Reads compose/litellm/litellm_config.yaml at module / first-call time and
// returns the `model_list[].model_name` set. The yaml IS the canonical
// alias map — historically code hardcoded e.g. `qwen/qwen3.6-plus` while
// the yaml carried `qwen3.6-plus` (no provider-prefix slash), causing a
// silent LiteLLM-router 404 emitted as a finish-chunk `upstream_error`
// under HTTP 200. This module collapses that drift class to a single read.
//
// Phase 41.f will consume the same loader (D-LITELLM-HI-3).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

interface RawLitellmConfig {
  model_list?: Array<{
    model_name?: unknown;
    litellm_params?: { model?: unknown };
  }>;
}

/**
 * Phase 41.f / HI-3 — recognized provider prefixes in
 * `litellm_params.model`. We parse the first `/`-separated token and map
 * it to the canonical provider key. Order-insensitive — first matching
 * prefix wins. Unknown prefixes do NOT throw (LiteLLM allows custom
 * providers, e.g. `vertex_ai/`, `bedrock/`, ...); they are dropped from
 * the bundled-model precheck map and fall through to upstream 4xx.
 */
/**
 * Provider keys we precheck via `config.providerKeys` (see
 * `packages/litellm-client/src/config.ts` LitellmProviderKeys). Entries in
 * the yaml whose provider prefix is outside this set (e.g. `openai/` for
 * realtime models) are intentionally NOT included in the precheck map —
 * realtime auth is handled by the realtime route, not the http client.
 */
const KNOWN_PROVIDER_PREFIXES = ["openrouter", "groq", "pyannote"] as const;
type KnownProvider = (typeof KNOWN_PROVIDER_PREFIXES)[number];

/**
 * Phase 41.f / HI-3 — derive the bundled-model → provider map from the
 * same yaml that LiteLLM Router consumes. Single source of truth: any
 * model added to `compose/litellm/litellm_config.yaml` is automatically
 * precheck-gated by the client (no hand-maintained constant drift).
 *
 * Returns `Record<model_name, provider>` for entries whose
 * `litellm_params.model` carries a recognised provider prefix
 * (openrouter / groq / openai / pyannote). Realtime entries (mode:
 * realtime) are included for completeness — corporate operators can map
 * them to bundled-provider keys.
 */
export function loadBundledModelProviders(yamlPath?: string): Record<string, KnownProvider> {
  const path = yamlPath ?? defaultYamlPath();
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw) as RawLitellmConfig | null;
  const list = doc?.model_list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `LiteLLM config at ${path} has no model_list entries (top-level model_list must be a non-empty array).`,
    );
  }
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

/**
 * Resolve the repository-root `compose/litellm/litellm_config.yaml` path
 * from this module's file URL. Walks up from
 * `packages/litellm-client/src/model-aliases.ts` to the repo root.
 */
function defaultYamlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/litellm-client/src → ../../../compose/litellm/litellm_config.yaml
  return resolve(here, "..", "..", "..", "compose", "litellm", "litellm_config.yaml");
}

/**
 * Load the ordered `model_name` aliases from the supplied LiteLLM yaml
 * (defaults to the bundled compose config). Order matches yaml file
 * order — LiteLLM Router uses the same ordering for default-pick fallback.
 *
 * Throws when the yaml is missing `model_list`, the list is empty, or any
 * entry lacks `model_name`.
 */
export function loadLitellmModelAliases(yamlPath?: string): string[] {
  const path = yamlPath ?? defaultYamlPath();
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw) as RawLitellmConfig | null;
  const list = doc?.model_list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `LiteLLM config at ${path} has no model_list entries (top-level model_list must be a non-empty array).`,
    );
  }
  const names: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const name = typeof entry?.model_name === "string" ? entry.model_name.trim() : "";
    if (!name) {
      throw new Error(
        `LiteLLM config at ${path}: model_list[${i}] is missing a non-empty model_name field.`,
      );
    }
    names.push(name);
  }
  return names;
}

/**
 * Return the canonical default agent model — `model_list[0].model_name`.
 * Used by `apps/api/src/routes/agent/stream.ts` so the route default
 * tracks the yaml. Production code MUST NOT hardcode the literal alias.
 */
export function getDefaultAgentModel(yamlPath?: string): string {
  const aliases = loadLitellmModelAliases(yamlPath);
  // length ≥ 1 enforced by loadLitellmModelAliases.
  return aliases[0] as string;
}
