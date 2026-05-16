// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 44 / Plan 44-01 / L3 — meta-test for the load-smoke target.
//
// Per memory feedback_loadtest_cost_discipline: the PR-time load smoke
// MUST refuse to run when OPENWHISPR_LOADTEST_ALLOW_PAID=1 — that env
// is for the operator's manual paid-provider variant, never for CI.
//
// This is a self-test (no docker, no network) — it greps the Makefile
// and ci.yml to confirm the contract is encoded in the SOURCE, so a
// future agent removing the guard trips a vitest failure at PR time.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("load-smoke cost discipline (Phase 44 / L3)", () => {
  it("Makefile load-smoke target refuses when OPENWHISPR_LOADTEST_ALLOW_PAID=1", () => {
    const mk = read("Makefile");
    expect(mk).toMatch(/load-smoke:/);
    expect(mk).toMatch(/OPENWHISPR_LOADTEST_ALLOW_PAID.*1/);
    expect(mk).toMatch(/REFUSING/i);
  });

  it("Makefile load-smoke target pins PROFILE=mock", () => {
    const mk = read("Makefile");
    const block = mk.split(/^load-smoke:/m)[1] ?? "";
    expect(block).toMatch(/PROFILE=mock/);
  });

  it("CI load-smoke job is PR-only", () => {
    const ci = read(".github/workflows/ci.yml");
    const idx = ci.indexOf("load-smoke:");
    expect(idx).toBeGreaterThan(0);
    const block = ci.slice(idx, idx + 2000);
    expect(block).toMatch(/event_name/);
    expect(block).toMatch(/pull_request/);
    expect(block).toMatch(/make load-smoke/);
  });

  it("baselines directory is checked into the repo", () => {
    const readme = read("tests/load/baselines/README.md");
    expect(readme).toMatch(/Phase 44/);
    expect(readme).toMatch(/mock-pr-smoke\.json/);
  });
});
