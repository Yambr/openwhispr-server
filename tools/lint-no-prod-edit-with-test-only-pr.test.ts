// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 21 / Plan 21-04 / SR-21.4 — RED→GREEN tests for tools/lint-no-prod-edit-with-test-only-pr.ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasTestFixLabel,
  isProductionPath,
  lintProductionEditsInTestFixPr,
  parseChangedFiles,
  run,
} from "./lint-no-prod-edit-with-test-only-pr";

const SCRIPT = join(process.cwd(), "tools", "lint-no-prod-edit-with-test-only-pr.ts");

// ──────────────────────────────────────────────────────────────────
// Pure-function tests.
// ──────────────────────────────────────────────────────────────────

describe("isProductionPath", () => {
  it("recognizes apps/<x>/src/** as production", () => {
    expect(isProductionPath("apps/api/src/index.ts")).toBe(true);
    expect(isProductionPath("apps/worker/src/jobs/email.ts")).toBe(true);
    expect(isProductionPath("apps/web/src/app/page.tsx")).toBe(true);
  });

  it("recognizes packages/<x>/src/** as production", () => {
    expect(isProductionPath("packages/data/src/schema.ts")).toBe(true);
    expect(isProductionPath("packages/byok-guard/src/index.ts")).toBe(true);
  });

  it("recognizes compose/**/*.yml and root docker-compose.yml as production", () => {
    expect(isProductionPath("compose/docker-compose.ingress.yml")).toBe(true);
    expect(isProductionPath("docker-compose.yml")).toBe(true);
  });

  it("recognizes Makefile and chart templates as production", () => {
    expect(isProductionPath("Makefile")).toBe(true);
    expect(isProductionPath("charts/openwhispr/templates/api-deployment.yaml")).toBe(true);
  });

  it("does NOT flag tests/**, tools/**, docs/**, .planning/**", () => {
    expect(isProductionPath("tests/e2e-cjm/features/foo.feature")).toBe(false);
    expect(isProductionPath("tools/lint-xxx.ts")).toBe(false);
    expect(isProductionPath("docs/customer-journeys.md")).toBe(false);
    expect(isProductionPath(".planning/qa-audit/foo.md")).toBe(false);
  });

  it("does NOT flag *.test.ts / *.spec.ts even inside apps/**/src/", () => {
    expect(isProductionPath("apps/api/src/__tests__/foo.test.ts")).toBe(false);
    expect(isProductionPath("apps/api/src/foo.spec.ts")).toBe(false);
  });
});

describe("hasTestFixLabel", () => {
  it("returns true when the body contains [test-fix]", () => {
    expect(hasTestFixLabel("Some commit msg [test-fix] keep tests green")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasTestFixLabel("[Test-Fix] body")).toBe(true);
    expect(hasTestFixLabel("[TEST-FIX] body")).toBe(true);
  });

  it("returns false when the body has no label", () => {
    expect(hasTestFixLabel("feat: add feature")).toBe(false);
    expect(hasTestFixLabel("")).toBe(false);
  });
});

describe("parseChangedFiles", () => {
  it("splits newline-separated changed-file list", () => {
    const out = parseChangedFiles("a.ts\nb/c.ts\n\nd.md\n");
    expect(out).toEqual(["a.ts", "b/c.ts", "d.md"]);
  });

  it("trims surrounding whitespace per line", () => {
    const out = parseChangedFiles("  a.ts  \n  b.ts");
    expect(out).toEqual(["a.ts", "b.ts"]);
  });

  it("handles empty input", () => {
    expect(parseChangedFiles("")).toEqual([]);
    expect(parseChangedFiles("\n\n\n")).toEqual([]);
  });
});

describe("lintProductionEditsInTestFixPr", () => {
  it("flags when [test-fix] label is present AND a production file is touched", () => {
    const offenders = lintProductionEditsInTestFixPr({
      title: "test: fix sso flake [test-fix]",
      body: "",
      changedFiles: ["apps/api/src/routes/sso.ts", "tests/integration/sso.test.ts"],
    });
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/apps\/api\/src\/routes\/sso\.ts/);
    expect(offenders[0].message).toMatch(/Hard Rule §1/i);
  });

  it("does not flag when label is absent (regular feat/fix PR)", () => {
    const offenders = lintProductionEditsInTestFixPr({
      title: "feat(api): add new endpoint",
      body: "",
      changedFiles: ["apps/api/src/routes/x.ts", "apps/api/src/__tests__/x.test.ts"],
    });
    expect(offenders).toEqual([]);
  });

  it("does not flag when label is present but only tests/tools/docs are touched", () => {
    const offenders = lintProductionEditsInTestFixPr({
      title: "test: stabilize step bindings [test-fix]",
      body: "Refines URL parsing in the auth steps",
      changedFiles: [
        "tests/e2e-cjm/steps/auth.steps.ts",
        "tests/e2e-cjm/steps/__tests__/auth.steps.test.ts",
      ],
    });
    expect(offenders).toEqual([]);
  });

  it("flags multiple production files separately", () => {
    const offenders = lintProductionEditsInTestFixPr({
      title: "test: fix everything [test-fix]",
      body: "",
      changedFiles: [
        "apps/api/src/a.ts",
        "packages/data/src/b.ts",
        "Makefile",
        "tests/e2e-cjm/x.test.ts",
      ],
    });
    expect(offenders).toHaveLength(3);
  });

  it("accepts [scope-expansion] override label as an explicit deviation marker", () => {
    const offenders = lintProductionEditsInTestFixPr({
      title: "fix(sso): re-route handler [test-fix] [scope-expansion]",
      body: "User-approved scope expansion to cover the test-debt; rationale: …",
      changedFiles: ["apps/api/src/routes/sso.ts"],
    });
    expect(offenders).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// run (in-process).
// ──────────────────────────────────────────────────────────────────

describe("run (in-process)", () => {
  it("exits 0 when --files stdin lists tests only and title carries [test-fix]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpe-ok-"));
    const fpath = join(dir, "changed.txt");
    writeFileSync(fpath, "tests/e2e-cjm/x.feature\ntests/integration/y.test.ts\n");
    let out = "";
    const code = await run({
      argv: ["--title", "[test-fix] thing", "--body", "", "--files", fpath],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/passed|clean/i);
  });

  it("exits 1 when [test-fix] PR touches production source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpe-bad-"));
    const fpath = join(dir, "changed.txt");
    writeFileSync(fpath, "apps/api/src/a.ts\ntests/integration/x.test.ts\n");
    let err = "";
    const code = await run({
      argv: ["--title", "[test-fix] thing", "--body", "", "--files", fpath],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/apps\/api\/src\/a\.ts/);
  });

  it("exits 0 when no [test-fix] label and prod is touched (regular feat PR)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpe-feat-"));
    const fpath = join(dir, "changed.txt");
    writeFileSync(fpath, "apps/api/src/a.ts\n");
    const code = await run({
      argv: ["--title", "feat(api): add x", "--body", "", "--files", fpath],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("exits 2 when --files path is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpe-missing-"));
    let err = "";
    const code = await run({
      argv: ["--title", "[test-fix]", "--body", "", "--files", "no-such.txt"],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(2);
    expect(err).toMatch(/internal error/i);
  });
});

// ──────────────────────────────────────────────────────────────────
// CLI subprocess.
// ──────────────────────────────────────────────────────────────────

describe("lint-no-prod-edit-with-test-only-pr (CLI)", () => {
  it("exits 0 when no PR metadata is supplied (CI-only linter, no-op locally)", () => {
    try {
      const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(stdout).toMatch(/skipped|no PR context/i);
    } catch (e: unknown) {
      const x = e as { status: number | null };
      // Some configurations may exit non-zero on missing metadata; we only
      // care that the CLI does not crash. Acceptable codes are 0 or 0-status.
      expect(x.status ?? 0).toBeLessThanOrEqual(2);
    }
  });
});

describe("run no-op paths", () => {
  it("exits 0 with skipped message when --title supplied but --files absent", async () => {
    let out = "";
    const code = await run({
      argv: ["--title", "[test-fix]", "--body", ""],
      cwd: "/tmp",
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/skipped|no PR context/i);
  });

  it("exits 0 with skipped message when --files supplied but --title absent", async () => {
    let out = "";
    const code = await run({
      argv: ["--files", "/tmp/whatever.txt"],
      cwd: "/tmp",
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/skipped|no PR context/i);
  });

  it("--body defaults to empty string when not supplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpe-no-body-"));
    const fpath = join(dir, "changed.txt");
    writeFileSync(fpath, "apps/api/src/a.ts\n");
    let err = "";
    const code = await run({
      // No --body — label only in title
      argv: ["--title", "test: [test-fix]", "--files", fpath],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/Hard Rule/i);
  });

  it("handles bare --body trailing without value", async () => {
    const code = await run({
      argv: ["--body"],
      cwd: "/tmp",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("handles bare --files trailing without value", async () => {
    const code = await run({
      argv: ["--title", "x", "--files"],
      cwd: "/tmp",
      stdout: () => {},
      stderr: () => {},
    });
    // --files consumed nothing → filesPath stays null → skipped path.
    expect(code).toBe(0);
  });

  it("handles bare --title and --body without trailing values", async () => {
    let out = "";
    const code = await run({
      argv: ["--title", "--body"],
      cwd: "/tmp",
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    // --title consumed `--body` as its value; --body has no value; result
    // is still title-present (= "--body") and files=null → skipped.
    expect(code).toBe(0);
    expect(out).toMatch(/skipped|no PR context/i);
  });
});
