#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-colocated-tests.ts — Test-layout regression guard (STRUCT-01).
 *
 * Forbids future co-located `*.test.ts` siblings of source files under
 * apps/<app>/src/** and packages/<pkg>/src/**. Canonical layout (per
 * docs/conventions.md "Test layout") places unit tests under
 * apps/<app>/tests/unit/** and packages/<pkg>/tests/unit/**.
 *
 * Allow-list (paths exempt from the rule):
 *   tools/load-test/**                     (dev tooling, not an app/library)
 *   tests/**                               (root e2e / conformance / infra)
 *   apps/<app>/tests/**                    (canonical app layout)
 *   packages/<pkg>/tests/**                (canonical package layout)
 *   tools/test-probe/tests/**              (canonical tooling test layout)
 *
 * Task 0 pivot rationale: the repo has NO ESLint config (.eslintrc* and
 * eslint.config.* both absent); lint stack is Biome (`pnpm lint` =
 * `biome check .`). Authoring an ESLint plugin would require introducing
 * the ESLint runtime AND `@typescript-eslint/utils` AND a config file.
 * Mirroring the existing tools/lint-tdd.ts pattern keeps the rule in the
 * `pnpm lint:colocated-tests` script chain alongside lint:tdd / lint:rls /
 * lint:english, with zero new runtime dependencies.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; details printed to stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-colocated-tests.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/**
 * Path (relative to rootDir) of the optional legacy allow-list file.
 * One POSIX path per line; lines starting with `#` or blank are ignored.
 * The file is committed during Phase 15-01 and DELETED by 15-02 as the
 * final commit of that plan, once migrate-tests.ts --apply has relocated
 * every co-located test to apps|packages/<ws>/tests/unit/**.
 */
export const LEGACY_ALLOWLIST_FILE = "tools/lint-colocated-tests.legacy-allowlist.txt";

export const ALLOWED_PREFIXES = ["tools/load-test/", "tools/test-probe/tests/", "tests/"];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * True when `rel` is exempt from the no-colocated-tests rule.
 *
 * The allow-list matches:
 *   1. Top-level exempt prefixes (tools/load-test/, tests/, …)
 *   2. apps/<app>/tests/** (canonical app test layout)
 *   3. packages/<pkg>/tests/** (canonical package test layout)
 */
export function isAllowed(rel: string): boolean {
  const norm = toPosix(rel);
  for (const prefix of ALLOWED_PREFIXES) {
    if (norm === prefix.replace(/\/$/, "") || norm.startsWith(prefix)) return true;
  }
  // Canonical workspace tests dirs.
  if (/^(apps|packages)\/[^/]+\/tests\//.test(norm)) return true;
  return false;
}

/**
 * Read the optional legacy allow-list file at `rootDir/LEGACY_ALLOWLIST_FILE`.
 * Returns an empty Set when the file does not exist (canonical post-15-02 state).
 */
export function readLegacyAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, LEGACY_ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

/**
 * Scan `rootDir` for `*.test.ts` files under apps/<app>/src/** and
 * packages/<pkg>/src/**; return the sorted, deduplicated list of paths
 * that violate the canonical layout. Paths listed in the legacy
 * allow-list (Phase 15-01 -> 15-02 transition only) are skipped.
 */
export async function findViolations(rootDir: string): Promise<string[]> {
  const realRoot = resolve(rootDir);
  const legacy = readLegacyAllowlist(realRoot);
  const patterns = ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"];
  const out = new Set<string>();
  for (const pat of patterns) {
    for await (const f of glob(pat, {
      cwd: realRoot,
      exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    })) {
      /* c8 ignore next — node:fs/promises glob yields strings in this configuration. */
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      // Defensive: the glob shape apps|packages/<workspace>/src/... never
      // matches an allow-listed path, so this branch is unreachable in
      // practice. Kept as belt-and-braces should the glob be widened.
      /* c8 ignore next */
      if (isAllowed(posixRel)) continue;
      if (legacy.has(posixRel)) continue;
      out.add(posixRel);
    }
  }
  return [...out].sort();
}

/**
 * One stale path-literal site discovered by {@link findStalePathLiterals}.
 *
 * `file` is the POSIX-relative path of the test source containing the
 * call expression; `target` is the absolute filesystem path the literal
 * would resolve to (which does NOT exist on disk).
 */
export interface StalePathLiteral {
  file: string;
  target: string;
}

/**
 * Heuristic AST scan for D-05: detect path literals inside test files
 * that statically resolve to non-existent siblings — typically left over
 * after a test relocation (Phase 17) bumps __dirname depth and leaves
 * `readFileSync(path.resolve(__dirname, "old/rel.ts"))` literally pointing
 * at a vanished target.
 *
 * Patterns flagged:
 *   - readFileSync(path.resolve(__dirname, "<literal>"))
 *   - readFile(path.resolve(__dirname, "<literal>"))     (sync/async forms)
 *   - new URL("<literal>", import.meta.url)
 *
 * Only fully-static (StringLiteral, NoSubstitutionTemplateLiteral) targets
 * are evaluated; dynamic args are skipped intentionally — false-positive
 * suppression matters more than recall for a regression guard.
 */
export async function findStalePathLiterals(rootDir: string): Promise<StalePathLiteral[]> {
  const realRoot = resolve(rootDir);
  const out: StalePathLiteral[] = [];
  const patterns = [
    "apps/*/tests/**/*.test.ts",
    "packages/*/tests/**/*.test.ts",
    "tools/**/*.test.ts",
    "tests/**/*.test.ts",
  ];
  for (const pat of patterns) {
    for await (const f of glob(pat, {
      cwd: realRoot,
      exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    })) {
      const rel = typeof f === "string" ? f : String(f);
      const abs = join(realRoot, rel);
      let src: string;
      try {
        src = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const target = extractStaticPathTarget(node, abs);
          if (target !== null && !existsSync(target)) {
            out.push({ file: toPosix(rel), target });
          }
        } else if (ts.isNewExpression(node) && isUrlCtor(node)) {
          const target = extractUrlTarget(node, abs);
          if (target !== null && !existsSync(target)) {
            out.push({ file: toPosix(rel), target });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return out;
}

function staticString(node: ts.Node | undefined): string | null {
  if (!node) return null;
  // Plain string-literal only; skip template literals (even no-substitution)
  // and identifiers — keeps false-positive rate low for a regression guard.
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  return null;
}

function isPathResolveCall(node: ts.CallExpression): boolean {
  const e = node.expression;
  if (!ts.isPropertyAccessExpression(e)) return false;
  if (e.name.text !== "resolve" && e.name.text !== "join") return false;
  return ts.isIdentifier(e.expression) && e.expression.text === "path";
}

function isDirnameRef(node: ts.Node): boolean {
  return ts.isIdentifier(node) && node.text === "__dirname";
}

/**
 * If `node` is `readFileSync(path.resolve(__dirname, "<lit>"))` (or an
 * equivalent `readFile`/`readFileSync` wrapper around `path.resolve`/`path.join`
 * with __dirname + a static string), return the absolute resolved target.
 * Returns null when the shape doesn't match or the literal is non-static.
 */
function extractStaticPathTarget(node: ts.CallExpression, fileAbs: string): string | null {
  const callee = node.expression;
  const calleeName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  const fsLike =
    calleeName === "readFileSync" ||
    calleeName === "readFile" ||
    calleeName === "existsSync" ||
    calleeName === "statSync";
  if (!fsLike) return null;
  const first = node.arguments[0];
  if (!first || !ts.isCallExpression(first) || !isPathResolveCall(first)) return null;
  const args = first.arguments;
  if (args.length < 2) return null;
  const first0 = args[0];
  if (!first0 || !isDirnameRef(first0)) return null;
  const lit = staticString(args[1]);
  if (lit === null) return null;
  const base = dirname(fileAbs);
  return isAbsolute(lit) ? lit : resolve(base, lit);
}

function isUrlCtor(node: ts.NewExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "URL";
}

function extractUrlTarget(node: ts.NewExpression, fileAbs: string): string | null {
  const args = node.arguments ?? [];
  const lit = staticString(args[0]);
  if (lit === null) return null;
  // Only flag relative URL literals (./ or ../); skip protocol/abs URLs.
  if (!lit.startsWith("./") && !lit.startsWith("../")) return null;
  const base = dirname(fileAbs);
  return resolve(base, lit);
}

/* c8 ignore start */
export async function main(argv: string[]): Promise<number> {
  const rootDir = argv[2] ?? process.cwd();
  let violations: string[];
  let stale: StalePathLiteral[];
  try {
    violations = await findViolations(rootDir);
    stale = await findStalePathLiterals(rootDir);
  } catch (err) {
    process.stderr.write(
      `lint-colocated-tests: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0 && stale.length === 0) {
    process.stdout.write(`lint-colocated-tests: clean (${rootDir})\n`);
    return 0;
  }
  if (violations.length > 0) {
    process.stderr.write(
      `lint-colocated-tests: ${violations.length} co-located test file(s) found:\n`,
    );
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      'Move under apps/<app>/tests/unit/ or packages/<pkg>/tests/unit/ (see docs/conventions.md "Test layout").\n',
    );
  }
  if (stale.length > 0) {
    process.stderr.write(
      `lint-colocated-tests: ${stale.length} stale path literal(s) referencing non-existent files:\n`,
    );
    for (const s of stale) process.stderr.write(`  ${s.file} -> ${s.target}\n`);
    process.stderr.write(
      "Update __dirname-relative literals after a test relocation (D-05 guard).\n",
    );
  }
  return 1;
}

const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-colocated-tests.ts") || arg1.endsWith("lint-colocated-tests.js");
})();
if (invokedDirect) {
  main(process.argv).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-colocated-tests: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
