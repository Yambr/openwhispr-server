// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * codemod-skip-annotations.test.ts — Quick 260527-pj6.
 *
 * RED-then-GREEN unit tests for the one-shot codemod migration helper
 * (`tools/codemod-skip-annotations.ts`).
 *
 * Style mirrors `tools/__tests__/lint-no-plaintext-secret-columns.test.ts`.
 *
 * F-cases (PLAN scope item 15 / section 5):
 *   F1 — un-annotated fixture → post-codemod has the SKIP-REASON line
 *        above the call (preserving indentation).
 *   F2 — already-annotated fixture → idempotent (no-op).
 *   F3 — audit manifest written to expected path with the 4-column
 *        format (file path | line number | current placeholder |
 *        suggested investigation steps).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUDIT_MANIFEST_REL_PATH,
  applyInsertions,
  composeAuditManifest,
  PLACEHOLDER_BODY,
  PLACEHOLDER_LINE,
  runCodemod,
} from "../codemod-skip-annotations.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codemod-skip-annotations-"));
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

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("F1 — un-annotated fixture gets a SKIP-REASON inserted", () => {
  it("prepends the placeholder line above the call (preserving indentation)", () => {
    touch(
      "apps/api/tests/bare.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('first', () => {});",
        "});",
        "",
      ].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    const after = read("apps/api/tests/bare.test.ts");
    const lines = after.split("\n");
    // Find the inserted line.
    const annotated = lines.findIndex((l) => l.includes(PLACEHOLDER_LINE));
    expect(annotated).toBeGreaterThanOrEqual(0);
    // Next non-empty line must be the .skip call.
    expect(lines[annotated + 1]).toContain("it.skip(");
    // Indentation matches the call line.
    expect(lines[annotated]).toMatch(/^\s{2}\/\/ SKIP-REASON:/);
  });
});

describe("F2 — already-annotated fixture is idempotent", () => {
  it("does not insert a second SKIP-REASON above an already-annotated call", () => {
    const original = [
      "import { describe, it } from 'vitest';",
      "describe('outer', () => {",
      "  // SKIP-REASON: requires-docker — testcontainers needed",
      "  it.skip('first', () => {});",
      "});",
      "",
    ].join("\n");
    touch("apps/api/tests/already-annotated.test.ts", original);
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    const after = read("apps/api/tests/already-annotated.test.ts");
    // File is byte-identical (no second SKIP-REASON inserted).
    expect(after).toBe(original);
  });
});

describe("F3 — audit manifest shape", () => {
  it("writes the 4-column markdown manifest to the planning quick-task dir", () => {
    touch(
      "apps/api/tests/a.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('first', () => {});",
        "});",
        "",
      ].join("\n"),
    );
    touch(
      "packages/data/tests/b.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  describe.skip('second suite', () => {});",
        "});",
        "",
      ].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    const manifest = read(AUDIT_MANIFEST_REL_PATH);
    expect(manifest).toContain(
      "| file path | line number | current placeholder | suggested investigation steps |",
    );
    expect(manifest).toContain("|---|---|---|---|");
    expect(manifest).toContain("apps/api/tests/a.test.ts");
    expect(manifest).toContain("packages/data/tests/b.test.ts");
    expect(manifest).toContain(PLACEHOLDER_BODY);
    expect(manifest).toContain("git blame");
  });

  it("manifest header references Quick 260527-pj6", () => {
    touch(
      "apps/api/tests/x.test.ts",
      ["import { describe, it } from 'vitest';", "it.skip('x', () => {});", ""].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    const manifest = read(AUDIT_MANIFEST_REL_PATH);
    expect(manifest).toContain("Quick 260527-pj6");
    expect(manifest).toContain("260527-pj6 codemod");
  });
});

describe("composeAuditManifest — sorting + format", () => {
  it("sorts rows by file then line", () => {
    const body = composeAuditManifest([
      { file: "zeta/z.test.ts", line: 10, callee: "it.skip" },
      { file: "alpha/a.test.ts", line: 5, callee: "it.skip" },
      { file: "alpha/a.test.ts", line: 2, callee: "describe.skip" },
    ]);
    const idxA2 = body.indexOf("alpha/a.test.ts | 2");
    const idxA5 = body.indexOf("alpha/a.test.ts | 5");
    const idxZ = body.indexOf("zeta/z.test.ts");
    expect(idxA2).toBeGreaterThanOrEqual(0);
    expect(idxA5).toBeGreaterThan(idxA2);
    expect(idxZ).toBeGreaterThan(idxA5);
  });

  it("includes the 4 investigation steps verbatim", () => {
    const body = composeAuditManifest([{ file: "x.test.ts", line: 1, callee: "it.skip" }]);
    expect(body).toContain("git blame");
    expect(body).toContain("PR description");
    expect(body).toContain("SKIP-REASON taxonomy");
    expect(body).toContain("replace placeholder with the real reason");
  });
});

describe("applyInsertions — bottom-up splice", () => {
  it("inserts multiple placeholders in the same file without line-shift drift", () => {
    touch(
      "apps/api/tests/multi.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('first', () => {});",
        "  it.skip('second', () => {});",
        "  it.skip('third', () => {});",
        "});",
        "",
      ].join("\n"),
    );
    applyInsertions(
      [
        { file: "apps/api/tests/multi.test.ts", line: 3, callee: "it.skip" },
        { file: "apps/api/tests/multi.test.ts", line: 4, callee: "it.skip" },
        { file: "apps/api/tests/multi.test.ts", line: 5, callee: "it.skip" },
      ],
      { root, apply: true },
    );
    const after = read("apps/api/tests/multi.test.ts");
    const lines = after.split("\n");
    // 3 placeholder lines + 3 original .skip calls.
    const annotated = lines.filter((l) => l.includes(PLACEHOLDER_LINE));
    const skips = lines.filter((l) => l.includes("it.skip("));
    expect(annotated).toHaveLength(3);
    expect(skips).toHaveLength(3);
    // Each placeholder is immediately above a .skip line.
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i]?.includes(PLACEHOLDER_LINE)) {
        expect(lines[i + 1]).toContain("it.skip(");
      }
    }
  });

  it("dry-run (apply=false) does not modify the filesystem", () => {
    const original = [
      "import { describe, it } from 'vitest';",
      "describe('outer', () => {",
      "  it.skip('first', () => {});",
      "});",
      "",
    ].join("\n");
    touch("apps/api/tests/dry-run.test.ts", original);
    applyInsertions([{ file: "apps/api/tests/dry-run.test.ts", line: 3, callee: "it.skip" }], {
      root,
      apply: false,
    });
    expect(read("apps/api/tests/dry-run.test.ts")).toBe(original);
  });

  it("empty insertion list is a no-op", () => {
    applyInsertions([], { root, apply: true });
    // No throw, no side effect.
    expect(existsSync(root)).toBe(true);
  });
});

describe("runCodemod — output / exit-code shape", () => {
  it("emits the success line with apply=true and count", () => {
    touch(
      "apps/api/tests/one.test.ts",
      ["import { describe, it } from 'vitest';", "it.skip('x', () => {});", ""].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("placeholder insertion(s)");
    expect(out.join("")).toContain("apply=true");
  });

  it("emits the no-op line when there's nothing to migrate", () => {
    touch(
      "apps/api/tests/clean.test.ts",
      ["import { describe, it } from 'vitest';", "it('x', () => {});", ""].join("\n"),
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root,
      apply: true,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("no unannotated sites");
  });

  it("returns 2 with stderr on internal error (non-string root → globSync throws)", () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCodemod({
      root: 42 as unknown as string,
      apply: false,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("internal error");
  });

  it("surfaces non-Error throws via String(err) in the catch", async () => {
    // Mock node:fs.globSync (transitively used by lint-skip-annotations'
    // runLint) to throw a non-Error object.
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        globSync: () => {
          throw { code: "EUSTOM", message: "fabricated" };
        },
      };
    });
    const mod = await import("../codemod-skip-annotations.js");
    const out: string[] = [];
    const err: string[] = [];
    const code = mod.runCodemod({
      root,
      apply: false,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toMatch(/internal error/);
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("respects the manifestPath override (writes the manifest elsewhere)", () => {
    touch(
      "apps/api/tests/override.test.ts",
      ["import { describe, it } from 'vitest';", "it.skip('x', () => {});", ""].join("\n"),
    );
    const customManifest = join(root, "custom-manifest.md");
    const out: string[] = [];
    const err: string[] = [];
    runCodemod({
      root,
      apply: false,
      manifestPath: customManifest,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(existsSync(customManifest)).toBe(true);
    expect(readFileSync(customManifest, "utf8")).toContain("apps/api/tests/override.test.ts");
  });
});
