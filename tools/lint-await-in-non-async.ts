#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-await-in-non-async.ts — D-39 AST guard for the await-in-arrow trap.
 *
 * Flags `await` whose nearest enclosing function is NOT marked async.
 * Catches the common Vitest-suite mistake
 *   expect(() => Schema.parse(await res.json())).not.toThrow()
 * which throws SyntaxError at parse time and surfaces as cryptic suite
 * failures.
 *
 * Top-level `await` (module-level) is allowed: ESM module-level await is
 * legal in Node 24 and is intentionally used by some fixtures.
 *
 * Exit codes: 0 clean / 1 violations / 2 internal error.
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

export interface AwaitInNonAsync {
  file: string;
  line: number;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * True iff `node` is a function-shaped scope (function decl/expr, method,
 * accessor, constructor, arrow). Used to find the nearest enclosing function
 * when walking up from an AwaitExpression.
 */
function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function isAsync(node: ts.Node): boolean {
  const mods =
    "modifiers" in node &&
    Array.isArray((node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers)
      ? (node as { modifiers: ts.NodeArray<ts.Modifier> }).modifiers
      : undefined;
  if (!mods) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * Walk parents from `from` upward. Return the nearest function-scope
 * ancestor, or null if none (= top-level await, allowed under ESM).
 */
function nearestEnclosingFunction(from: ts.Node): ts.Node | null {
  let cur: ts.Node | undefined = from.parent;
  while (cur) {
    if (isFunctionScope(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

export async function findAwaitInNonAsync(rootDir: string): Promise<AwaitInNonAsync[]> {
  const realRoot = resolve(rootDir);
  const out: AwaitInNonAsync[] = [];
  const patterns = ["**/*.test.ts", "**/*.ts"];
  const seen = new Set<string>();
  for (const pat of patterns) {
    for await (const f of glob(pat, {
      cwd: realRoot,
      exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/build/**"],
    })) {
      const rel = typeof f === "string" ? f : String(f);
      if (seen.has(rel)) continue;
      seen.add(rel);
      let src: string;
      try {
        src = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        continue;
      }
      if (!src.includes("await")) continue;
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isAwaitExpression(node)) {
          const fn = nearestEnclosingFunction(node);
          if (fn !== null && !isAsync(fn)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            out.push({ file: toPosix(rel), line: line + 1 });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return out;
}

/* c8 ignore start */
if (import.meta.url === `file://${process.argv[1]}`) {
  findAwaitInNonAsync(process.cwd()).then(
    (hits) => {
      if (hits.length === 0) {
        process.stdout.write("lint-await-in-non-async: clean\n");
        exit(0);
      }
      process.stderr.write(
        `lint-await-in-non-async: ${hits.length} await-in-non-async site(s) found:\n`,
      );
      for (const h of hits) process.stderr.write(`  ${h.file}:${h.line}\n`);
      process.stderr.write(
        "Hoist `const x = await expr;` above the non-async callback (see Plan 02 D-39).\n",
      );
      exit(1);
    },
    (err) => {
      process.stderr.write(`lint-await-in-non-async: ${String(err)}\n`);
      exit(2);
    },
  );
}
/* c8 ignore stop */
