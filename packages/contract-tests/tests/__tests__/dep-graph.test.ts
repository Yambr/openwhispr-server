// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 02 / Task 01 — D-06 dep-graph linter.
//
// Lint-as-test asserting every `@openwhispr/*` import that appears in
// this workspace's `tests/**/*.ts` tree has a matching declared entry
// under `dependencies` or `devDependencies` of `package.json`. This
// catches silent reliance on pnpm hoisting (which would break under a
// future `shamefully-hoist=false` policy switch).
//
// Per RESEARCH §2 and CONTEXT D-06: `@openwhispr/wire-schemas` resolves
// today via hoist but is NOT declared — this test fails RED on `main`
// and lands GREEN with the dep declaration in the SAME atomic commit
// (D-39 NEW-functionality combined commit shape).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("dep-graph", () => {
  it("every @openwhispr/* import has a matching dependencies entry", () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));

    const files = walk(resolve(PKG_ROOT, "tests"));
    const imported = new Set<string>();
    // Match `from "@openwhispr/<pkg>"` or `from "@openwhispr/<pkg>/<sub>"`
    // ONLY inside import/from clauses — comments and prose are ignored. The
    // quoted-string boundary (`["']`) is the anti-false-positive guard
    // (without it, prose like "wire-\nschemas" yields a spurious match).
    const re = /from\s+["']@openwhispr\/([a-z0-9-]+)(?:\/[^"']*)?["']/g;
    const dynRe = /import\(\s*["']@openwhispr\/([a-z0-9-]+)(?:\/[^"']*)?["']\s*\)/g;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) imported.add(`@openwhispr/${m[1]}`);
      for (const m of src.matchAll(dynRe)) imported.add(`@openwhispr/${m[1]}`);
    }
    const self = (pkg as unknown as { name?: string }).name;
    if (self) imported.delete(self);

    const missing = [...imported].filter((d) => !declared.has(d));
    expect(missing).toEqual([]);
  });

  it("workspace protocol `workspace:*` counts as declared", () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    // If wire-schemas is declared, it should use workspace:* (post-GREEN).
    const wsDep = pkg.dependencies?.["@openwhispr/wire-schemas"];
    if (wsDep !== undefined) {
      expect(wsDep).toBe("workspace:*");
    }
  });
});
