import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DOCS-09 self-test: commitlint must reject a commit message whose subject
// contains Cyrillic, and accept a valid English Conventional Commit.
//
// Cyrillic codepoints are produced via \u escapes so this source remains
// ASCII-only. CYR_PRIVET = "privet" (U+043F U+0440 U+0438 U+0432 U+0435 U+0442).
const CYR_PRIVET = "\u043F\u0440\u0438\u0432\u0435\u0442";

function runCommitlint(msgFile: string): { code: number; stderr: string } {
  try {
    execFileSync("pnpm", ["exec", "commitlint", "--edit", msgFile], {
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

describe("DOCS-09 self-test: commitlint rejects Cyrillic in commit messages", () => {
  it("exits non-zero when subject contains Cyrillic", () => {
    const root = mkdtempSync(join(tmpdir(), "commit-cyr-"));
    try {
      const msgFile = join(root, "COMMIT_MSG");
      writeFileSync(msgFile, `feat: ${CYR_PRIVET} new feature\n`);
      const { code } = runCommitlint(msgFile);
      expect(code).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("exits 0 for a valid English Conventional Commit", () => {
    const root = mkdtempSync(join(tmpdir(), "commit-ok-"));
    try {
      const msgFile = join(root, "COMMIT_MSG");
      writeFileSync(msgFile, "feat(00-05): add self-tests for constitutional rules\n");
      const { code } = runCommitlint(msgFile);
      expect(code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
