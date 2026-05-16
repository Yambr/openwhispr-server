// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.f-hotfix — build-time codegen of `src/litellm-aliases.generated.json`
// from `compose/litellm/litellm_config.yaml`.
//
// Reason: the original Phase 41.b/41.f implementation called `parseYaml()`
// at module import time. tsup's ESM bundling cannot handle yaml@2.x's
// internal `require('process')` (yaml's bundled CJS uses dynamic require),
// which crashes the production api bundle at boot with
// `Error: Dynamic require of "process" is not supported`. Moving the yaml
// read out of the runtime path eliminates the failure class entirely AND
// closes byok-guard re-review WR-04 (silent fallback to a stale static
// map when yaml is unreadable) — the codegen always runs at build time,
// so a malformed yaml fails the build, not a hidden runtime branch.
//
// The script is deterministic: identical yaml input → identical JSON output
// (sorted keys not required because the agent default-model depends on
// model_list[0] order; we preserve insertion order from the yaml).
//
// Run via `pnpm --filter @openwhispr/litellm-client run generate-aliases`
// or implicitly through the `prebuild` hook in package.json.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

interface RawLitellmConfig {
  model_list?: Array<{
    model_name?: unknown;
    litellm_params?: { model?: unknown };
  }>;
}

const KNOWN_PROVIDER_PREFIXES = ["openrouter", "groq", "pyannote"] as const;
type KnownProvider = (typeof KNOWN_PROVIDER_PREFIXES)[number];

interface GeneratedAliases {
  /** Schema version — bumped if the JSON shape ever changes. */
  readonly version: 1;
  /** Ordered list of `model_name` strings, in yaml file order. */
  readonly aliases: readonly string[];
  /** Map of `model_name` → bundled provider for entries whose
   *  `litellm_params.model` carries a recognised provider prefix. */
  readonly bundledProviders: Readonly<Record<string, KnownProvider>>;
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/litellm-client/scripts → repo root
  return resolve(here, "..", "..", "..");
}

function generate(): GeneratedAliases {
  const yamlPath = resolve(repoRoot(), "compose", "litellm", "litellm_config.yaml");
  const raw = readFileSync(yamlPath, "utf8");
  const doc = parseYaml(raw) as RawLitellmConfig | null;
  const list = doc?.model_list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `LiteLLM config at ${yamlPath} has no model_list entries (top-level model_list must be a non-empty array).`,
    );
  }

  const aliases: string[] = [];
  const bundledProviders: Record<string, KnownProvider> = {};
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const name = typeof entry?.model_name === "string" ? entry.model_name.trim() : "";
    if (!name) {
      throw new Error(
        `LiteLLM config at ${yamlPath}: model_list[${i}] is missing a non-empty model_name field.`,
      );
    }
    aliases.push(name);

    const upstream =
      typeof entry?.litellm_params?.model === "string" ? entry.litellm_params.model.trim() : "";
    if (!upstream) continue;
    const prefix = upstream.split("/", 1)[0];
    if (!prefix) continue;
    const match = KNOWN_PROVIDER_PREFIXES.find((p) => p === prefix);
    if (match) bundledProviders[name] = match;
  }

  return { version: 1, aliases, bundledProviders };
}

function main(): void {
  const out = generate();
  const target = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "litellm-aliases.generated.json",
  );
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `generate-aliases: wrote ${out.aliases.length} aliases (${Object.keys(out.bundledProviders).length} bundled-provider entries) to ${target}`,
  );
}

main();
