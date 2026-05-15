// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-phase-tag-comments.test.ts — RED→GREEN coverage for the regression
 * guard CLI (Phase 16 / Plan 01 — COMMENT-03).
 *
 * The guard shares its `classifyLine` predicate with the sweep codemod
 * (`tools/phase-tag-sweep.ts`) so REMOVE/KEEP semantics cannot drift. The
 * lint CLI scans `{apps,packages}/**` `*.ts` + `*.tsx`, reports every
 * REMOVE-classified line, and suppresses violations whose POSIX path
 * appears in the transitional allowlist `tools/lint-phase-tag-comments.allowlist.txt`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOWLIST_FILE, findViolations, main, readAllowlist } from "../lint-phase-tag-comments.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-phase-tag-comments-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("findViolations", () => {
  it("L1: flags `// Phase 12` in apps/x/src/a.ts (POSIX path + line 1)", async () => {
    touch("apps/x/src/a.ts", "// Phase 12\nexport const a = 1;\n");
    const violations = await findViolations(root);
    expect(violations.map((v) => ({ file: v.file, lineNumber: v.lineNumber }))).toEqual([
      { file: "apps/x/src/a.ts", lineNumber: 1 },
    ]);
  });

  it("L2: returns zero violations when only KEEP-bucket comments exist", async () => {
    touch(
      "apps/x/src/b.ts",
      "// D-19 — explains WHY in detail because of upstream bug\nexport const b = 2;\n",
    );
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("L3: allowlist suppresses violation for listed POSIX path", async () => {
    touch("apps/x/src/a.ts", "// Phase 12\nexport const a = 1;\n");
    touch(ALLOWLIST_FILE, "apps/x/src/a.ts\n");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("L5: files outside apps/ + packages/ are NOT scanned (tools/, root tests/)", async () => {
    touch("tools/foo.ts", "// Phase 14\nexport const t = 1;\n");
    touch("tests/e2e-cjm/bar.ts", "// Phase 14\nexport const e = 1;\n");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });
});

describe("readAllowlist", () => {
  it("L4a: returns an empty Set when the allowlist file does not exist", () => {
    expect(readAllowlist(root).size).toBe(0);
  });

  it("L4b: strips lines beginning with `#` and blank lines; returns trimmed POSIX paths", () => {
    touch(
      ALLOWLIST_FILE,
      "# header comment\n\napps/x/src/a.ts\n  packages/y/src/b.ts  \n# tail comment\n",
    );
    const set = readAllowlist(root);
    expect([...set].sort()).toEqual(["apps/x/src/a.ts", "packages/y/src/b.ts"]);
  });
});

describe("main — CLI dispatch (L6 + exit codes)", () => {
  it("L6a: main([root]) returns 1 on dirty tree", async () => {
    touch("apps/x/src/a.ts", "// Phase 12\nexport const a = 1;\n");
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(1);
  });

  it("L6b: main([root]) returns 0 on clean tree", async () => {
    touch("apps/x/src/clean.ts", "export const a = 1;\n");
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main([root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("L6c: main([]) defaults rootDir to process.cwd()", async () => {
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    // Either clean (0) or dirty (1) is acceptable; what matters is no throw.
    expect([0, 1]).toContain(code);
  });
});

describe("findViolations — sort + multi-file ordering", () => {
  it("returns violations sorted by file then by lineNumber", async () => {
    touch(
      "apps/y/src/b.ts",
      ["export const a = 1;", "// Phase 9", "export const b = 2;", "// Phase 8"].join("\n"),
    );
    touch("apps/x/src/a.ts", "// Phase 12\nexport const a = 1;\n");
    const violations = await findViolations(root);
    expect(violations.map((v) => `${v.file}:${v.lineNumber}`)).toEqual([
      "apps/x/src/a.ts:1",
      "apps/y/src/b.ts:2",
      "apps/y/src/b.ts:4",
    ]);
  });
});
