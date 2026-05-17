// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-13b (REVIEW api-core HIGH HI-02) — RED→GREEN regression.
//
// `apps/api/src/bootstrap.ts` + `apps/api/src/index.ts` (the boot path)
// historically used `console.warn` / `console.error` for SSRF-blocked
// events and BullMQ/LiteLLM/Valkey degraded-mode warnings, leaning on
// `// biome-ignore lint/suspicious/noConsole: structured logging arrives in Phase 6`.
//
// Phase 6 has shipped (`makePino()` is live in `@openwhispr/observability`),
// so those sites must now route through pino and the suppressions must
// be retired. This test pins that contract — any future regression that
// re-introduces `console.warn`/`console.error` (or the matching
// suppression comment) into the boot path fails the suite.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_SRC = resolve(TEST_DIR, "../../../src/bootstrap.ts");
const INDEX_SRC = resolve(TEST_DIR, "../../../src/index.ts");

describe("Plan 51-13b — no console.* in api boot path", () => {
  // Strip line comments + block comments before checking for console.* —
  // historical sites carried `// biome-ignore ...` lines and the
  // post-fix narrative legitimately references `console.warn` in prose.
  // The regression we pin is "no live console.warn/error call site".
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("bootstrap.ts has no console.warn / console.error call sites", () => {
    const src = stripComments(readFileSync(BOOTSTRAP_SRC, "utf8"));
    expect(src).not.toMatch(/\bconsole\.(warn|error)\s*\(/);
    expect(src).not.toMatch(/biome-ignore.*noConsole/);
  });

  it("index.ts boot path has no console.warn / console.error call sites", () => {
    const src = stripComments(readFileSync(INDEX_SRC, "utf8"));
    expect(src).not.toMatch(/\bconsole\.(warn|error)\s*\(/);
    expect(src).not.toMatch(/biome-ignore.*noConsole/);
  });

  it("bootstrap.ts imports pino factory from @openwhispr/observability", () => {
    const src = readFileSync(BOOTSTRAP_SRC, "utf8");
    expect(src).toMatch(/makePino.*@openwhispr\/observability/s);
  });

  it("index.ts boot path imports pino factory from @openwhispr/observability", () => {
    const src = readFileSync(INDEX_SRC, "utf8");
    expect(src).toMatch(/makePino.*@openwhispr\/observability/s);
  });
});
