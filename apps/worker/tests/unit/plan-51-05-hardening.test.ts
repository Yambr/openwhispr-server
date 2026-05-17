// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-05 — RED→GREEN regressions for REVIEW-INDEX.md
// CR-7 (usage-rollup tenant-context), CR-8 (scheduler date freeze),
// CR-9 (silent failed-job loss + retry jitter).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROLLUP_SRC = resolve(TEST_DIR, "../../src/jobs/usage-rollup-daily.ts");
const SCHEDULER_SRC = resolve(TEST_DIR, "../../src/scheduler.ts");
const QUEUES_SRC = resolve(TEST_DIR, "../../src/queues.ts");

describe("Plan 51-05 — worker hardening", () => {
  describe("CR-7 — usage-rollup runs UPSERT on the bound client", () => {
    it("source: handler receives (data, client) and runs the UPSERT on `client.query`", () => {
      const src = readFileSync(ROLLUP_SRC, "utf8");
      // Strip JSDoc + line comments so we only inspect runtime code.
      const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        /withTenantContext\([^,]+,\s*[^,]+,\s*async\s*\(\s*data\s*,\s*client\s*\)/.test(stripped),
      ).toBe(true);
      expect(/await\s+client\.query\(/.test(stripped)).toBe(true);
      // Must NOT use deps.pool.query (would bypass the tenant GUC).
      expect(/await\s+deps\.pool\.query\(/.test(stripped)).toBe(false);
    });
  });

  describe("CR-8 — schedulers no longer freeze the date payload", () => {
    it("source: usage-rollup-dispatcher payload is `data: {}` (no `date:` literal)", () => {
      const src = readFileSync(SCHEDULER_SRC, "utf8");
      const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // Find the `upsertJobScheduler("usage-rollup-daily", …)` call
      // and assert its `data:` payload is empty.
      const m = stripped.match(/upsertJobScheduler\(\s*"usage-rollup-daily"[\s\S]+?\}\s*\)/);
      expect(m, "usage-rollup-daily scheduler call not found").toBeTruthy();
      expect(/data:\s*\{\s*\}/.test(m?.[0] ?? "")).toBe(true);
      // Defence-in-depth: the OLD `date:` literal must be gone from
      // that block.
      expect(/data:\s*\{\s*date:/.test(m?.[0] ?? "")).toBe(false);
    });

    it("source: reconciliation-daily scheduler payload is `data: {}` (no `window_start`)", () => {
      const src = readFileSync(SCHEDULER_SRC, "utf8");
      const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const m = stripped.match(/upsertJobScheduler\(\s*"reconciliation-daily"[\s\S]+?\}\s*\)/);
      expect(m, "reconciliation-daily scheduler call not found").toBeTruthy();
      expect(/window_start/.test(m?.[0] ?? "")).toBe(false);
    });

    it("source: a `dateStringForJob(job)` helper exists for handlers to derive the day from job.timestamp", () => {
      const src = readFileSync(SCHEDULER_SRC, "utf8");
      expect(/export function dateStringForJob/.test(src)).toBe(true);
    });
  });

  describe("CR-9 — failed jobs stay forever; retries get jitter", () => {
    it("source: DEFAULT_JOB_OPTS.removeOnFail is false (no age-based GC)", () => {
      const src = readFileSync(QUEUES_SRC, "utf8");
      const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/removeOnFail:\s*false\b/.test(stripped)).toBe(true);
      // The pre-fix `removeOnFail: { age: 7 * 24 * 3600 }` literal
      // must be gone.
      expect(/removeOnFail:\s*\{\s*age:/.test(stripped)).toBe(false);
    });

    it("source: backoff carries a `jitter` factor > 0 (anti thundering-herd)", () => {
      const src = readFileSync(QUEUES_SRC, "utf8");
      const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/backoff:\s*\{[^}]*jitter:\s*(?:[1-9]|0\.\d*[1-9])/.test(stripped)).toBe(true);
    });
  });
});
