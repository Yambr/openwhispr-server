// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 05 — RED conformance for virtual-key-rotation removal.
//
// CONTEXT.md decision 3 + RESEARCH §A.5 + REQUIREMENTS BYOK-03 audit closure:
// remove the entire vkr worker wiring (job file, queue registration, cron,
// worker registration, noop adapters) because the production driver does
// not exist and the cron enqueues a nil-UUID sentinel that cannot succeed.
//
// This test is the conformance gate for the removal — RED in the pre-edit
// state, GREEN after Tasks 2 + 3 land. It also keeps the removal honest in
// future refactors: anyone resurrecting `virtualKeyRotation` symbols or the
// `0 3 * * 0` cron pattern in worker source must explicitly re-enable this
// queue under a new CONTEXT decision.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Run `grep -rln <pattern> <paths>` and return the matched file paths.
 * Returns an empty array on exit-code 1 (grep's "no matches" signal).
 */
function grepRln(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync("grep", ["-rln", "--", pattern, ...paths], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    // grep exits 1 when no matches found — that's success for us.
    const e = err as { status?: number };
    if (e.status === 1) return [];
    throw err;
  }
}

describe("virtual-key-rotation removal conformance (Phase 14 / Plan 05)", () => {
  it("apps/worker/src/jobs/virtual-key-rotation.ts is deleted", () => {
    expect(existsSync(resolve(REPO_ROOT, "apps/worker/src/jobs/virtual-key-rotation.ts"))).toBe(
      false,
    );
  });

  it("apps/worker/src/jobs/virtual-key-rotation.test.ts is deleted", () => {
    expect(
      existsSync(resolve(REPO_ROOT, "apps/worker/src/jobs/virtual-key-rotation.test.ts")),
    ).toBe(false);
  });

  it("no live source under apps/ references the removed vkr symbols", () => {
    const matches = grepRln(
      "virtualKeyRotation\\|noopLitellmKeyClient\\|noopUserKeyLookup\\|buildVirtualKeyRotationHandler\\|vkrWorker",
      ["apps/worker/src", "apps/api/src"],
    );
    // Tolerate `apps/worker/src/index.ts` ONLY when its sole match is the
    // transient Valkey-key cleanup literal `bull:virtual-key-rotation:*` —
    // that is NOT one of the patterns above, so any hit here is a true
    // regression. (The cleanup literal is asserted positively below.)
    expect(matches).toEqual([]);
  });

  it("apps/worker/src/queues.ts does not contain virtualKeyRotation", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/queues.ts"), "utf8");
    expect(src).not.toMatch(/virtualKeyRotation/);
    expect(src).not.toMatch(/virtual-key-rotation/);
  });

  it("apps/worker/src/scheduler.ts does not contain virtualKeyRotation or 0 3 * * 0", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/scheduler.ts"), "utf8");
    expect(src).not.toMatch(/virtualKeyRotation/);
    expect(src).not.toMatch(/0 3 \* \* 0/);
  });

  it("tests/e2e/log-scrub-sentinel.test.ts uses email-delivery instead of virtual-key-rotation", () => {
    const src = readFileSync(resolve(REPO_ROOT, "tests/e2e/log-scrub-sentinel.test.ts"), "utf8");
    expect(src).not.toMatch(/virtual-key-rotation/);
    expect(src).toMatch(/email-delivery/);
  });

  it("docs/architecture.md no longer lists Q2[virtual-key-rotation]", () => {
    const src = readFileSync(resolve(REPO_ROOT, "docs/architecture.md"), "utf8");
    expect(src).not.toMatch(/Q2\[virtual-key-rotation\]/);
    expect(src).not.toMatch(/vkrWorker/);
  });

  it("docs/operations.md documents the valkey-cli DEL bull:virtual-key-rotation:* cleanup", () => {
    const src = readFileSync(resolve(REPO_ROOT, "docs/operations.md"), "utf8");
    expect(src).toMatch(/DEL bull:virtual-key-rotation:\*/);
  });

  it("apps/worker/src/index.ts boots a transient bull:virtual-key-rotation:* cleanup", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/index.ts"), "utf8");
    expect(src).toMatch(/bull:virtual-key-rotation:\*/);
  });
});
