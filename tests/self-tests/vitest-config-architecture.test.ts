// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 45 / Plan 45-01 / L4 — architectural self-test for vitest config layout.
//
// Closes L4 from `.planning/qa-audit/2026-05-16-test-layering.md`. The
// audit doc flagged a worry that two parallel `vitest.config.ts` files
// at the repo root would confuse developers. Investigation found the
// "second" config never actually shipped — there is ONE root config
// (`vitest.config.ts`) plus opt-in per-workspace configs (e.g.
// `tests/e2e/vitest.config.ts` gated on `E2E=1`) and a focused
// `vitest.smoke.config.ts` for the Phase 22 smoke layer.
//
// This self-test pins the architecture so a future agent does not
// re-introduce a parallel root config and the confusion the audit
// originally flagged.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

describe("vitest config architecture (Phase 45 / L4)", () => {
  it("exactly one canonical root vitest.config.ts", () => {
    const candidates = readdirSync(REPO_ROOT)
      .filter((f) => /^vitest\..*\.config\.ts$|^vitest\.config\.ts$/.test(f))
      .sort();
    // Allowed roots: the canonical one + the focused smoke config.
    expect(candidates).toEqual(["vitest.config.ts", "vitest.smoke.config.ts"]);
  });

  it("root config uses the projects array (not legacy `workspace`)", () => {
    const body = readFileSync(resolve(REPO_ROOT, "vitest.config.ts"), "utf8");
    expect(body).toMatch(/projects:/);
    expect(body).not.toMatch(/^\s*workspace:/m);
  });

  it("tests/e2e is opt-in via E2E env (not auto-discovered by root)", () => {
    const e2eCfg = readFileSync(resolve(REPO_ROOT, "tests/e2e/vitest.config.ts"), "utf8");
    expect(e2eCfg).toMatch(/E2E/);
  });

  it("tests/integration and tests/self-tests have explicit projects entries", () => {
    const body = readFileSync(resolve(REPO_ROOT, "vitest.config.ts"), "utf8");
    expect(body).toMatch(/name:\s*['"]tests-integration['"]/);
    expect(body).toMatch(/name:\s*['"]tests-self-tests['"]/);
  });

  it("smoke config is flat (single include glob, no coverage)", () => {
    const body = readFileSync(resolve(REPO_ROOT, "vitest.smoke.config.ts"), "utf8");
    expect(body).toMatch(/tests\/smoke/);
    expect(body).not.toMatch(/projects:/);
    expect(body).not.toMatch(/coverage:/);
  });

  it("no rogue vitest.*.config.ts at the repo root beyond the two canonical ones", () => {
    // Defence-in-depth: re-check via raw stat in case the file-name
    // regex above ever drifts. Any *.config.ts at the root that starts
    // with `vitest.` MUST be one of the two canonical entries.
    for (const f of readdirSync(REPO_ROOT)) {
      if (!f.startsWith("vitest.") || !f.endsWith(".config.ts")) continue;
      expect(["vitest.config.ts", "vitest.smoke.config.ts"]).toContain(f);
    }
  });

  it("every per-workspace vitest.config.ts is a real file (not a dangling symlink)", () => {
    const body = readFileSync(resolve(REPO_ROOT, "vitest.config.ts"), "utf8");
    const matches = Array.from(body.matchAll(/p\("([^"]+vitest\.config\.ts)"\)/g));
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const path = resolve(REPO_ROOT, m[1]);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });
});
