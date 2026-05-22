// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-15b — REVIEW litellm-client HIGH HI-4.
//
// Five `export const` symbols had only the package's own tests as
// consumers, locking otherwise-internal constants into the published
// API surface on the package's debut. Rather than force a synthetic
// non-test importer or move them to a subpath module (which would
// require re-exporting and reshape package.json), we mark each with
// a JSDoc `@internal` tag + a "MUST NOT depend on" warning so the
// contract is documented at the symbol declaration. This test pins
// the marker.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../src/index.ts");

function declarationWindow(src: string, name: string): string {
  const re = new RegExp(`export\\s+const\\s+${name}\\b`);
  const idx = src.search(re);
  if (idx < 0) return "";
  // 400-char lookbehind to capture the JSDoc block immediately preceding
  // the declaration.
  return src.slice(Math.max(0, idx - 400), idx);
}

const CONFIG_SRC = resolve(TEST_DIR, "../../src/config.ts");

describe("Plan 51-15b — internal-only litellm-client constants pinned with @internal", () => {
  // D2/D6 — `DEFAULT_STT_MODEL` was relocated from index.ts to config.ts
  // (it is now the env-default for `LITELLM_STT_MODEL` and a deliberate
  // part of the config public API, re-exported alongside DEFAULT_CHAT_MODEL).
  // It is therefore no longer an internal-only index.ts export.
  //
  // R32 — `DEFAULT_HEADERS_TIMEOUT_MS` / `DEFAULT_BODY_TIMEOUT_MS` were
  // likewise relocated from index.ts to config.ts (they are now the
  // env-defaults for `LITELLM_HEADERS_TIMEOUT_MS` / `LITELLM_BODY_TIMEOUT_MS`).
  // index.ts re-exports them via `export { ... } from "./config.js"` for
  // back-compat — so the `@internal` JSDoc marker now lives at the
  // canonical config.ts declaration, not at an `export const` in index.ts.
  const NAMES = ["BUNDLED_MODEL_PROVIDER", "PROVIDER_ENV_VAR"];

  it.each(NAMES)("`%s` declaration carries @internal JSDoc marker", (name) => {
    const src = readFileSync(SRC, "utf8");
    const window = declarationWindow(src, name);
    expect(window, `declaration not found for ${name}`).not.toBe("");
    expect(/@internal\b/.test(window)).toBe(true);
  });

  // R32 — the relocated timeout env-defaults. The `@internal` contract
  // travels with the canonical config.ts declaration.
  const CONFIG_INTERNAL_NAMES = [
    "DEFAULT_HEADERS_TIMEOUT_MS",
    "DEFAULT_BODY_TIMEOUT_MS",
    "DEFAULT_ERROR_DRAIN_TIMEOUT_MS",
  ];

  it.each(
    CONFIG_INTERNAL_NAMES,
  )("`%s` config.ts declaration carries @internal JSDoc marker", (name) => {
    const src = readFileSync(CONFIG_SRC, "utf8");
    const window = declarationWindow(src, name);
    expect(window, `declaration not found for ${name}`).not.toBe("");
    expect(/@internal\b/.test(window)).toBe(true);
  });

  it.each(CONFIG_INTERNAL_NAMES)("`%s` is re-exported from index.ts for back-compat", (name) => {
    const src = readFileSync(SRC, "utf8");
    // The re-export is an `export { ... } from "./config.js"` block;
    // assert the name appears as a re-exported identifier.
    expect(new RegExp(`\\b${name}\\b`).test(src), `${name} not re-exported by index.ts`).toBe(true);
  });
});
