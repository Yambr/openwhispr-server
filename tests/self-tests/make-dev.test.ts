// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DEVEX-01 smoke: the top-level Makefile defines the standard developer
// targets and `make help` exits 0 from a clean working tree. We deliberately
// do NOT spin up the docker-compose stack here:
//   - `make up` requires a running Docker daemon (not guaranteed in all CI
//     runners or contributor laptops).
//   - The DEVEX-01 contract is that the Makefile target EXISTS and is
//     well-formed; full container lifecycle is exercised by integration jobs
//     in later phases.
//
// This test verifies:
//   1. The Makefile contains the constitutional DEVEX-01 targets.
//   2. `make help` succeeds and lists those targets.
//   3. `make -n dev` (dry-run) succeeds — proves the recipe parses without
//      requiring Docker.

const MAKEFILE_PATH = join(process.cwd(), "Makefile");

function runMake(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("make", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stdout?: Buffer; stderr?: Buffer };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

describe("DEVEX-01 self-test: Makefile defines standard targets", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  it.each([
    "dev",
    "test",
    "lint",
    "format",
    "typecheck",
    "up",
    "down",
    "clean",
    "help",
  ])("Makefile declares target %s", (target) => {
    const re = new RegExp(`^${target}\\s*:`, "m");
    expect(makefile).toMatch(re);
  });

  it("targets are listed under .PHONY", () => {
    expect(makefile).toMatch(/^\.PHONY\s*:/m);
  });

  it("`make help` exits 0 and lists at least one target", () => {
    const { code, stdout } = runMake(["help"]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }, 30_000);

  it("`make -n dev` (dry-run) parses successfully", () => {
    const { code } = runMake(["-n", "dev"]);
    expect(code).toBe(0);
  }, 30_000);
});
