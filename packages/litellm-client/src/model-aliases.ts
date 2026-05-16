// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.b / HI-01 — single source of truth for LiteLLM model aliases.
//
// Phase 41.f-hotfix (2026-05-16): the yaml parse moved out of the runtime
// hot path. `compose/litellm/litellm_config.yaml` is now read at BUILD time
// by `scripts/generate-aliases.ts` and materialised into the committed
// JSON file `litellm-aliases.generated.json`. The runtime import is a
// plain JSON import — no `yaml` package on the production bundle, no
// `readFileSync` at module load, and a malformed yaml fails the build
// instead of crashing the api boot.
//
// The yaml-parsing seam used by unit tests lives in
// `model-aliases-yaml-test-seam.ts` so the production module-aliases
// import graph is yaml-free. Existing tests dispatch through the seam
// here only when an explicit `yamlPath` argument is passed — tsup's
// tree-shaker cannot prove the static yaml import is unreachable for
// non-test calls, but the seam module is gated behind a runtime branch
// that production code never enters.
//
// Closes:
//   - SERVER-ERRORS bug "Error: Dynamic require of 'process' is not
//     supported" — yaml@2.x's CJS bundling cannot be ESM-bundled by tsup.
//   - byok-guard re-review WR-04 — the module-load `try/catch` silent
//     fallback to a static map is gone; build-time generation is the only
//     source of bundled-provider truth.

import generated from "./litellm-aliases.generated.json" with { type: "json" };
import { parseYamlAliases, parseYamlBundledProviders } from "./model-aliases-yaml-test-seam.js";

const KNOWN_PROVIDER_PREFIXES = ["openrouter", "groq", "pyannote"] as const;
type KnownProvider = (typeof KNOWN_PROVIDER_PREFIXES)[number];

interface GeneratedAliases {
  readonly version: 1;
  readonly aliases: readonly string[];
  readonly bundledProviders: Readonly<Record<string, KnownProvider>>;
}

const GENERATED: GeneratedAliases = generated as GeneratedAliases;

/**
 * Phase 41.f / HI-3 — bundled-model → provider map. In production this
 * resolves to the build-time JSON (no yaml parse). When `yamlPath` is
 * passed (unit-test seam), we re-parse the supplied yaml file.
 */
export function loadBundledModelProviders(yamlPath?: string): Record<string, KnownProvider> {
  if (yamlPath !== undefined) {
    return parseYamlBundledProviders(yamlPath);
  }
  return { ...GENERATED.bundledProviders };
}

/**
 * Load the ordered `model_name` aliases. In production resolves to the
 * build-time JSON (no yaml parse). When `yamlPath` is passed, re-parses
 * the supplied yaml file (unit-test seam).
 */
export function loadLitellmModelAliases(yamlPath?: string): string[] {
  if (yamlPath !== undefined) {
    return parseYamlAliases(yamlPath);
  }
  return [...GENERATED.aliases];
}

/**
 * Return the canonical default agent model — `model_list[0].model_name`.
 * Used by `apps/api/src/routes/agent/stream.ts` so the route default
 * tracks the yaml. Production code MUST NOT hardcode the literal alias.
 */
export function getDefaultAgentModel(yamlPath?: string): string {
  const aliases = loadLitellmModelAliases(yamlPath);
  return aliases[0] as string;
}
