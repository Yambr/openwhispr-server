// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 21 / Plan 21-03 / SR-21.3 — RED→GREEN tests for tools/lint-steps-have-unit-tests.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectStepFiles,
  lintBoundaryMocked,
  lintSiblingUnitTestExists,
  loadAllowlist,
  run,
} from "./lint-steps-have-unit-tests";

const SCRIPT = join(process.cwd(), "tools", "lint-steps-have-unit-tests.ts");

function runLint(args: string[]): { code: number; stderr: string; stdout: string } {
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

function makeRepo(): { dir: string; stepsDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "lsh-"));
  const stepsDir = join(dir, "tests", "e2e-cjm", "steps");
  mkdirSync(join(stepsDir, "__tests__"), { recursive: true });
  return { dir, stepsDir };
}

// ──────────────────────────────────────────────────────────────────
// Pure-function tests.
// ──────────────────────────────────────────────────────────────────

describe("loadAllowlist", () => {
  it("returns the empty set when no allowlist file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-noalw-"));
    const out = loadAllowlist(join(dir, "no.txt"));
    expect(out.size).toBe(0);
  });

  it("strips comments + blanks; trims whitespace", () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-alw-"));
    const path = join(dir, "alw.txt");
    writeFileSync(
      path,
      ["# comment", "", "  a/b/c.steps.ts  ", "d/e.steps.ts", "# trailing"].join("\n"),
    );
    const out = loadAllowlist(path);
    expect(out.size).toBe(2);
    expect(out.has("a/b/c.steps.ts")).toBe(true);
    expect(out.has("d/e.steps.ts")).toBe(true);
  });
});

describe("collectStepFiles", () => {
  it("returns empty when steps dir does not exist", () => {
    expect(collectStepFiles(join(tmpdir(), "definitely-not-here-lsh"))).toEqual([]);
  });

  it("collects *.steps.ts files; excludes __tests__ directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-collect-"));
    mkdirSync(join(dir, "__tests__"), { recursive: true });
    writeFileSync(join(dir, "a.steps.ts"), "");
    writeFileSync(join(dir, "b.steps.ts"), "");
    writeFileSync(join(dir, "__tests__", "a.test.ts"), "");
    writeFileSync(join(dir, "ignored.ts"), "");
    const out = collectStepFiles(dir);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.endsWith(".steps.ts"))).toBe(true);
  });

  it("recurses into subdirectories that are NOT __tests__ / node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-collect-nested-"));
    mkdirSync(join(dir, "deep", "deeper"), { recursive: true });
    writeFileSync(join(dir, "deep", "deeper", "nested.steps.ts"), "");
    const out = collectStepFiles(dir);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/nested\.steps\.ts$/);
  });
});

describe("run argv edge cases", () => {
  it("handles --allowlist with no following value (default applies)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-bare-alw-"));
    const code = await run({
      argv: ["--allowlist", "--steps-dir", "no-such"],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });

  it("handles --steps-dir with no following value (default applies)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-bare-sd-"));
    const code = await run({
      argv: ["--steps-dir"],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });
});

describe("lintSiblingUnitTestExists", () => {
  it("flags step files without a sibling __tests__/<name>.test.ts", () => {
    const { stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "missing.steps.ts"), "// no buddy");
    const offenders = lintSiblingUnitTestExists([join(stepsDir, "missing.steps.ts")], new Set());
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/sibling.*missing\.steps\.test\.ts/i);
  });

  it("accepts step files that have a sibling unit test", () => {
    const { stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "ok.steps.ts"), "// has buddy");
    writeFileSync(join(stepsDir, "__tests__", "ok.steps.test.ts"), "// unit");
    const offenders = lintSiblingUnitTestExists([join(stepsDir, "ok.steps.ts")], new Set());
    expect(offenders).toEqual([]);
  });

  it("accepts an alternative `<name>.test.ts` location (no .steps. suffix) for legacy files", () => {
    const { stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "tls.steps.ts"), "// has legacy buddy");
    writeFileSync(join(stepsDir, "__tests__", "tls-cert-paths.test.ts"), "// legacy unit");
    // The strict rule requires `tls.steps.test.ts`; this scenario produces
    // an offender. Allowlist is the escape hatch for legacy files.
    const offenders = lintSiblingUnitTestExists([join(stepsDir, "tls.steps.ts")], new Set());
    expect(offenders).toHaveLength(1);
  });

  it("respects the allowlist", () => {
    const { stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "allowed.steps.ts"), "// in list");
    const allow = new Set([join(stepsDir, "allowed.steps.ts")]);
    const offenders = lintSiblingUnitTestExists([join(stepsDir, "allowed.steps.ts")], allow);
    expect(offenders).toEqual([]);
  });
});

describe("lintBoundaryMocked", () => {
  it("flags unit-test files that cross HTTP but mock no boundary", () => {
    const body = [
      "import { describe, it, expect } from 'vitest';",
      "describe('a', () => {",
      "  it('hits real api', async () => {",
      "    const r = await fetch('https://api.example.com/x');",
      "    expect(r.ok).toBe(true);",
      "  });",
      "});",
    ].join("\n");
    const offenders = lintBoundaryMocked(new Map([["a.steps.test.ts", body]]), new Map());
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/HTTP boundary/i);
  });

  it("does NOT flag pure-function tests (no HTTP surface at all)", () => {
    // tls-cert-paths.test.ts pattern: tests a regex helper, no fetch.
    const body = [
      "import { describe, it, expect } from 'vitest';",
      "import { DEV_CA_PATTERN } from '../tls-cert-paths.js';",
      "describe('pure', () => { it('regex', () => expect(DEV_CA_PATTERN.test('a')).toBe(false)); });",
    ].join("\n");
    expect(lintBoundaryMocked(new Map([["pure.test.ts", body]]), new Map())).toEqual([]);
  });

  it("accepts HTTP-touching files that import vi.spyOn", () => {
    const tests = new Map([
      [
        "ok.test.ts",
        "import { vi } from 'vitest';\nvi.spyOn(globalThis, 'fetch');\nfetch('/x');\n",
      ],
    ]);
    expect(lintBoundaryMocked(tests, new Map())).toEqual([]);
  });

  it("accepts files that import nock or msw or contain mockFetch", () => {
    for (const body of [
      "import nock from 'nock';\nnock('https://api').get('/x').reply(200);\nfetch('/x');\n",
      "import { setupServer } from 'msw/node';\nsetupServer();\nfetch('/x');\n",
      "const mockFetch = vi.fn();\nfetch('/x');\n",
    ]) {
      const tests = new Map([["ok.test.ts", body]]);
      expect(lintBoundaryMocked(tests, new Map())).toEqual([]);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// run (in-process)
// ──────────────────────────────────────────────────────────────────

describe("run unit-dir variations", () => {
  it("ignores non-.test.ts files in __tests__/", async () => {
    const { dir, stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "ok.steps.ts"), "// has buddy");
    writeFileSync(join(stepsDir, "__tests__", "ok.steps.test.ts"), "// pure helper");
    // The noise file MUST be ignored — only *.test.ts files are loaded.
    writeFileSync(join(stepsDir, "__tests__", "notes.md"), "# scratch");
    writeFileSync(join(stepsDir, "__tests__", "fixtures.json"), "{}");
    let out = "";
    const code = await run({
      argv: ["--steps-dir", "tests/e2e-cjm/steps", "--allowlist", "no-such"],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/1 unit test/);
  });
});

describe("run (in-process)", () => {
  it("exits 0 on an empty steps dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsh-empty-"));
    let out = "";
    const code = await run({
      argv: ["--steps-dir", "no-such", "--allowlist", "no-such"],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/passed/i);
  });

  it("exits 1 when a fresh step file has no sibling test", async () => {
    const { dir, stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "fresh.steps.ts"), "// no buddy");
    let err = "";
    const code = await run({
      argv: ["--steps-dir", "tests/e2e-cjm/steps", "--allowlist", "no-such"],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/fresh\.steps\.test\.ts/);
  });

  it("exits 0 when the fresh step is on the allowlist", async () => {
    const { dir, stepsDir } = makeRepo();
    writeFileSync(join(stepsDir, "fresh.steps.ts"), "// no buddy");
    const allowPath = join(dir, "allow.txt");
    writeFileSync(allowPath, "tests/e2e-cjm/steps/fresh.steps.ts\n");
    let out = "";
    const code = await run({
      argv: ["--steps-dir", "tests/e2e-cjm/steps", "--allowlist", "allow.txt"],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/passed/i);
  });
});

// ──────────────────────────────────────────────────────────────────
// CLI subprocess
// ──────────────────────────────────────────────────────────────────

describe("lint-steps-have-unit-tests (CLI)", () => {
  it("exits 0 against the in-repo tree (sanity, with default allowlist)", () => {
    const r = runLint([]);
    expect(r.code).toBe(0);
  });
});
