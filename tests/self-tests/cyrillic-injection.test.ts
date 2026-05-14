// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DOCS-09 self-test: injecting Cyrillic into a non-allowlisted source file
// must make tools/lint-english.ts exit non-zero with a file:line:col diagnostic
// matching /English-only violation/.
//
// Cyrillic codepoints in this test source are produced via \u escapes so the
// file itself remains ASCII-only (it is subject to the same English-only rule
// it verifies).
// CYR_PRIVET = "privet" (Russian "hello"); built from \u escapes:
//   U+043F U+0440 U+0438 U+0432 U+0435 U+0442
const CYR_PRIVET = "\u043F\u0440\u0438\u0432\u0435\u0442";

const SCRIPT = join(process.cwd(), "tools", "lint-english.ts");

function runLint(rootDir: string): { code: number; stderr: string } {
  try {
    execFileSync("pnpm", ["exec", "tsx", SCRIPT, rootDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

describe("DOCS-09 self-test: Cyrillic injection", () => {
  it("makes lint-english.ts exit non-zero with file:line:col diagnostic", () => {
    const root = mkdtempSync(join(tmpdir(), "cyr-inject-"));
    try {
      writeFileSync(join(root, "leak.ts"), `export const x = '${CYR_PRIVET}';\n`);
      const { code, stderr } = runLint(root);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/leak\.ts:1:/);
      expect(stderr).toMatch(/English-only violation/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("exits 0 when the same temp directory contains only ASCII source", () => {
    const root = mkdtempSync(join(tmpdir(), "cyr-clean-"));
    try {
      writeFileSync(join(root, "clean.ts"), "export const greeting = 'hello';\n");
      const { code } = runLint(root);
      expect(code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
