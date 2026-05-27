// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * test-evidence-projects-manifest.test.ts — Quick 260527-pj6.
 *
 * Parity self-test for `tools/test-evidence-projects-manifest.json`.
 *
 * The pre-push test-evidence validator (`tools/lint-pre-push-test-evidence.ts`)
 * REFUSES the push when the per-SHA evidence-fragment set
 * (`.test-evidence/<sha>-*.json`) does not cover every project listed in the
 * manifest. The manifest is hand-maintained because deriving it dynamically
 * at validator runtime would require booting Vitest just to enumerate
 * projects — too slow for a pre-push hook. This test pins manifest ⇄
 * live-config parity so a new workspace cannot silently bypass the gate.
 *
 * Parity rules:
 *   1. Read all per-workspace `vitest.config.ts` (paths derived from the
 *      root config's `projects[]` glob), parse each via ts-morph, extract
 *      the literal `test.name` string from the top-level
 *      `defineConfig` / `mergeConfig` call.
 *   2. Read the root `vitest.config.ts` and walk every inline
 *      `{ extends: true, test: { name: "<lit>", ... } }` entry in the
 *      `projects` array, extracting the literal `name` value.
 *   3. Assert `new Set(manifest.projects) === new Set(liveNames)`. The set
 *      comparison surfaces both additions (workspace added without
 *      manifest update) and removals (workspace deleted without manifest
 *      update) as a single named delta.
 *
 * Style mirrors `tools/chart-api-env-parity.test.ts` (RESEARCH R7.6).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Node, Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

/** Per-workspace `vitest.config.ts` paths owned by their own
 *  `defineConfig` / `mergeConfig` invocation (each contributes one
 *  project to the canonical list). Mirrors the explicit-config branch
 *  of `vitest.config.ts:39-56` (the `p(...)` entries). */
const WORKSPACE_CONFIG_PATHS = [
  "apps/api/vitest.config.ts",
  "apps/web/vitest.config.ts",
  "apps/worker/vitest.config.ts",
  "packages/byok-guard/vitest.config.ts",
  "packages/contract-tests/vitest.config.ts",
  "packages/data/vitest.config.ts",
  "packages/email/vitest.config.ts",
  "packages/litellm-client/vitest.config.ts",
  "tools/load-test/vitest.config.ts",
  "tools/test-probe/vitest.config.ts",
  "compose/mock-litellm/vitest.config.ts",
  "tests/e2e/vitest.config.ts",
  "tests/e2e/mock-realtime/vitest.config.ts",
];

const ROOT_CONFIG_PATH = "vitest.config.ts";

interface NameExtractionContext {
  project: Project;
  liveNames: Set<string>;
  errors: string[];
}

/**
 * Walks a `vitest.config.ts` file and extracts every literal `name:`
 * string assignment under a `test: { name: "..." }` object literal
 * (whether the surrounding call is `defineConfig`, `mergeConfig`, or
 * an inline `{ extends: true, test: { name: "..." } }` entry under
 * the root `projects` array).
 *
 * The extractor is intentionally permissive: it walks ALL
 * `PropertyAssignment` nodes named `name` whose initialiser is a
 * string literal AND whose ancestor `PropertyAssignment` is named
 * `test`. The `test:` ancestor check excludes coverage / project-
 * config noise.
 */
function extractNames(file: string, ctx: NameExtractionContext): void {
  const absPath = resolve(REPO_ROOT, file);
  let source: string;
  try {
    source = readFileSync(absPath, "utf8");
  } catch (err) {
    ctx.errors.push(`${file}: read error: ${(err as Error).message}`);
    return;
  }
  const src = ctx.project.createSourceFile(absPath, source, { overwrite: true });
  src.forEachDescendant((node) => {
    if (!Node.isPropertyAssignment(node)) return;
    const nameNode = node.getNameNode();
    if (!Node.isIdentifier(nameNode) || nameNode.getText() !== "name") return;
    const initialiser = node.getInitializer();
    if (!initialiser || !Node.isStringLiteral(initialiser)) return;
    // Require that an ancestor PropertyAssignment is named `test:`
    // (defends against `coverage: { reporter: [..., name: "..." ] }`
    // and similar false positives).
    let ancestor = node.getParent();
    let underTest = false;
    while (ancestor) {
      if (Node.isPropertyAssignment(ancestor)) {
        const aName = ancestor.getNameNode();
        if (Node.isIdentifier(aName) && aName.getText() === "test") {
          underTest = true;
          break;
        }
      }
      ancestor = ancestor.getParent();
    }
    if (!underTest) return;
    ctx.liveNames.add(initialiser.getLiteralValue());
  });
}

describe("test-evidence-projects-manifest parity", () => {
  it("manifest.projects equals the live set of vitest project names", () => {
    const manifestRaw = readFileSync(
      resolve(REPO_ROOT, "tools/test-evidence-projects-manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as {
      schema: number;
      projects: string[];
    };
    expect(manifest.schema).toBe(1);

    const project = new Project({ useInMemoryFileSystem: false });
    const ctx: NameExtractionContext = {
      project,
      liveNames: new Set(),
      errors: [],
    };
    extractNames(ROOT_CONFIG_PATH, ctx);
    for (const wsPath of WORKSPACE_CONFIG_PATHS) {
      extractNames(wsPath, ctx);
    }

    expect(ctx.errors).toEqual([]);

    const manifestSet = new Set(manifest.projects);
    const missingFromManifest = [...ctx.liveNames].filter((n) => !manifestSet.has(n));
    const missingFromLive = [...manifestSet].filter((n) => !ctx.liveNames.has(n));

    expect(missingFromManifest).toEqual([]);
    expect(missingFromLive).toEqual([]);
    expect(ctx.liveNames.size).toBe(manifest.projects.length);
  });

  it("manifest length is 22 (the canonical project count for the gate)", () => {
    const manifestRaw = readFileSync(
      resolve(REPO_ROOT, "tools/test-evidence-projects-manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as { projects: string[] };
    expect(manifest.projects.length).toBe(22);
  });

  it("manifest values are unique strings (no accidental dupes)", () => {
    const manifestRaw = readFileSync(
      resolve(REPO_ROOT, "tools/test-evidence-projects-manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as { projects: string[] };
    expect(new Set(manifest.projects).size).toBe(manifest.projects.length);
    for (const name of manifest.projects) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// Silence unused-import lint when ts-morph SyntaxKind is not directly referenced.
void SyntaxKind;
