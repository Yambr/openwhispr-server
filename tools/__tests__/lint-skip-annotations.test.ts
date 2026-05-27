// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-skip-annotations.test.ts — Quick 260527-pj6.
 *
 * RED-then-GREEN unit tests for the SKIP-REASON annotation lint
 * (`tools/lint-skip-annotations.ts`).
 *
 * Style mirrors `tools/__tests__/lint-no-plaintext-secret-columns.test.ts`.
 *
 * F-cases (PLAN scope item 15 / section 5):
 *   F1 — annotated `.skip` (marker on immediately-above line) → no violation
 *   F2 — annotated `.skip` (marker 5 lines above, the boundary) → no violation
 *   F3 — annotated `.skip` (marker 6 lines above, outside window) → violation
 *   F4 — un-annotated `.skip` → violation
 *   F5 — `// SKIP-REASON: short` (< 10 chars) → violation
 *   F6 — `.todo` annotated → no violation
 *   F7 — `.todo` un-annotated → violation
 *   F8 — comment containing `describe.skip` (no real call) → NOT matched
 *   F9 — `xit(...)` / `xdescribe(...)` un-annotated → violation
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLint, runMain, scanFile } from "../lint-skip-annotations.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-skip-annotations-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): string {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

describe("scanFile — F1 annotated .skip immediately above", () => {
  it("does not flag .skip when annotation is on the line above", () => {
    const f = touch(
      "apps/api/tests/foo.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  // SKIP-REASON: requires-docker — testcontainers needed",
        "  it.skip('x', () => {});",
        "});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — F2 annotated .skip at 5-line boundary", () => {
  it("does not flag when SKIP-REASON sits exactly 5 lines above", () => {
    // call on line 7 (index 6); annotation on line 2 (index 1).
    const lines = [
      "import { describe, it } from 'vitest';",
      "// SKIP-REASON: boundary case — 5 lines above the call",
      "// line 3 blank",
      "// line 4 blank",
      "// line 5 blank",
      "describe('outer', () => {",
      "  it.skip('x', () => {});",
      "});",
    ];
    const f = touch("packages/data/tests/boundary.test.ts", lines.join("\n"));
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — F3 annotation outside the 5-line window", () => {
  it("flags .skip when SKIP-REASON is 6 lines above", () => {
    // call on line 8 (index 7); annotation on line 2 (index 1) → gap is 6.
    const lines = [
      "import { describe, it } from 'vitest';",
      "// SKIP-REASON: too far away — 6 lines above the call",
      "// line 3 blank",
      "// line 4 blank",
      "// line 5 blank",
      "// line 6 blank",
      "describe('outer', () => {",
      "  it.skip('x', () => {});",
      "});",
    ];
    const f = touch("apps/api/tests/outside.test.ts", lines.join("\n"));
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.callee).toBe("it.skip");
    expect(v[0]?.reason).toBe("missing");
  });
});

describe("scanFile — F4 un-annotated .skip", () => {
  it("flags .skip with no SKIP-REASON anywhere above", () => {
    const f = touch(
      "apps/api/tests/bare.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('x', () => {});",
        "});",
      ].join("\n"),
    );
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.callee).toBe("it.skip");
    expect(v[0]?.reason).toBe("missing");
  });
});

describe("scanFile — F5 SKIP-REASON body shorter than 10 chars", () => {
  it("flags `SKIP-REASON: short` as too-short", () => {
    const f = touch(
      "apps/api/tests/short-reason.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  // SKIP-REASON: tooshort",
        "  it.skip('x', () => {});",
        "});",
      ].join("\n"),
    );
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("too-short");
  });
});

describe("scanFile — F6 annotated .todo", () => {
  it("does not flag .todo when SKIP-REASON is present", () => {
    const f = touch(
      "apps/api/tests/todo-ok.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  // SKIP-REASON: deferred-fix issue-12345 — TODO real reason",
        "  it.todo('x');",
        "});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — F7 un-annotated .todo", () => {
  it("flags .todo with no SKIP-REASON above", () => {
    const f = touch(
      "apps/api/tests/todo-bare.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.todo('placeholder');",
        "});",
      ].join("\n"),
    );
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.callee).toBe("it.todo");
    expect(v[0]?.reason).toBe("missing");
  });
});

describe("scanFile — F8 comment-only `describe.skip` mention", () => {
  it("does NOT match `// describe.skip from beforeAll` (no real call)", () => {
    const f = touch(
      "apps/api/tests/comment-only.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "// describe.skip from beforeAll() guards parity tests in this file",
        "describe('runs cleanly', () => {",
        "  it('passes', () => {});",
        "});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — F9 xit and xdescribe bare callees", () => {
  it("flags un-annotated `xit(...)` and `xdescribe(...)` as violations", () => {
    const f = touch(
      "apps/api/tests/xit-xdescribe.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  xit('legacy bdd style', () => {});",
        "});",
        "xdescribe('legacy bdd suite', () => {});",
      ].join("\n"),
    );
    const v = scanFile(f);
    // 2 violations: xit + xdescribe, neither annotated.
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.callee).sort()).toEqual(["xdescribe", "xit"]);
    for (const violation of v) {
      expect(violation.reason).toBe("missing");
    }
  });

  it("accepts xit when SKIP-REASON is in the lookback window", () => {
    const f = touch(
      "apps/api/tests/xit-ok.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  // SKIP-REASON: legacy bdd — migrating to it.todo in Phase 99",
        "  xit('legacy bdd style', () => {});",
        "});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — defensive coverage for nested .skip + describe.skip", () => {
  it("flags top-level describe.skip independently from nested it.skip", () => {
    const f = touch(
      "apps/api/tests/nested.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe.skip('outer suite, all sub-tests off', () => {",
        "  it('inner', () => {});",
        "});",
      ].join("\n"),
    );
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.callee).toBe("describe.skip");
  });
});

describe("runLint — full glob walk against synthetic root", () => {
  it("exits clean on a tree with no skip sites", () => {
    touch(
      "apps/api/tests/clean.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it('inner', () => {}); });",
      ].join("\n"),
    );
    expect(runLint(root)).toEqual([]);
  });

  it("collects violations sorted by file:line", () => {
    touch(
      "apps/api/tests/a.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('first', () => {}); });",
      ].join("\n"),
    );
    touch(
      "packages/data/tests/b.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('second', () => {}); });",
      ].join("\n"),
    );
    const v = runLint(root);
    expect(v.map((x) => x.file)).toEqual([
      "apps/api/tests/a.test.ts",
      "packages/data/tests/b.test.ts",
    ]);
  });

  it("skips node_modules, dist, .stryker-tmp, .next, .claude/worktrees", () => {
    touch(
      "node_modules/some-pkg/tests/a.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('vendor', () => { it.skip('x', () => {}); });",
      ].join("\n"),
    );
    touch(
      ".stryker-tmp/sandbox/apps/api/tests/x.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('mutant', () => { it.skip('x', () => {}); });",
      ].join("\n"),
    );
    expect(runLint(root)).toEqual([]);
  });

  it("self-exempts tools/lint-skip-annotations.ts even if it contains a .skip", () => {
    // The self-exempt path lives outside the SCAN_PATTERNS in any
    // case (tools/ is not under apps/packages/tests in the glob set),
    // so a fixture file under tools/ would not be picked up.
    // Sanity check by writing a synthetic tools/ fixture that the
    // walker would NOT scan even without the SELF_EXEMPT guard.
    touch(
      "tools/lint-skip-annotations.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('fixture', () => { it.skip('x', () => {}); });",
      ].join("\n"),
    );
    expect(runLint(root)).toEqual([]);
  });
});

describe("runMain — exit codes and stderr shape", () => {
  it("returns 0 on a clean root", () => {
    touch(
      "apps/api/tests/clean.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it('inner', () => {}); });",
      ].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("PASSED");
    expect(err.join("")).toBe("");
  });

  it("returns 1 with per-line stderr on violations", () => {
    touch(
      "apps/api/tests/bare.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('x', () => {}); });",
      ].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    const stderr = err.join("");
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain("apps/api/tests/bare.test.ts");
    expect(stderr).toContain("it.skip");
    expect(stderr).toContain("missing // SKIP-REASON");
    expect(stderr).toContain("remediation");
  });

  it("includes the too-short reason marker in stderr", () => {
    touch(
      "apps/api/tests/short.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "// SKIP-REASON: nope",
        "it.skip('x', () => {});",
      ].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("body too short");
  });

  it("returns 2 when runLint throws an internal error (unreadable root)", () => {
    // Stub stderr/stdout to capture output.
    const out: string[] = [];
    const err: string[] = [];
    // Pass a non-existent path that will still pass the read guard
    // (globSync returns []) but use the inner `runLint` for direct
    // exception coverage. We monkey-patch by passing a deliberately
    // broken root that causes globSync to throw via a non-string.
    const code = runMain({
      // node:fs.globSync throws TypeError on non-string input — exercises
      // the catch branch in runMain.
      root: 12345 as unknown as string,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("internal error");
  });
});

describe("scanFile — defensive coverage for unreadable file", () => {
  it("returns [] when the file cannot be read", () => {
    const v = scanFile(join(root, "does-not-exist.ts"));
    expect(v).toEqual([]);
  });
});

describe("scanFile — non-skip call shapes do not flag", () => {
  it("does not match `it.concurrent(...)` (concurrent !== skip)", () => {
    const f = touch(
      "apps/api/tests/concurrent.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.concurrent('x', () => {});",
        "});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });

  it("does not match `foo.skip(...)` (foo not in {it,test,describe})", () => {
    const f = touch(
      "apps/api/tests/foo-skip.test.ts",
      ["const foo = { skip: (..._args: unknown[]) => {} };", "foo.skip('x', () => {});"].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });

  it("does not match a bare `skip()` call (no host)", () => {
    const f = touch(
      "apps/api/tests/bare-skip.test.ts",
      ["function skip(_x: string) {}", "skip('not a test skip');"].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });

  it("does not match `xtest(...)` (not in {xit, xdescribe})", () => {
    const f = touch(
      "apps/api/tests/xtest.test.ts",
      [
        "declare function xtest(name: string, body: () => void): void;",
        "xtest('not a recognised bdd alias', () => {});",
      ].join("\n"),
    );
    expect(scanFile(f)).toEqual([]);
  });
});

describe("scanFile — call near top of file (callLine < lookback window)", () => {
  it("flags un-annotated .skip on line 1 without crashing on the truncated window", () => {
    const f = touch("apps/api/tests/top-of-file.test.ts", "it.skip('x', () => {});\n");
    const v = scanFile(f);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });
});

describe("checkAnnotation — direct unit-test for defensive branches", () => {
  it("returns missing when lookback window is empty (callLine=0)", async () => {
    const mod = await import("../lint-skip-annotations.js");
    expect(mod.checkAnnotation(["it.skip('x', () => {});"], 0)).toBe("missing");
  });

  it("handles undefined-typed lookback entry via the ?? '' guard", async () => {
    const mod = await import("../lint-skip-annotations.js");
    // Forge an array whose index 0 is undefined (sparse array). The
    // `?? ""` fallback inside checkAnnotation must take the empty
    // path — covers the LHS short-circuit branch.
    const sparse: string[] = [];
    sparse[1] = "it.skip('x', () => {});";
    expect(mod.checkAnnotation(sparse, 1)).toBe("missing");
  });

  it("flags too-short with body of length 9 (boundary at 10)", async () => {
    const mod = await import("../lint-skip-annotations.js");
    const lines = ["// SKIP-REASON: 123456789", "it.skip('x', () => {});"];
    expect(mod.checkAnnotation(lines, 1)).toBe("too-short");
  });

  it("accepts body exactly 10 chars (boundary)", async () => {
    const mod = await import("../lint-skip-annotations.js");
    const lines = ["// SKIP-REASON: 1234567890", "it.skip('x', () => {});"];
    expect(mod.checkAnnotation(lines, 1)).toBe("ok");
  });
});

describe("runLint — sort branches", () => {
  it("sorts two violations in the SAME file by line number (a.file === b.file branch)", () => {
    touch(
      "apps/api/tests/multi.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('first', () => {});",
        "  it.skip('second', () => {});",
        "});",
      ].join("\n"),
    );
    const v = runLint(root);
    expect(v).toHaveLength(2);
    expect(v[0]?.line).toBeLessThan(v[1]?.line ?? 0);
  });

  it("sorts a.file < b.file ascending (covers the < branch RHS)", () => {
    touch(
      "apps/zeta/tests/z.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('z', () => {}); });",
      ].join("\n"),
    );
    touch(
      "apps/alpha/tests/a.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('a', () => {}); });",
      ].join("\n"),
    );
    const v = runLint(root);
    expect(v.map((x) => x.file)).toEqual([
      "apps/alpha/tests/a.test.ts",
      "apps/zeta/tests/z.test.ts",
    ]);
  });
});

describe("runMain — non-Error thrown by runLint catch branch", () => {
  it("surfaces a non-Error throw as String(err) in the catch", async () => {
    // Stub runLint by mocking the imported module — easier: rely on
    // node:fs.globSync receiving an invalid root (boolean) that
    // makes path.join throw a TypeError NOT inheriting Error.
    // TypeError DOES inherit from Error, so we can't trip the
    // String(err) branch via globSync. Use vi.mock instead.
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        globSync: () => {
          // Throw a plain object (not Error) to exercise the
          // `String(err)` ternary RHS.
          throw "not-an-error-instance";
        },
      };
    });
    const mod = await import("../lint-skip-annotations.js");
    const out: string[] = [];
    const err: string[] = [];
    const code = mod.runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("not-an-error-instance");
    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});

describe("runLint — IGNORE_SEGMENTS coverage", () => {
  it("ignores a candidate file whose path starts with a segment (no leading slash)", () => {
    // Create a `dist/foo.test.ts` directly (no leading apps/packages
    // — the glob still picks up some patterns). Combined with
    // `apps/dist/...` which exercises the `/segment/` branch already.
    touch(
      "packages/dist/leaked.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('vendor', () => { it.skip('x', () => {}); });",
      ].join("\n"),
    );
    // Even though packages/dist/leaked.test.ts would match
    // `packages/**/*.ts`, IGNORE_SEGMENTS strips it.
    expect(runLint(root)).toEqual([]);
  });

  it("walks valid tests/integration/*.ts entries", () => {
    touch(
      "tests/integration/foo.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => { it.skip('bare', () => {}); });",
      ].join("\n"),
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe("tests/integration/foo.test.ts");
  });
});
