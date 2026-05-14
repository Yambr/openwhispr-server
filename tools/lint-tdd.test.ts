// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "lint-tdd.ts");

describe("lint-tdd.ts", () => {
  it("runs without throwing and produces a status line", () => {
    let output = "";
    let exitCode = 0;
    try {
      output = execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as {
        status?: number | null;
        stdout?: Buffer;
        stderr?: Buffer;
      };
      exitCode = e.status ?? 1;
      output = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    }

    // Advisory script: a non-zero exit is acceptable when warnings exist.
    // We assert only that the script executed and emitted a recognizable
    // status line. Exit 2 (internal error) is the only outcome we reject.
    expect(exitCode).not.toBe(2);
    expect(output).toMatch(/TDD heuristic|lint-tdd/);
  });
});
