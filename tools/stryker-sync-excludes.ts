// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * stryker-sync-excludes.ts — regenerate stryker.config.json `ignorePatterns`
 * from the detector. Run via `pnpm stryker:sync-excludes`. The regression test
 * (tools/lint-stryker-source-assertion-excludes.test.ts) fails if the JSON is
 * out of sync, so a new source-assertion test forces a re-sync rather than a
 * silent mutation-quick break. fix 260530-rqk.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALWAYS_IGNORE, detectSourceAssertionTests } from "./stryker-source-assertion-excludes.js";

const repoRoot = resolve(import.meta.dirname, "..");
const cfgPath = resolve(repoRoot, "stryker.config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
cfg.ignorePatterns = [...ALWAYS_IGNORE, ...detectSourceAssertionTests(repoRoot)];
writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
process.stdout.write(`stryker:sync-excludes — wrote ${cfg.ignorePatterns.length} ignorePatterns\n`);
