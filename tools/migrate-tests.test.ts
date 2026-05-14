// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * migrate-tests.test.ts — RED→GREEN coverage for the test-layout codemod.
 *
 * The codemod (`tools/migrate-tests.ts`) relocates co-located `*.test.ts`
 * files into the canonical `tests/unit/` layout per Phase 15 STRUCT-01.
 * Tests use ts-morph with `useInMemoryFileSystem: true` so they touch
 * ZERO real files; on-disk inventory mode is exercised against a tmpdir.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyMoves,
  computeTargetPath,
  EXEMPT_PREFIXES,
  loadProject,
  type Move,
  planMoves,
  renderInventory,
  rewriteImports,
} from "./migrate-tests.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "migrate-tests-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("computeTargetPath", () => {
  it("maps apps/<app>/src/<rest>.test.ts → apps/<app>/tests/unit/<rest>.test.ts", () => {
    expect(computeTargetPath("apps/api/src/lib/foo.test.ts")).toBe(
      "apps/api/tests/unit/lib/foo.test.ts",
    );
  });

  it("preserves __tests__ harness dir under apps/<app>/src/**", () => {
    expect(computeTargetPath("apps/api/src/routes/__tests__/health.test.ts")).toBe(
      "apps/api/tests/unit/routes/__tests__/health.test.ts",
    );
  });

  it("maps packages/<pkg>/src/**/__tests__/<file> → packages/<pkg>/tests/unit/__tests__/<file>", () => {
    expect(computeTargetPath("packages/byok-guard/src/__tests__/guard.test.ts")).toBe(
      "packages/byok-guard/tests/unit/__tests__/guard.test.ts",
    );
  });

  it("returns null for tools/load-test (exempt — load-test is dev tooling)", () => {
    expect(computeTargetPath("tools/load-test/src/scenario.test.ts")).toBe(null);
  });

  it("returns null for root-level tests/ dir (exempt — e2e/conformance/infra)", () => {
    expect(computeTargetPath("tests/e2e-cjm/foo.test.ts")).toBe(null);
  });

  it("returns null for non-.test.ts files", () => {
    expect(computeTargetPath("apps/api/src/lib/foo.ts")).toBe(null);
  });

  it("returns null when already inside tests/ (idempotency)", () => {
    expect(computeTargetPath("apps/api/tests/unit/lib/foo.test.ts")).toBe(null);
  });

  it("exposes EXEMPT_PREFIXES including tools/load-test/ and tests/", () => {
    expect(EXEMPT_PREFIXES).toContain("tools/load-test/");
    expect(EXEMPT_PREFIXES).toContain("tests/");
  });

  it("returns null for the exact exempt-prefix dir entry without trailing slash", () => {
    // Covers the `rel === prefix.replace(/\/$/, "")` exact-match branch in isExempt.
    expect(computeTargetPath("tests")).toBe(null);
  });

  it("normalizes leading ./ prefix on input paths", () => {
    expect(computeTargetPath("./apps/api/src/lib/foo.test.ts")).toBe(
      "apps/api/tests/unit/lib/foo.test.ts",
    );
  });
});

describe("rewriteImports", () => {
  it("rewrites a relative import after the test file moves up the tree", () => {
    // Source: apps/api/src/lib/foo.test.ts importing "./foo"
    // Target: apps/api/tests/unit/lib/foo.test.ts → must import "../../../src/lib/foo"
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/lib/foo.test.ts";
    const newPath = "/repo/apps/api/tests/unit/lib/foo.test.ts";
    project.createSourceFile("/repo/apps/api/src/lib/foo.ts", "export const x = 1;\n");
    const sf = project.createSourceFile(
      oldPath,
      'import { x } from "./foo";\nexport const y = x;\n',
    );
    rewriteImports(sf, oldPath, newPath);
    const decls = sf.getImportDeclarations();
    expect(decls).toHaveLength(1);
    expect(decls[0].getModuleSpecifierValue()).toBe("../../../src/lib/foo");
  });

  it('rewrites `export ... from "./x"` re-exports the same way as imports', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/lib/re.test.ts";
    const newPath = "/repo/apps/api/tests/unit/lib/re.test.ts";
    project.createSourceFile("/repo/apps/api/src/lib/sibling.ts", "export const z = 2;\n");
    const sf = project.createSourceFile(oldPath, 'export { z } from "./sibling";\n');
    rewriteImports(sf, oldPath, newPath);
    const decls = sf.getExportDeclarations();
    expect(decls).toHaveLength(1);
    expect(decls[0].getModuleSpecifierValue()).toBe("../../../src/lib/sibling");
  });

  it("ignores side-effect-only `export {}` declarations without a module specifier", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/lib/bare.test.ts";
    const newPath = "/repo/apps/api/tests/unit/lib/bare.test.ts";
    const sf = project.createSourceFile(oldPath, "export {};\n");
    rewriteImports(sf, oldPath, newPath);
    expect(sf.getExportDeclarations()[0]?.getModuleSpecifierValue()).toBeUndefined();
  });

  it('leaves bare-module re-exports untouched (export from "@scope/pkg")', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/lib/scoped.test.ts";
    const newPath = "/repo/apps/api/tests/unit/lib/scoped.test.ts";
    const sf = project.createSourceFile(oldPath, 'export { something } from "@scope/pkg";\n');
    rewriteImports(sf, oldPath, newPath);
    expect(sf.getExportDeclarations()[0]?.getModuleSpecifierValue()).toBe("@scope/pkg");
  });

  it("prefixes ./ when the new specifier resolves inside the new directory tree", () => {
    // Move a test DOWN into a subfolder where the import target now lives
    // alongside it; posix.relative() then returns a bare name without "./",
    // which the rewriter must prefix. Covers the !startsWith(".") branch.
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/foo.test.ts";
    const newPath = "/repo/apps/api/src/sub/foo.test.ts";
    project.createSourceFile("/repo/apps/api/src/sub/bar.ts", "export const b = 1;\n");
    const sf = project.createSourceFile(oldPath, 'import { b } from "./sub/bar";\n');
    rewriteImports(sf, oldPath, newPath);
    expect(sf.getImportDeclarations()[0].getModuleSpecifierValue()).toBe("./bar");
  });

  it("prefixes ./ on re-exports when relative path is bare (export sibling-after-move)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/foo.test.ts";
    const newPath = "/repo/apps/api/src/sub/foo.test.ts";
    project.createSourceFile("/repo/apps/api/src/sub/bar.ts", "export const b = 1;\n");
    const sf = project.createSourceFile(oldPath, 'export { b } from "./sub/bar";\n');
    rewriteImports(sf, oldPath, newPath);
    expect(sf.getExportDeclarations()[0].getModuleSpecifierValue()).toBe("./bar");
  });

  it("leaves bare-module imports untouched (vitest, node:fs, etc.)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const oldPath = "/repo/apps/api/src/lib/bar.test.ts";
    const newPath = "/repo/apps/api/tests/unit/lib/bar.test.ts";
    const sf = project.createSourceFile(
      oldPath,
      'import { describe } from "vitest";\nimport { readFileSync } from "node:fs";\n',
    );
    rewriteImports(sf, oldPath, newPath);
    const specs = sf.getImportDeclarations().map((d) => d.getModuleSpecifierValue());
    expect(specs).toEqual(["vitest", "node:fs"]);
  });
});

describe("planMoves", () => {
  it("returns a Move[] entry per co-located test file, skipping exempt paths", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/repo/apps/api/src/lib/foo.test.ts", "");
    project.createSourceFile("/repo/apps/api/src/routes/__tests__/health.test.ts", "");
    project.createSourceFile("/repo/tools/load-test/src/x.test.ts", "");
    project.createSourceFile("/repo/tests/e2e/y.test.ts", "");

    const moves = planMoves(project, "/repo");
    const fromPaths = moves.map((m) => m.from).sort();
    expect(fromPaths).toEqual([
      "apps/api/src/lib/foo.test.ts",
      "apps/api/src/routes/__tests__/health.test.ts",
    ]);
    const lib = moves.find((m) => m.from === "apps/api/src/lib/foo.test.ts");
    expect(lib?.to).toBe("apps/api/tests/unit/lib/foo.test.ts");
  });

  it("returns empty array when re-run on already-moved tree (idempotent)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/repo/apps/api/tests/unit/lib/foo.test.ts", "");
    const moves = planMoves(project, "/repo");
    expect(moves).toEqual([]);
  });

  it("includes non-test .ts source files in the project without emitting moves for them", () => {
    // Covers the `if (target === null) continue` branch when a project
    // source file is NOT a *.test.ts.
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/repo/apps/api/src/lib/foo.ts", "export const x = 1;\n");
    project.createSourceFile("/repo/apps/api/src/lib/foo.test.ts", "");
    const moves = planMoves(project, "/repo");
    expect(moves.map((m) => m.from)).toEqual(["apps/api/src/lib/foo.test.ts"]);
  });
});

describe("applyMoves — dry-run mode", () => {
  it("writes zero files when dryRun=true (no inventory path)", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("/repo/apps/api/src/lib/foo.test.ts", "");
    const moves: Move[] = [
      { from: "apps/api/src/lib/foo.test.ts", to: "apps/api/tests/unit/lib/foo.test.ts" },
    ];
    await applyMoves(project, "/repo", moves, { dryRun: true });
    // Source file is still at its original location; no new file created.
    expect(project.getSourceFile("/repo/apps/api/src/lib/foo.test.ts")).toBe(sf);
    expect(project.getSourceFile("/repo/apps/api/tests/unit/lib/foo.test.ts")).toBeUndefined();
  });
});

describe("applyMoves — inventory mode", () => {
  it("writes markdown inventory table to inventoryPath", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/repo/apps/api/src/lib/foo.test.ts", "");
    const moves: Move[] = [
      { from: "apps/api/src/lib/foo.test.ts", to: "apps/api/tests/unit/lib/foo.test.ts" },
      { from: "packages/byok-guard/src/g.test.ts", to: "packages/byok-guard/tests/unit/g.test.ts" },
    ];
    const inv = join(workDir, "MOVE-INVENTORY.md");
    await applyMoves(project, "/repo", moves, { dryRun: true, inventoryPath: inv });
    expect(existsSync(inv)).toBe(true);
    const text = readFileSync(inv, "utf8");
    expect(text).toMatch(/^\| Source \| Target \| Workspace \| Notes \|/m);
    expect(text).toContain("apps/api/src/lib/foo.test.ts");
    expect(text).toContain("apps/api/tests/unit/lib/foo.test.ts");
    expect(text).toContain("apps/api");
    expect(text).toContain("packages/byok-guard");
  });
});

describe("renderInventory", () => {
  it("renders empty table header when given an empty Move[] list", () => {
    const text = renderInventory([]);
    expect(text).toMatch(/^\| Source \| Target \| Workspace \| Notes \|/);
    expect(text).toMatch(/\| --- \| --- \| --- \| --- \|/);
  });

  it("derives workspace column from the source path prefix", () => {
    const text = renderInventory([
      { from: "apps/web/src/foo.test.ts", to: "apps/web/tests/unit/foo.test.ts" },
      { from: "packages/data/src/x.test.ts", to: "packages/data/tests/unit/x.test.ts" },
    ]);
    expect(text).toContain("| apps/web |");
    expect(text).toContain("| packages/data |");
  });
});

describe("applyMoves — inventory directory creation", () => {
  it("creates parent directories when inventoryPath points at a missing dir", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const inv = join(workDir, "nested", "deep", "INV.md");
    await applyMoves(project, "/repo", [], { dryRun: true, inventoryPath: inv });
    expect(existsSync(inv)).toBe(true);
  });
});

describe("loadProject — real filesystem glob", () => {
  it("globs apps/*/src/**/*.test.ts + packages/*/src/**/*.test.ts under a real repo root", async () => {
    // Set up a tmpdir simulating the repo shape.
    const root = mkdtempSync(join(tmpdir(), "migrate-tests-load-"));
    mkdirSync(join(root, "apps/api/src/lib"), { recursive: true });
    mkdirSync(join(root, "packages/data/src"), { recursive: true });
    mkdirSync(join(root, "tools/load-test/src"), { recursive: true });
    mkdirSync(join(root, "tests/e2e"), { recursive: true });
    writeFileSync(join(root, "apps/api/src/lib/a.test.ts"), "");
    writeFileSync(join(root, "packages/data/src/b.test.ts"), "");
    writeFileSync(join(root, "tools/load-test/src/skip.test.ts"), "");
    writeFileSync(join(root, "tests/e2e/skip.test.ts"), "");
    try {
      const { moves } = await loadProject(root);
      const froms = moves.map((m) => m.from).sort();
      expect(froms).toEqual(["apps/api/src/lib/a.test.ts", "packages/data/src/b.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("applyMoves — apply mode", () => {
  it("invokes moveToDirectory on each source file (ts-morph project state changes)", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/repo/apps/api/src/lib/foo.ts", "export const x = 1;\n");
    project.createSourceFile(
      "/repo/apps/api/src/lib/foo.test.ts",
      'import { x } from "./foo";\nexport const y = x;\n',
    );
    const moves: Move[] = [
      { from: "apps/api/src/lib/foo.test.ts", to: "apps/api/tests/unit/lib/foo.test.ts" },
    ];
    await applyMoves(project, "/repo", moves, { dryRun: false });
    expect(project.getSourceFile("/repo/apps/api/src/lib/foo.test.ts")).toBeUndefined();
    const moved = project.getSourceFile("/repo/apps/api/tests/unit/lib/foo.test.ts");
    expect(moved).toBeDefined();
    const decls = moved!.getImportDeclarations();
    expect(decls[0].getModuleSpecifierValue()).toBe("../../../src/lib/foo");
  });
});
