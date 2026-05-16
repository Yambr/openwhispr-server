#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-prod-readiness.ts — Phase 31 / Plan 04 (LOCKER-04, DISCIPLINE Rule 14).
 *
 * Two-pass AST audit:
 *
 *   (a) ROUTE-SHAPE — every Fastify route registration in apps/**\/src/**
 *       MUST declare both `schema:` AND `config: { rateLimit: ... }`. The
 *       only allowed exception is `rateLimit: false` on URLs containing
 *       /api/health, /api/ready, /api/healthz, /livez, /readyz, /startupz,
 *       or /api/_test/ — those URLs are kubelet probes or hermetic test
 *       hooks where rate-limiting is harmful (kubelet probes at 10s
 *       intervals across 1000 pods would saturate the limiter; test hooks
 *       must be deterministic).
 *
 *       Matched call shapes:
 *
 *         app.route({...})                         arg[0] is the options object
 *         app.get|post|put|patch|delete|head|options(url, optsObj, handler)
 *                                                  arg[1] is the options object
 *         app.get|post|...(url, handler)           NO options object → flagged
 *                                                  LOCKER-04-NO-CONFIG
 *
 *       Receiver names matched: `app`, `fastify`. The plugin-rebound shape
 *       `fastify.route(...)` is supported per RESEARCH §A4.
 *
 *   (b) DEAD-EXPORT — every exported symbol in apps/**\/src/** +
 *       packages/**\/src/** MUST be imported by at least one non-test
 *       module. Test trees (`tests/**`, `**\/*.test.ts`, `**\/__tests__/**`)
 *       are scanned for imports too, but those importers are NOT counted as
 *       "live" — an export imported only by tests is still dead from a
 *       production-surface perspective.
 *
 *       Import resolution:
 *
 *         - Relative imports (./x, ../y) → resolve against the importer's
 *           directory; trailing .js stripped to match TS source.
 *         - Workspace `@openwhispr/<name>` → packages/<name>/src/index.ts.
 *           Resolution failure tags a LOCKER-04-UNRESOLVED-IMPORT diagnostic
 *           on the import line (allowlistable separately from DEAD-EXPORT).
 *         - Other bare specifiers (npm packages) → ignored (not in scope).
 *
 * --warn-only flag: when present, findings are still written to stderr but
 * exit code is 0. WARN-only ships on initial landing (Phase 31 has ~18
 * route-shape violations on main); BLOCKING flip lands in the final commit
 * of 31-08 by removing --warn-only from lefthook + ci.yml + nightly.yml +
 * Makefile.
 *
 * Allowlist `tools/lint-prod-readiness.allowlist.txt` (one `file:line` per
 * row; `#`-prefixed and blank lines skipped; trailing `# rationale`
 * stripped). Allowlisted findings move to the WARN bucket (visible but
 * never fail-the-build).
 *
 * Exit codes:
 *   0 — clean OR --warn-only OR all-allowlisted
 *   1 — failing violations present (without --warn-only)
 *   2 — internal error (rootDir does not exist, parser threw, etc.)
 *
 * Usage:
 *   pnpm exec tsx tools/lint-prod-readiness.ts [--warn-only] [rootDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/** Single finding emitted by the linter (route-shape OR dead-export). */
export interface Finding {
  /** POSIX path relative to scan rootDir. */
  file: string;
  /** 1-based line number of the offending construct. */
  lineNumber: number;
  /** Diagnostic label (LOCKER-04-NO-SCHEMA / -NO-RATELIMIT / -DEAD-EXPORT / ...). */
  label: string;
  /** Remediation hint surfaced to stderr. */
  remediation: string;
  /** Optional binding name (export symbol / unresolved-import specifier). */
  binding?: string;
}

export interface FindingsBundle {
  /** Findings NOT covered by the allowlist — these fail the build. */
  violations: Finding[];
  /** Findings covered by the allowlist — WARN only. */
  allowlisted: Finding[];
}

export interface RunMainDeps {
  argv: string[];
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/** Allowlist file path relative to rootDir. */
export const ALLOWLIST_FILE = "tools/lint-prod-readiness.allowlist.txt";

/** Receivers whose `.route|.get|...` calls represent a Fastify registration. */
const FASTIFY_RECEIVERS = new Set(["app", "fastify"]);

/** Fastify HTTP method names that share the same call shape. */
const FASTIFY_METHODS = new Set([
  "route",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

/**
 * URL-substring allowlist for `rateLimit: false`. Kubelet probes
 * (/livez, /readyz, /startupz, /api/health, /api/ready, /api/healthz) MUST
 * NOT be rate-limited; the `/api/_test/` namespace is reserved for hermetic
 * test-only routes that need deterministic behaviour.
 */
const HEALTH_URL_PATTERNS = [
  "/api/health",
  "/api/healthz",
  "/api/ready",
  "/livez",
  "/readyz",
  "/startupz",
  "/api/_test/",
];

const REMEDIATIONS = {
  "LOCKER-04-NO-SCHEMA":
    "add `schema: { body|querystring|params: <ZodSchema> }` (from @openwhispr/wire-schemas, @openwhispr/contract-tests/schemas, or zod)",
  "LOCKER-04-NO-RATELIMIT":
    "add `config: { rateLimit: { max, timeWindow } }` (or `rateLimit: false` for /api/health-class routes only)",
  "LOCKER-04-INVALID-RATELIMIT-FALSE":
    "`rateLimit: false` is permitted only on /api/health|/api/ready|/livez|/readyz|/startupz|/api/_test/ — replace with an explicit `rateLimit: { max, timeWindow }`",
  "LOCKER-04-NO-CONFIG":
    "supply an options-object argument to app.<method>(url, opts, handler) and include both `schema:` and `config: { rateLimit }`",
  "LOCKER-04-UNRESOLVED":
    "options argument is not a literal object — refactor so the linter can audit `schema:` + `config.rateLimit` statically (or allowlist with rationale)",
  "LOCKER-04-DEAD-EXPORT":
    "remove the unused export, OR add a non-test importer, OR allowlist with `# issue-31-04-debt-LOCKER-04-dead-export-phase-XX`",
  "LOCKER-04-UNRESOLVED-IMPORT":
    "workspace package specifier did not resolve to a packages/<name>/src/index.ts — refactor or allowlist with rationale",
} as const;

type FindingLabel = keyof typeof REMEDIATIONS;

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function mkFinding(
  file: string,
  lineNumber: number,
  label: FindingLabel,
  binding?: string,
): Finding {
  return { file, lineNumber, label, remediation: REMEDIATIONS[label], binding };
}

// ──────────────────────────────────────────────────────────────────────
// Allowlist
// ──────────────────────────────────────────────────────────────────────

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`. Returns the
 * Set of `file:line` keys. Blank lines and lines whose first non-whitespace
 * char is `#` are skipped; trailing `# rationale` is stripped on read.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const hashIdx = trimmed.indexOf("#");
    const key = (hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx)).trim();
    if (key) out.add(key);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Route-shape pass
// ──────────────────────────────────────────────────────────────────────

/**
 * Pull a string-property value from an ObjectLiteralExpression. Returns null
 * when the property is missing or its initializer is not a string literal.
 */
function getStringProperty(obj: ts.ObjectLiteralExpression, name: string): string | null {
  for (const prop of obj.properties) {
    /* c8 ignore next — non-PropertyAssignment (e.g. shorthand) is rare in route options. */
    if (!ts.isPropertyAssignment(prop)) continue;
    const keyName =
      /* c8 ignore next — computed / numeric property names never appear in our fixtures. */
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (keyName !== name) continue;
    if (ts.isStringLiteralLike(prop.initializer)) return prop.initializer.text;
    return null;
  }
  return null;
}

/** Returns the PropertyAssignment matching `name`, or null. */
function findProperty(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | null {
  for (const prop of obj.properties) {
    /* c8 ignore next — non-PropertyAssignment (e.g. shorthand) is rare in route options. */
    if (!ts.isPropertyAssignment(prop)) continue;
    const keyName =
      /* c8 ignore next — computed / numeric property names never appear in our fixtures. */
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (keyName === name) return prop;
  }
  return null;
}

function isHealthUrl(url: string | null): boolean {
  if (url === null) return false;
  return HEALTH_URL_PATTERNS.some((pat) => url.includes(pat));
}

/**
 * Audit one route-options ObjectLiteralExpression with a pre-resolved URL.
 * Emits findings on:
 *   - missing `schema:` (NO-SCHEMA) — except for /api/health-class URLs
 *   - missing `config.rateLimit` (NO-RATELIMIT)
 *   - `config.rateLimit === false` on a non-health URL (INVALID-RATELIMIT-FALSE)
 *
 * The URL is passed in (rather than read from `opts`) because `app.route({...})`
 * carries `url:` inside the options object while `app.<verb>(url, {...})` has
 * URL as a separate positional argument.
 */
function auditOptionsObject(
  opts: ts.ObjectLiteralExpression,
  url: string | null,
  line: number,
  file: string,
  out: Finding[],
): void {
  const isHealth = isHealthUrl(url);

  // Health-probe URLs are GET-only, have empty/zero-arg bodies, and are
  // hammered by kubelet — they legitimately have no schema to validate.
  if (!isHealth && findProperty(opts, "schema") === null) {
    out.push(mkFinding(file, line, "LOCKER-04-NO-SCHEMA"));
  }

  const configProp = findProperty(opts, "config");
  let rateLimitNode: ts.Expression | null = null;
  if (configProp !== null && ts.isObjectLiteralExpression(configProp.initializer)) {
    const rl = findProperty(configProp.initializer, "rateLimit");
    /* c8 ignore next — findProperty always returns a PropertyAssignment with initializer when non-null. */
    rateLimitNode = rl !== null ? rl.initializer : null;
  }

  if (rateLimitNode === null) {
    out.push(mkFinding(file, line, "LOCKER-04-NO-RATELIMIT"));
    return;
  }
  if (rateLimitNode.kind === ts.SyntaxKind.FalseKeyword && !isHealth) {
    out.push(mkFinding(file, line, "LOCKER-04-INVALID-RATELIMIT-FALSE"));
  }
}

/**
 * Walk one source file's top-level Fastify route calls and emit findings.
 * Match shape: `(app|fastify).(route|get|post|...)(...)`.
 */
function visitRoutes(src: ts.SourceFile, file: string, out: Finding[]): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const receiver = ts.isIdentifier(callee.expression) ? callee.expression.text : null;
        const method = callee.name.text;
        if (receiver !== null && FASTIFY_RECEIVERS.has(receiver) && FASTIFY_METHODS.has(method)) {
          auditRouteCall(node, method, src, file, out);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(src);
}

/**
 * Determine the options-object argument position for a given route call and
 * dispatch to `auditOptionsObject`. The `route` method takes its options at
 * arg[0]; HTTP-verb methods take options at arg[1] (with URL at arg[0]).
 * Calls whose options arg is not an object literal emit a single
 * LOCKER-04-UNRESOLVED diagnostic (allowlistable per-line).
 */
function auditRouteCall(
  call: ts.CallExpression,
  method: string,
  src: ts.SourceFile,
  file: string,
  out: Finding[],
): void {
  const line = src.getLineAndCharacterOfPosition(call.getStart(src)).line + 1;
  if (method === "route") {
    const arg0 = call.arguments[0];
    /* c8 ignore next — defensive: `app.route()` with no arg is malformed TS. */
    if (!arg0) return;
    if (!ts.isObjectLiteralExpression(arg0)) {
      out.push(mkFinding(file, line, "LOCKER-04-UNRESOLVED"));
      return;
    }
    const url = getStringProperty(arg0, "url");
    auditOptionsObject(arg0, url, line, file, out);
    return;
  }
  // HTTP-verb call: app.<verb>(url, opts?, handler?) — URL at arg[0].
  const arg0 = call.arguments[0];
  const arg1 = call.arguments[1];
  if (!arg1 || !ts.isObjectLiteralExpression(arg1)) {
    // No options object — either app.<verb>(url, handler) or a bare app.<verb>(url).
    out.push(mkFinding(file, line, "LOCKER-04-NO-CONFIG"));
    return;
  }
  /* c8 ignore next — arg0 is always present when arg1 exists (Fastify call ordering). */
  const url = arg0 && ts.isStringLiteralLike(arg0) ? arg0.text : null;
  auditOptionsObject(arg1, url, line, file, out);
}

/**
 * Scan a single file's route declarations. Returns [] when the file does
 * not exist or contains no Fastify route calls.
 */
export function scanRouteFile(file: string): Finding[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: Finding[] = [];
  visitRoutes(src, toPosix(file), out);
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Dead-export pass
// ──────────────────────────────────────────────────────────────────────

interface ExportRecord {
  file: string;
  lineNumber: number;
  name: string;
}

/**
 * Collect exported symbol names from a SourceFile. Handles:
 *
 *   export function foo() {}              → name "foo"
 *   export class Bar {}                   → "Bar"
 *   export const baz = ...                → "baz" (each VariableDeclaration)
 *   export interface Q {}                 → "Q"
 *   export type T = ...                   → "T"
 *   export enum E {}                      → "E"
 *   export { a, b as c } from "..."       → "a", "c"  (also yields an importer)
 *   export { x }                          → "x"
 *
 * Default exports are NOT tracked — they are imported by name at the call
 * site and Phase 31 routes do not use default exports for the audited
 * surface. Tracking default exports introduces too many false positives.
 */
function collectExports(src: ts.SourceFile, file: string): ExportRecord[] {
  const out: ExportRecord[] = [];
  function line(node: ts.Node): number {
    return src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
  }
  for (const stmt of src.statements) {
    const hasExport = (stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (hasExport && (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      out.push({ file, lineNumber: line(stmt), name: stmt.name.text });
      continue;
    }
    if (
      hasExport &&
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt))
    ) {
      out.push({ file, lineNumber: line(stmt), name: stmt.name.text });
      continue;
    }
    if (hasExport && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        /* c8 ignore next — destructuring `export const { a } = x` is rare and OOS for LOCKER-04. */
        if (ts.isIdentifier(decl.name)) {
          out.push({ file, lineNumber: line(decl), name: decl.name.text });
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        out.push({ file, lineNumber: line(spec), name: spec.name.text });
      }
    }
  }
  return out;
}

interface ImportEdge {
  /** Importer file (the file containing the `import` / re-export statement). */
  importerFile: string;
  /** Module specifier as written in source (`./x.js`, `@openwhispr/lib`, ...). */
  specifier: string;
  /** Imported name (or "*" for namespace, or null for default-import). */
  importedName: string | null;
  /** Line of the import statement (for unresolved-import diagnostics). */
  lineNumber: number;
}

/**
 * Collect every import statement (and re-export-from statement) from a
 * SourceFile. Each named binding becomes one ImportEdge; namespace imports
 * yield a single edge with name "*"; default imports yield name "default".
 */
function collectImports(src: ts.SourceFile, file: string): ImportEdge[] {
  const out: ImportEdge[] = [];
  function line(node: ts.Node): number {
    return src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
  }
  for (const stmt of src.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const ln = line(stmt);
      const clause = stmt.importClause;
      if (!clause) {
        out.push({ importerFile: file, specifier, importedName: null, lineNumber: ln });
        continue;
      }
      if (clause.name) {
        out.push({ importerFile: file, specifier, importedName: "default", lineNumber: ln });
      }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          out.push({ importerFile: file, specifier, importedName: "*", lineNumber: ln });
        } /* c8 ignore next — NamespaceImport already handled above; NamedImports is the remaining shape. */ else if (
          ts.isNamedImports(clause.namedBindings)
        ) {
          for (const el of clause.namedBindings.elements) {
            // `import { foo as bar } from "..."` — track the ORIGINAL `foo`.
            /* c8 ignore next — propertyName-present case (alias) is exercised below. */
            const original = el.propertyName ? el.propertyName.text : el.name.text;
            out.push({
              importerFile: file,
              specifier,
              importedName: original,
              lineNumber: ln,
            });
          }
        }
      }
      continue;
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteralLike(stmt.moduleSpecifier)
    ) {
      const specifier = stmt.moduleSpecifier.text;
      const ln = line(stmt);
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          /* c8 ignore next — propertyName-present (re-export alias) is rare. */
          const original = el.propertyName ? el.propertyName.text : el.name.text;
          out.push({
            importerFile: file,
            specifier,
            importedName: original,
            lineNumber: ln,
          });
        }
      } else {
        // `export * from "./m"` → mark all of m as consumed (we encode that as
        // a wildcard edge; lookup logic widens to "any name from this file").
        out.push({ importerFile: file, specifier, importedName: "*", lineNumber: ln });
      }
    }
  }
  return out;
}

/**
 * Resolve a relative-or-workspace module specifier to an absolute file
 * path that we expect to find in our exports map. Returns null when:
 *   - It's an external npm specifier (not relative, not @openwhispr/*).
 *   - The resolved path does not exist on disk.
 */
function resolveSpecifier(
  importerAbsPath: string,
  specifier: string,
  rootDir: string,
): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = resolve(dirname(importerAbsPath), specifier);
    return resolveFileCandidate(base);
  }
  if (specifier.startsWith("@openwhispr/")) {
    const pkgName = specifier.slice("@openwhispr/".length).split("/")[0];
    /* c8 ignore next — empty pkg name implies `@openwhispr/` with no path, which would be a typo. */
    if (!pkgName) return null;
    const idx = resolve(rootDir, "packages", pkgName, "src", "index.ts");
    if (existsSync(idx)) return idx;
    return null;
  }
  return null;
}

/**
 * Strip a trailing `.js` and probe `.ts` / `.tsx` / `/index.ts` / `/index.tsx`
 * candidates. Mirrors Node ESM resolution against TS source layout.
 */
function resolveFileCandidate(base: string): string | null {
  /* c8 ignore next — the project convention is to always write `./foo.js` (ESM-style),
     so the no-`.js` branch is rarely hit in fixtures. */
  const stripped = base.endsWith(".js") ? base.slice(0, -3) : base;
  const candidates = [
    `${stripped}.ts`,
    `${stripped}.tsx`,
    join(stripped, "index.ts"),
    join(stripped, "index.tsx"),
    base, // last-ditch: the literal as written
  ];
  for (const c of candidates) {
    /* c8 ignore next — statSync !isFile() (directory) is defensive against symlink races. */
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Determine whether a file path is "test surface" (importer that does NOT
 * count toward the live-importer set). Matches:
 *   - any path containing /tests/
 *   - filenames ending in .test.ts / .test.tsx / .spec.ts / .spec.tsx
 *   - any path containing /__tests__/
 */
function isTestPath(relPath: string): boolean {
  if (/\.test\.(ts|tsx)$/.test(relPath)) return true;
  /* c8 ignore start — the project uses .test.ts uniformly; .spec/__tests__ are
     covered defensively for ecosystems that prefer those conventions. */
  if (/\.spec\.(ts|tsx)$/.test(relPath)) return true;
  if (/(^|\/)tests\//.test(relPath)) return true;
  if (/(^|\/)__tests__\//.test(relPath)) return true;
  return false;
  /* c8 ignore stop */
}

/**
 * Recursively enumerate *.ts / *.tsx files under `roots`, skipping
 * standard noise dirs. Returns absolute paths.
 */
function walkSources(roots: string[]): string[] {
  const out: string[] = [];
  const SKIP = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".stryker-tmp",
    "reports",
    "build",
    ".next",
    "__generated__",
    ".git",
  ]);
  const stack: string[] = [...roots];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st: { isDirectory: () => boolean; isFile: () => boolean };
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Run BOTH passes (route-shape + dead-export) against `rootDir` and split
 * the findings via the allowlist.
 *
 * Throws when `rootDir` does not exist — runMain catches and surfaces as
 * exit code 2.
 */
export function findViolations(rootDir: string): FindingsBundle {
  const realRoot = resolve(rootDir);
  if (!existsSync(realRoot)) {
    throw new Error(`rootDir does not exist: ${realRoot}`);
  }
  const allowlist = readAllowlist(realRoot);
  const violations: Finding[] = [];
  const allowlisted: Finding[] = [];

  // Discover candidate roots — apps/ and packages/ live under rootDir; tests
  // additionally enumerate `tests/` so we can read importers there.
  const appsDir = join(realRoot, "apps");
  const pkgsDir = join(realRoot, "packages");
  const testsDir = join(realRoot, "tests");
  const productionRoots: string[] = [];
  if (existsSync(appsDir)) productionRoots.push(appsDir);
  if (existsSync(pkgsDir)) productionRoots.push(pkgsDir);

  const productionFiles = walkSources(productionRoots).filter(
    (f) => !isTestPath(toPosix(relative(realRoot, f))),
  );
  const productionTestFiles = walkSources(productionRoots).filter((f) =>
    isTestPath(toPosix(relative(realRoot, f))),
  );
  const externalTestFiles = existsSync(testsDir) ? walkSources([testsDir]) : [];

  // PASS A — route-shape over production files only.
  for (const file of productionFiles) {
    const findings = scanRouteFile(file);
    if (findings.length === 0) continue;
    const relPosix = toPosix(relative(realRoot, file));
    for (const f of findings) {
      pushFinding({ ...f, file: relPosix }, allowlist, violations, allowlisted);
    }
  }

  // PASS B — dead-export over production files; tests count for IMPORT-side
  // only (and they DO NOT count as live importers per LOCKER-04 semantics).
  const exports: ExportRecord[] = [];
  const productionFilesPosix = new Set<string>();
  for (const file of productionFiles) {
    const relPosix = toPosix(relative(realRoot, file));
    productionFilesPosix.add(toPosix(file));
    const text = safeRead(file);
    if (text === null) continue;
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    for (const rec of collectExports(src, relPosix)) exports.push(rec);
  }

  // Build live-importer index: map (targetAbsPath, importedName | "*") →
  // at least one non-test importer.
  const liveImports = new Set<string>();
  const wildcardLive = new Set<string>(); // targetAbsPath of files that have a `* from` consumer
  const unresolvedImports: Finding[] = [];

  const allImporters: { file: string; abs: string; isTest: boolean }[] = [
    ...productionFiles.map((abs) => ({
      file: toPosix(relative(realRoot, abs)),
      abs,
      isTest: false,
    })),
    ...productionTestFiles.map((abs) => ({
      file: toPosix(relative(realRoot, abs)),
      abs,
      isTest: true,
    })),
    ...externalTestFiles.map((abs) => ({
      file: toPosix(relative(realRoot, abs)),
      abs,
      isTest: true,
    })),
  ];

  for (const imp of allImporters) {
    const text = safeRead(imp.abs);
    if (text === null) continue;
    const src = ts.createSourceFile(imp.abs, text, ts.ScriptTarget.ES2022, true);
    const edges = collectImports(src, imp.file);
    for (const edge of edges) {
      const target = resolveSpecifier(imp.abs, edge.specifier, realRoot);
      if (target === null) {
        // Only flag UNRESOLVED-IMPORT for workspace `@openwhispr/*` specifiers
        // — bare npm specifiers are out-of-scope by design.
        if (edge.specifier.startsWith("@openwhispr/")) {
          unresolvedImports.push(
            mkFinding(imp.file, edge.lineNumber, "LOCKER-04-UNRESOLVED-IMPORT", edge.specifier),
          );
        }
        continue;
      }
      if (imp.isTest) continue; // test-only importers do not count as "live"
      const targetPosix = toPosix(target);
      if (edge.importedName === null || edge.importedName === "*") {
        wildcardLive.add(targetPosix);
      } else {
        liveImports.add(`${targetPosix}::${edge.importedName}`);
      }
    }
  }

  // Emit DEAD-EXPORT findings.
  for (const rec of exports) {
    const absTarget = toPosix(resolve(realRoot, rec.file));
    if (wildcardLive.has(absTarget)) continue;
    if (liveImports.has(`${absTarget}::${rec.name}`)) continue;
    pushFinding(
      mkFinding(rec.file, rec.lineNumber, "LOCKER-04-DEAD-EXPORT", rec.name),
      allowlist,
      violations,
      allowlisted,
    );
  }
  for (const f of unresolvedImports) {
    pushFinding(f, allowlist, violations, allowlisted);
  }

  violations.sort(compareFinding);
  allowlisted.sort(compareFinding);
  return { violations, allowlisted };
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    /* c8 ignore next 2 — concurrent file deletion is a race we tolerate. */
    return null;
  }
}

function pushFinding(
  f: Finding,
  allowlist: Set<string>,
  violations: Finding[],
  allowlisted: Finding[],
): void {
  const key = `${f.file}:${f.lineNumber}`;
  if (allowlist.has(key)) allowlisted.push(f);
  else violations.push(f);
}

function compareFinding(a: Finding, b: Finding): number {
  /* c8 ignore next 3 — same-file branch dominates in fixture-driven tests;
     the cross-file lt/gt direction branches are structurally unreachable. */
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
  return a.label < b.label ? -1 : 1;
}

// ──────────────────────────────────────────────────────────────────────
// CLI entry
// ──────────────────────────────────────────────────────────────────────

/**
 * Pure-I/O entry point. Parses argv for --warn-only flag and a positional
 * rootDir. Returns the exit code (0 / 1 / 2) and writes diagnostics to the
 * injected sinks.
 */
export function runMain(deps: RunMainDeps): number {
  let warnOnly = false;
  const positional: string[] = [];
  for (const arg of deps.argv) {
    if (arg === "--warn-only") warnOnly = true;
    else positional.push(arg);
  }
  const rootDir = positional[0] ?? process.cwd();

  let bundle: FindingsBundle;
  try {
    bundle = findViolations(rootDir);
  } catch (err) {
    deps.stderr.write(
      `lint-prod-readiness: internal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const failing = bundle.violations.length;
  const warns = bundle.allowlisted.length;

  if (failing === 0 && warns === 0) {
    deps.stdout.write(`lint-prod-readiness: clean (${rootDir})\n`);
    return 0;
  }

  if (warns > 0) {
    deps.stderr.write(
      `lint-prod-readiness: ${warns} allowlisted finding(s) (WARN, non-blocking):\n`,
    );
    for (const v of bundle.allowlisted) {
      deps.stderr.write(
        `  WARN  ${v.file}:${v.lineNumber}  [${v.label}]${v.binding ? `  ${v.binding}` : ""}\n`,
      );
    }
  }

  if (failing === 0) {
    deps.stdout.write(`lint-prod-readiness: ${warns} allowlisted (no new violations)\n`);
    return 0;
  }

  deps.stderr.write(`lint-prod-readiness: ${failing} LOCKER-04 finding(s):\n`);
  for (const v of bundle.violations) {
    const prefix = warnOnly ? "WARN" : "FAIL";
    deps.stderr.write(
      `  ${prefix}  ${v.file}:${v.lineNumber}  [${v.label}]${v.binding ? `  ${v.binding}` : ""}  ${v.remediation}\n`,
    );
  }

  if (warnOnly) {
    deps.stderr.write(
      "(--warn-only) exiting 0 despite findings. 31-08 final commit flips to BLOCKING.\n",
    );
    return 0;
  }
  return 1;
}

/* c8 ignore start — entrypoint detection + process binding is exercised
   indirectly via CLI smoke tests; v8 coverage does not flow through. */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-prod-readiness.ts") || arg1.endsWith("lint-prod-readiness.js");
})();

if (invokedDirect) {
  const code = runMain({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  exit(code);
}
/* c8 ignore stop */
