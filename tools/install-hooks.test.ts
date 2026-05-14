// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "install-hooks.cjs");

function runScript(
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("install-hooks.cjs", () => {
  it("exits 0 silently when .git is absent (CI / Docker build path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "install-hooks-no-git-"));
    const r = runScript(dir);
    expect(r.code).toBe(0);
  });

  it("logs a skip notice when .git is absent and verbose flag set", () => {
    const dir = mkdtempSync(join(tmpdir(), "install-hooks-no-git-verbose-"));
    const r = runScript(dir, { LEFTHOOK_INSTALL_VERBOSE: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no \.git directory/);
  });

  it("honors SKIP_LEFTHOOK_INSTALL=1 even when .git is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "install-hooks-skip-"));
    mkdirSync(join(dir, ".git"));
    const r = runScript(dir, { SKIP_LEFTHOOK_INSTALL: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/SKIP_LEFTHOOK_INSTALL/);
  });

  it("running on this repository succeeds with core.hooksPath set (regression: prepare-hook conflict)", () => {
    // The bug we are fixing: `lefthook install` (no --force) refuses to run
    // when `core.hooksPath` is set locally, even when it points at .git/hooks.
    // Our wrapper passes --force, which makes it idempotent.
    const r = runScript(process.cwd());
    expect(r.code).toBe(0);
  });
});
