import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "lint-english.ts");

// Cyrillic characters used in fixtures are produced via Unicode escapes so this
// test source itself contains no literal Cyrillic codepoints (it is itself a
// source artifact subject to the English-only rule).
// CYR_PRIVET == "privet" in the Russian alphabet ("hello"); built from
// Unicode escapes only (this source must remain ASCII-clean):
// U+043F U+0440 U+0438 U+0432 U+0435 U+0442
const CYR_PRIVET = "\u043F\u0440\u0438\u0432\u0435\u0442";

function runLint(rootDir: string): { code: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, rootDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer; stdout?: Buffer };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
      stdout: e.stdout?.toString() ?? "",
    };
  }
}

describe("lint-english.ts", () => {
  it("exits 0 on a clean tree", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-clean-"));
    writeFileSync(join(root, "a.ts"), "export const x = 1;\n");
    expect(runLint(root).code).toBe(0);
  });

  it("exits non-zero when Cyrillic appears in a non-allowlisted source file", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-bad-"));
    writeFileSync(join(root, "bad.ts"), `export const greet = '${CYR_PRIVET}';\n`);
    const r = runLint(root);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/bad\.ts:1:/);
  });

  it("exits 0 when Cyrillic is in an allowlisted i18n locale path", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-i18n-"));
    mkdirSync(join(root, "packages", "i18n", "locales", "ru"), { recursive: true });
    writeFileSync(
      join(root, "packages", "i18n", "locales", "ru", "common.json"),
      `{"greet":"${CYR_PRIVET}"}\n`,
    );
    expect(runLint(root).code).toBe(0);
  });

  it("exits 0 when Cyrillic is in tests/fixtures/i18n", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-fix-"));
    mkdirSync(join(root, "tests", "fixtures", "i18n"), { recursive: true });
    writeFileSync(join(root, "tests", "fixtures", "i18n", "has-cyr.txt"), `${CYR_PRIVET}\n`);
    expect(runLint(root).code).toBe(0);
  });
});
