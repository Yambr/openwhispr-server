// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-gitleaks-config.test.ts — TDD contract for the `.gitleaks.toml`
 * single-source-of-truth secret-leak ruleset.
 *
 * Phase 260516-kya / Plan 01 / Task 1.
 *
 * Contract guaranteed by this suite:
 *   1. Live secret shapes (synthetic but matching real gitleaks default
 *      patterns) MUST be DETECTED by `gitleaks detect --no-git` against
 *      a temp source tree configured with `.gitleaks.toml`.
 *   2. Known test placeholder shapes hard-coded in the codebase
 *      (`sk-or-v1-1234567890abcdef`, `sk-master-x`, `AKIATEST`,
 *      `AKIAIOSFODNN7EXAMPLE`, `sk-proj-1234567890abcdef`) MUST be
 *      ALLOWED so the existing test surface does not regress.
 *   3. `.env.example` (and `.env.*.example`) MUST be allowlisted by
 *      PATH so operator-facing template files can carry illustrative
 *      `OPENAI_API_KEY=sk-...` lines without tripping the gate.
 *
 * Boundaries:
 *   - We invoke the real gitleaks binary via argv-array `spawnSync`
 *     (LOCKER-06: no shell-string interpolation).
 *   - If the binary is absent (operator hasn't yet run
 *     `bash tools/install-gitleaks.sh` / `make install-gitleaks`), the
 *     suite SKIPS with an operator-actionable hint rather than
 *     failing — CI installs the binary separately.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CONFIG_PATH = join(REPO_ROOT, ".gitleaks.toml");

/**
 * PATH lookup for the gitleaks binary. Returns the resolved path or
 * `null` when not found. Pure argv-array invocation (no shell).
 */
function findGitleaks(): string | null {
  const which = spawnSync("which", ["gitleaks"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }
  return null;
}

const GITLEAKS = findGitleaks();

/**
 * Run gitleaks detect against a directory, return exit code + combined
 * output. Argv-array form only (LOCKER-06 compliant).
 */
function runGitleaks(srcDir: string): { status: number; output: string } {
  if (!GITLEAKS) {
    throw new Error("gitleaks not installed");
  }
  const r = spawnSync(
    GITLEAKS,
    [
      "detect",
      "--no-git",
      "--no-banner",
      `--source=${srcDir}`,
      `--config=${CONFIG_PATH}`,
      "--redact",
    ],
    { encoding: "utf8" },
  );
  return {
    status: r.status ?? -1,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

describe("gitleaks config contract (.gitleaks.toml)", () => {
  beforeAll(() => {
    if (!GITLEAKS) {
      console.warn(
        "[lint-gitleaks-config.test] gitleaks not on PATH; suite SKIPPED.\n" +
          "  Install: bash tools/install-gitleaks.sh   OR   make install-gitleaks",
      );
    }
  });

  it("config file exists at repo root", () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  it("DETECTS a synthetic OpenAI sk-proj live shape (positive control)", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-pos-"));
    try {
      // High-entropy synthetic shape — gitleaks default generic-api-key
      // rule enforces an entropy floor (~3.5) plus shape match. The
      // all-letters AAAA...NNNN variant scores below the floor; a mixed
      // alnum/case string clears it. This is still synthetic (not a
      // real key) — see RuleID="generic-api-key" coverage.
      writeFileSync(
        join(dir, "live.ts"),
        'const KEY = "SYNTH9xY2vW8nP1jL5kRgD7sM6cF0hX3uZbN0qE4tR7wA1bSYNTH";\n',
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected non-zero; output:\n${r.output}`).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS the sk-or-v1-1234567890abcdef OpenRouter test placeholder", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-or-"));
    try {
      mkdirSync(join(dir, "tests", "fixtures"), { recursive: true });
      writeFileSync(
        join(dir, "tests", "fixtures", "openrouter.ts"),
        'const TEST_KEY = "sk-or-v1-1234567890abcdef";\n',
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS the sk-master-x apps/api vitest.setup placeholder", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-master-"));
    try {
      mkdirSync(join(dir, "apps", "api"), { recursive: true });
      writeFileSync(
        join(dir, "apps", "api", "vitest.setup.ts"),
        'process.env.MASTER_KEY = "sk-master-x";\n',
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS AKIAIOSFODNN7EXAMPLE and AKIATEST AWS placeholders", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-aws-"));
    try {
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(
        join(dir, "tests", "aws.ts"),
        'const A = "AKIAIOSFODNN7EXAMPLE";\nconst B = "AKIATEST";\n',
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS sk-proj-1234567890abcdef placeholder (test shape)", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-skproj-"));
    try {
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(join(dir, "tests", "openai.ts"), 'const TEST = "sk-proj-1234567890abcdef";\n');
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS tools/lint-compose-chart-parity.ts (helm-render fixture file)", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-chartparity-"));
    try {
      mkdirSync(join(dir, "tools"), { recursive: true });
      // Mirrors the synthetic --set-string masterKek value used by the
      // helm-chart parity linter (a high-entropy fake password).
      writeFileSync(
        join(dir, "tools", "lint-compose-chart-parity.ts"),
        'export const X = "secrets.masterKek=v5ux8tbIGXCoCeqi16dtiRVMVDvR4mRTojqRlL2lV-w";\n',
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS .env.example by path (operator-facing template)", () => {
    if (!GITLEAKS) return;
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-envex-"));
    try {
      writeFileSync(
        join(dir, ".env.example"),
        "OPENAI_API_KEY=SYNTH9xY2vW8nP1jL5kRgD7sM6cF0hX3uZbN0qE4tR7wA1bSYNTH\n",
      );
      const r = runGitleaks(dir);
      expect(r.status, `expected 0; output:\n${r.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
