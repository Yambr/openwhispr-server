// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 21 / Plan 21-05 / SR-21.5 — RED→GREEN tests for tools/lint-coverage-floor-per-phase.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  evaluateCoverageEntry,
  isStrictPath,
  loadChangedFiles,
  loadCoverageSummary,
  run,
  STRICT_PACKAGE_PATTERNS,
} from "./lint-coverage-floor-per-phase";

const SCRIPT = join(process.cwd(), "tools", "lint-coverage-floor-per-phase.ts");

function runLint(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, ...args], {
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

// ──────────────────────────────────────────────────────────────────
// Pure-function tests.
// ──────────────────────────────────────────────────────────────────

describe("STRICT_PACKAGE_PATTERNS", () => {
  it("includes the 7 packages named in PROJECT.md constitutional rules", () => {
    // apps/api, apps/web, apps/worker, packages/data, packages/byok-guard,
    // packages/email, packages/litellm-client
    expect(STRICT_PACKAGE_PATTERNS.length).toBe(7);
  });
});

describe("isStrictPath", () => {
  it("matches apps/api src files", () => {
    expect(isStrictPath("/abs/apps/api/src/index.ts")).toBe(true);
  });

  it("matches packages/byok-guard src files", () => {
    expect(isStrictPath("/abs/packages/byok-guard/src/index.ts")).toBe(true);
  });

  it("does NOT match files in non-strict packages", () => {
    expect(isStrictPath("/abs/packages/i18n/src/index.ts")).toBe(false);
    expect(isStrictPath("/abs/tools/lint-x.ts")).toBe(false);
  });

  it("does NOT match test files inside strict packages", () => {
    expect(isStrictPath("/abs/apps/api/src/__tests__/x.test.ts")).toBe(false);
    expect(isStrictPath("/abs/packages/data/src/y.spec.ts")).toBe(false);
  });
});

describe("evaluateCoverageEntry", () => {
  it("returns empty when all four axes are ≥ 90", () => {
    const offenders = evaluateCoverageEntry("apps/api/src/x.ts", {
      statements: { pct: 91 },
      branches: { pct: 90 },
      functions: { pct: 95 },
      lines: { pct: 100 },
    });
    expect(offenders).toEqual([]);
  });

  it("flags branches < 90", () => {
    const offenders = evaluateCoverageEntry("apps/api/src/x.ts", {
      statements: { pct: 95 },
      branches: { pct: 88 },
      functions: { pct: 95 },
      lines: { pct: 95 },
    });
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/branches.*88/);
  });

  it("flags multiple axes simultaneously when several fall short", () => {
    const offenders = evaluateCoverageEntry("apps/api/src/x.ts", {
      statements: { pct: 70 },
      branches: { pct: 60 },
      functions: { pct: 50 },
      lines: { pct: 40 },
    });
    expect(offenders).toHaveLength(4);
  });

  it("handles missing axes by treating them as 0 (offender)", () => {
    const offenders = evaluateCoverageEntry("apps/api/src/x.ts", {} as never);
    expect(offenders).toHaveLength(4);
  });
});

describe("loadCoverageSummary", () => {
  it("returns null when file missing", () => {
    expect(loadCoverageSummary(join(tmpdir(), "no-such-cov.json"))).toBeNull();
  });

  it("returns parsed object when file valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-cov-"));
    const p = join(dir, "coverage-summary.json");
    writeFileSync(
      p,
      JSON.stringify({
        total: {},
        "/abs/apps/api/src/x.ts": {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
      }),
    );
    const out = loadCoverageSummary(p);
    expect(out).not.toBeNull();
    expect(Object.keys(out as object)).toContain("/abs/apps/api/src/x.ts");
  });

  it("returns null on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-bad-cov-"));
    const p = join(dir, "coverage-summary.json");
    writeFileSync(p, "{not valid json}");
    expect(loadCoverageSummary(p)).toBeNull();
  });
});

describe("loadChangedFiles", () => {
  it("returns empty when path missing", () => {
    expect(loadChangedFiles(join(tmpdir(), "no-such.txt"))).toEqual([]);
  });

  it("trims + filters empty lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-ch-"));
    const p = join(dir, "ch.txt");
    writeFileSync(p, "  a.ts\n\n  b.ts\n");
    expect(loadChangedFiles(p)).toEqual(["a.ts", "b.ts"]);
  });
});

// ──────────────────────────────────────────────────────────────────
// run (in-process).
// ──────────────────────────────────────────────────────────────────

describe("run (in-process)", () => {
  it("exits 0 when no coverage-summary.json exists yet (e.g. first run)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-no-cov-"));
    let out = "";
    const code = await run({
      argv: ["--summary", "no-such.json", "--changed", "no-such.txt"],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/no coverage|skipped/i);
  });

  it("exits 0 when no changed file is in a strict package", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-non-strict-"));
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(
      cov,
      JSON.stringify({
        total: {},
        [join(dir, "packages/i18n/src/x.ts")]: {
          statements: { pct: 50 },
          branches: { pct: 50 },
          functions: { pct: 50 },
          lines: { pct: 50 },
        },
      }),
    );
    const ch = join(dir, "ch.txt");
    writeFileSync(ch, "packages/i18n/src/x.ts\n");
    const code = await run({
      argv: ["--summary", cov, "--changed", ch],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("exits 1 when a strict-package file fails any axis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-fail-"));
    mkdirSync(join(dir, "apps/api/src"), { recursive: true });
    const absPath = join(dir, "apps/api/src/x.ts");
    writeFileSync(absPath, "// stub");
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(
      cov,
      JSON.stringify({
        total: {},
        [absPath]: {
          statements: { pct: 100 },
          branches: { pct: 70 },
          functions: { pct: 100 },
          lines: { pct: 100 },
        },
      }),
    );
    const ch = join(dir, "ch.txt");
    writeFileSync(ch, "apps/api/src/x.ts\n");
    let err = "";
    const code = await run({
      argv: ["--summary", cov, "--changed", ch],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/branches.*70/);
  });
});

// ──────────────────────────────────────────────────────────────────
// CLI subprocess.
// ──────────────────────────────────────────────────────────────────

describe("lint-coverage-floor-per-phase (CLI)", () => {
  it("exits 0 with no args (no-op when coverage missing)", () => {
    const r = runLint(["--summary", "no-such.json"]);
    expect(r.code).toBe(0);
  });
});

describe("run additional edge cases", () => {
  it("exits 0 when summary exists but --changed is not supplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-no-changed-"));
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(cov, JSON.stringify({ total: {} }));
    let out = "";
    const code = await run({
      argv: ["--summary", cov],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/no changed files|skipped/i);
  });

  it("exits 1 with a clear message when strict file lacks any coverage entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-no-entry-"));
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(cov, JSON.stringify({ total: {} }));
    const ch = join(dir, "ch.txt");
    writeFileSync(ch, "apps/api/src/missing.ts\n");
    let err = "";
    const code = await run({
      argv: ["--summary", cov, "--changed", ch],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/no entry in coverage-summary/);
  });

  it("handles --summary and --changed without trailing values (no crash)", async () => {
    const code = await run({
      argv: ["--summary", "--changed"],
      cwd: "/tmp",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("ignores 'total' key when matching changed files to coverage entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcf-total-key-"));
    mkdirSync(join(dir, "apps/api/src"), { recursive: true });
    const absPath = join(dir, "apps/api/src/y.ts");
    writeFileSync(absPath, "// stub");
    const cov = join(dir, "coverage-summary.json");
    // The "total" key happens to live in the summary; it must be skipped
    // when looking for "apps/api/src/y.ts".
    writeFileSync(
      cov,
      JSON.stringify({
        total: {
          statements: { pct: 100 },
          branches: { pct: 100 },
          functions: { pct: 100 },
          lines: { pct: 100 },
        },
        [absPath]: {
          statements: { pct: 100 },
          branches: { pct: 100 },
          functions: { pct: 100 },
          lines: { pct: 100 },
        },
      }),
    );
    const ch = join(dir, "ch.txt");
    writeFileSync(ch, "apps/api/src/y.ts\n");
    const code = await run({
      argv: ["--summary", cov, "--changed", ch],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("matches a changed file via exact-key (not just suffix) in findCoverageEntry", async () => {
    // Exercise the `key === changedRel` branch by using a relative-style
    // path as the coverage-entry key.
    const dir = mkdtempSync(join(tmpdir(), "lcf-exact-key-"));
    mkdirSync(join(dir, "apps/api/src"), { recursive: true });
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(
      cov,
      JSON.stringify({
        total: {},
        // The key matches changedRel verbatim — exercise the `===` branch.
        "apps/api/src/k.ts": {
          statements: { pct: 100 },
          branches: { pct: 100 },
          functions: { pct: 100 },
          lines: { pct: 100 },
        },
      }),
    );
    const ch = join(dir, "ch.txt");
    writeFileSync(ch, "apps/api/src/k.ts\n");
    const code = await run({
      argv: ["--summary", cov, "--changed", ch],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("parseArgs --summary trailing without value preserves default", async () => {
    // Exercises the `argv[i+1] ?? summaryPath` nullish-coalesce branch.
    const code = await run({
      argv: ["--summary"],
      cwd: "/tmp",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("parseArgs --changed trailing without value preserves default", async () => {
    // Exercises the `argv[i+1] ?? changedPath` nullish-coalesce branch.
    const dir = mkdtempSync(join(tmpdir(), "lcf-bare-changed-"));
    const cov = join(dir, "coverage-summary.json");
    writeFileSync(cov, JSON.stringify({ total: {} }));
    const code = await run({
      argv: ["--summary", cov, "--changed"],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });
});
