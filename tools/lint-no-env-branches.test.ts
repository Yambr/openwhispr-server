// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-env-branches.test.ts — RED→GREEN coverage for the
 * NODE_ENV-branch regression guard (Phase 31 / Plan 01 — LOCKER-01).
 *
 * The locker scans `apps/**\/src/**` and `packages/**\/src/**` TypeScript
 * sources for two forbidden patterns: `process.env.NODE_ENV` reads and
 * `NODE_ENV ===|!==` comparisons. Boundary files (`bootstrap.ts`,
 * `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`) are exempt by IGNORE,
 * and per-line entries in `tools/lint-no-env-branches.allowlist.txt`
 * (POSIX `file:line` keys) suppress documented legacy violations.
 *
 * Fixtures at `tools/lint-no-env-branches/fixtures/**` are reference
 * samples. Tests synthesise a temp tree (`apps/api/src/<fixture>`) so
 * the linter's real glob root path matches `apps/**\/src/**`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOWLIST_FILE, findViolations, main, readAllowlist } from "./lint-no-env-branches.js";

let root: string;

const FIXTURE_DIR = resolve(__dirname, "lint-no-env-branches/fixtures");

function loadFixture(rel: string): string {
  return readFileSync(join(FIXTURE_DIR, rel), "utf8");
}

function touch(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-no-env-branches-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findViolations", () => {
  it("F1: clean fixture under apps/**/src → zero violations", async () => {
    touch("apps/api/src/clean.ts", loadFixture("clean.ts"));
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F2: violates fixture flags NODE_ENV-read AND NODE_ENV-compare labels", async () => {
    touch("apps/api/src/violates.ts", loadFixture("violates.ts"));
    const violations = await findViolations(root);
    const labels = new Set(violations.map((v) => v.label));
    expect(labels.has("NODE_ENV-read")).toBe(true);
    expect(labels.has("NODE_ENV-compare")).toBe(true);
    // At minimum one read + one compare = 2 findings (the `process.env.NODE_ENV ===`
    // line matches both regexes → 2 violations on that line, plus the
    // NODE_ENV !== line → 1 violation. Total >= 3.).
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });

  it("F3: bootstrap.ts (allowlisted by IGNORE) → zero violations even with NODE_ENV read", async () => {
    touch("apps/api/src/bootstrap.ts", loadFixture("allowlisted/bootstrap.ts"));
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F3b: config/*.ts is IGNORE-skipped", async () => {
    touch(
      "apps/api/src/config/runtime.ts",
      "export const m = process.env.NODE_ENV ?? 'development';\n",
    );
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F3c: otel-bootstrap.ts is IGNORE-skipped", async () => {
    touch(
      "apps/api/src/otel-bootstrap.ts",
      "if (process.env.NODE_ENV === 'production') { /* ok */ }\n",
    );
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F3d: *.config.ts is IGNORE-skipped", async () => {
    touch("apps/api/src/vitest.config.ts", "export const x = process.env.NODE_ENV === 'test';\n");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F4: node_modules is NOT scanned", async () => {
    touch(
      "apps/api/src/node_modules/foo/index.ts",
      "if (process.env.NODE_ENV === 'production') {}\n",
    );
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F4b: dist + .next + coverage + __test paths are NOT scanned", async () => {
    const dirty = "if (process.env.NODE_ENV === 'production') {}\n";
    touch("apps/api/src/dist/x.ts", dirty);
    touch("apps/web/src/.next/y.ts", dirty);
    touch("apps/api/src/coverage/z.ts", dirty);
    touch("apps/api/src/__test/foo.ts", dirty);
    touch("apps/api/src/__tests__/foo.ts", dirty);
    touch("apps/api/src/foo.test.ts", dirty);
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F5: packages/**/src is scanned (parity with apps/**/src)", async () => {
    touch("packages/email/src/index.ts", "if (env.NODE_ENV === 'production') return null;\n");
    const violations = await findViolations(root);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]?.file).toBe("packages/email/src/index.ts");
    expect(violations[0]?.label).toBe("NODE_ENV-compare");
  });

  it("F6: per-line allowlist entry (file:line) suppresses violations at that line only", async () => {
    touch(
      "apps/api/src/index.ts",
      // line 1 — read (allowlisted below)
      "const a = process.env.NODE_ENV;\n" +
        // line 2 — read (NOT allowlisted → must flag)
        "const b = process.env.NODE_ENV;\n",
    );
    touch(ALLOWLIST_FILE, "apps/api/src/index.ts:1  # issue-test-allowlisted\n");
    const violations = await findViolations(root);
    expect(violations.length).toBe(1);
    expect(violations[0]?.lineNumber).toBe(2);
  });

  it("F7: violations sorted by file then by lineNumber then by label", async () => {
    touch(
      "apps/b/src/x.ts",
      "if (process.env.NODE_ENV === 'production') {}\nconst y = process.env.NODE_ENV;\n",
    );
    touch("apps/a/src/x.ts", "const z = process.env.NODE_ENV;\n");
    const violations = await findViolations(root);
    expect(violations.map((v) => `${v.file}:${v.lineNumber}:${v.label}`)).toEqual([
      "apps/a/src/x.ts:1:NODE_ENV-read",
      "apps/b/src/x.ts:1:NODE_ENV-compare",
      "apps/b/src/x.ts:1:NODE_ENV-read",
      "apps/b/src/x.ts:2:NODE_ENV-read",
    ]);
  });
});

describe("readAllowlist", () => {
  it("R1: returns empty Set when allowlist file does not exist", () => {
    expect(readAllowlist(root).size).toBe(0);
  });

  it("R2: strips `#` comments and blank lines; preserves trimmed `file:line` keys with inline trailing comments stripped", () => {
    touch(
      ALLOWLIST_FILE,
      "# header\n\napps/api/src/index.ts:494  # issue-31-debt-NODE_ENV-shortcircuit\n  apps/api/src/index.ts:498  \n# trailing comment\n",
    );
    const set = readAllowlist(root);
    expect([...set].sort()).toEqual(["apps/api/src/index.ts:494", "apps/api/src/index.ts:498"]);
  });

  it("R3: returns a fresh empty Set per call when allowlist absent", () => {
    const a = readAllowlist(root);
    const b = readAllowlist(root);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
    expect(a).not.toBe(b);
  });
});

describe("main — CLI dispatch + exit codes", () => {
  it("M1: returns 1 on dirty tree and writes per-file summary to stderr", async () => {
    touch("apps/api/src/x.ts", "if (process.env.NODE_ENV === 'production') {}\n");
    const chunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      chunks.push(typeof c === "string" ? c : String(c));
      return true;
    });
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(1);
    // Stderr format: `file:line  label  remediation`.
    const joined = chunks.join("");
    expect(joined).toMatch(/apps\/api\/src\/x\.ts:1/);
    expect(joined).toMatch(/NODE_ENV-(read|compare)/);
    expect(joined).toMatch(/bootstrap\.ts|config\/\*\.ts|inject via DI|thread the resolved mode/);
  });

  it("M2: returns 0 on clean tree", async () => {
    touch("apps/api/src/clean.ts", loadFixture("clean.ts"));
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main([root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("M3: defaults rootDir to process.cwd() when argv is empty", async () => {
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    // Either clean (0) or dirty (1) is acceptable; cwd is the worktree.
    expect([0, 1]).toContain(code);
  });

  it("M4: returns 2 and writes to stderr when findViolations throws", async () => {
    // Force readAllowlist (called via findViolations) to throw EISDIR by
    // placing a directory at the allowlist path.
    mkdirSync(join(root, ALLOWLIST_FILE), { recursive: true });
    const chunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      chunks.push(typeof c === "string" ? c : String(c));
      return true;
    });
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(2);
    expect(chunks.join("")).toMatch(/lint-no-env-branches:/);
  });
});
