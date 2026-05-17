// SPDX-License-Identifier: FSL-1.1-ALv2
//
// tests/e2e/lockers.test.ts — Phase 31 / Plan 31-07 (LOCKER-07/08/09).
//
// End-to-end gate that proves the six locker binaries (lint-no-env-branches,
// lint-no-suppressions, lint-no-hardcode, lint-prod-readiness,
// lint-secret-shape-in-error, lint-shell-credential-interpolation) refuse
// real violations when invoked exactly as lefthook + CI + Makefile invoke
// them — i.e. via `pnpm exec tsx tools/lint-<name>.ts <rootDir>` against a
// real filesystem fixture.
//
// Framework choice — vitest (NOT Playwright). The existing
// `tests/e2e/vitest.e2e.config.ts` discovers `tests/e2e/*.test.ts`; this
// file matches that glob so the suite runs alongside the other Phase 04 /
// Phase 06 e2e tests under `make e2e-test`. Per DISCIPLINE Rule 4 we spawn
// the REAL binary (no mocks of internal logic) via `child_process.execFileSync`,
// using zero new dependencies (research §Q13 / §A3).
//
// Two-bucket assertion set:
//
//   1. Six per-locker cases — each writes a known-violating fixture into a
//      `mkdtempSync(...)` scan-root, spawns the real binary against that root,
//      and asserts exit code + stderr regex. LOCKER-04 / -05 / -06 run WITHOUT
//      `--warn-only` so the assertion exercises the BLOCKING shape that
//      lefthook + nightly.yml invoke (per the plan: nightly is the early
//      warning channel and MUST exercise the BLOCKING form even when the
//      pre-commit script is WARN-only).
//
//   2. Two documentation-grep cases — assert that DISCIPLINE.md + CLAUDE.md
//      both contain Rules 11–14, closing the LOCKER-07 mirror invariant from
//      the test side.
//
// Bypass / coverage notes — the e2e suite exercises the binaries' top-level
// `main()` entry behaviour observable via stderr + exit code. The per-locker
// unit tests (where present: lint-no-suppressions.test.ts, lint-no-hardcode
// is missing on main but the binary is exercised here, etc.) own
// finer-grained internal coverage. This suite owns the integration contract.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * Run a locker binary against a scan-root via `pnpm exec tsx`. Returns
 * exit code + stderr exactly the way lefthook / CI observes them.
 */
function runLocker(
  scriptRelPath: string,
  rootDir: string,
  extraArgv: string[] = [],
): { code: number; stderr: string; stdout: string } {
  const scriptAbs = join(REPO_ROOT, scriptRelPath);
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", scriptAbs, ...extraArgv, rootDir], {
      cwd: REPO_ROOT,
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

/** Stage a single fixture file under apps/api/src/ inside a fresh scan-root. */
function stageFixture(content: string, fileName: string): string {
  const root = mkdtempSync(join(tmpdir(), "lockers-e2e-"));
  const dir = join(root, "apps", "api", "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content, "utf8");
  return root;
}

describe("LOCKER-08 — six locker binaries refuse violations end-to-end", () => {
  it("LOCKER-01 (lint-no-env-branches) — refuses NODE_ENV read in apps/**/src/**", () => {
    const root = stageFixture(
      'if (process.env.NODE_ENV === "production") { /* x */ }\n',
      "handler.ts",
    );
    const { code, stderr } = runLocker("tools/lint-no-env-branches.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/NODE_ENV-(read|compare)/);
  });

  it("LOCKER-02 (lint-no-suppressions) — refuses `as any` in apps/**/src/**", () => {
    const root = stageFixture("const x = (foo as any);\n", "bad.ts");
    const { code, stderr } = runLocker("tools/lint-no-suppressions.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/as-any/);
  });

  it("LOCKER-03 (lint-no-hardcode) — refuses hardcoded localhost+port", () => {
    const root = stageFixture('const URL_X = "http://localhost:3000";\n', "bad.ts");
    const { code, stderr } = runLocker("tools/lint-no-hardcode.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/localhost-string|port-literal/);
  });

  it("LOCKER-04 (lint-prod-readiness) — refuses Fastify route without schema/config (BLOCKING form)", () => {
    const root = stageFixture(
      'const app: any = {};\napp.route({ method: "POST", url: "/api/x", handler: () => {} });\n',
      "bad.ts",
    );
    // Invoke WITHOUT --warn-only so we exercise the BLOCKING shape; nightly.yml
    // invokes the binary in this form even though package.json's script-level
    // alias adds --warn-only during the Phase-31 landing window.
    const { code, stderr } = runLocker("tools/lint-prod-readiness.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/LOCKER-04-NO-SCHEMA|LOCKER-04-NO-RATELIMIT/);
  });

  it("LOCKER-05 (lint-secret-shape-in-error) — refuses untruncated bodyText on Error subclass (BLOCKING form)", () => {
    const root = stageFixture(
      [
        "export class UpstreamError extends Error {",
        "  public readonly bodyText: string;",
        "  constructor(msg: string, body: string) {",
        "    super(msg);",
        "    this.bodyText = body;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "errors.ts",
    );
    // Invoke WITHOUT --warn-only — nightly.yml invokes the BLOCKING form.
    const { code, stderr } = runLocker("tools/lint-secret-shape-in-error.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/secret-shape-in-error|bodyText/);
  });

  it("LOCKER-06 (lint-shell-credential-interpolation) — refuses bash -c credential interpolation (BLOCKING form)", () => {
    const root = stageFixture(
      [
        'import { spawn } from "node:child_process";',
        'const DATABASE_URL = "x";',
        'spawn("bash", ["-c", `pg_dump "${DATABASE_URL}"`]);',
        "",
      ].join("\n"),
      "audit.ts",
    );
    // Invoke WITHOUT --warn-only.
    const { code, stderr } = runLocker("tools/lint-shell-credential-interpolation.ts", root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/shell-credential-interpolation|DATABASE_URL/);
  });
});

describe("LOCKER-07 — DISCIPLINE Rules 11–14 mirrored to CLAUDE.md", () => {
  it("DISCIPLINE.md contains Rule 11 / 12 / 13 / 14 prose", () => {
    const text = readFileSync(join(REPO_ROOT, ".planning", "DISCIPLINE.md"), "utf8");
    expect(text).toMatch(/11\.\s+\*\*No NODE_ENV branches/);
    expect(text).toMatch(/12\.\s+\*\*No type-suppression/);
    expect(text).toMatch(/13\.\s+\*\*No hardcoded localhost/);
    expect(text).toMatch(/14\.\s+\*\*Production-readiness/);
  });

  it("CLAUDE.md mirrors Rules 11–14 verbatim under Engineering Discipline", () => {
    const text = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");
    expect(text).toMatch(/11\.\s+\*\*No NODE_ENV branches/);
    expect(text).toMatch(/12\.\s+\*\*No type-suppression/);
    expect(text).toMatch(/13\.\s+\*\*No hardcoded localhost/);
    expect(text).toMatch(/14\.\s+\*\*Production-readiness/);
  });
});
