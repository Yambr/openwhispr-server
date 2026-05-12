#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-ui-spec.ts — Phase 07 / Plan 03 (D-ART7).
 *
 * Validates the two UI-SPEC markdown files:
 *   - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
 *   - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
 *
 * Five rules (D-ART7):
 *   1. required-subsections — each screen `## A\d+|U\d+` section contains all
 *      10 REQUIRED_SUBSECTIONS as bold lead-in (`**Label.**`) or `### Label`.
 *   2. endpoint-exists — every `(GET|POST|PATCH|DELETE|PUT) /api/...` inline
 *      code reference resolves to either a Fastify route registered under
 *      apps/api/src/routes/**.ts (BOTH shorthand and `app.route` object
 *      forms) OR a BETTER_AUTH_PATHS allowlist entry OR a WIP_ENDPOINTS entry
 *      (warning only).
 *   3. copy-key-uniqueness + copy-key-schema — 5-level dotted keys are
 *      globally unique across files; tokens that look key-shaped (dotted
 *      lowercase) but fail COPY_KEY_REGEX produce a copy-key-schema
 *      diagnostic.
 *   4. visual-ref-resolves — every `See visual: design/<file>.jsx#<Name>`
 *      points at a real `function <Name>` / `const <Name>` in that file.
 *   5. wireframe-monospace — the first fenced code block in each Wireframe
 *      subsection either contains WIREFRAME_VISUAL_ONLY_SENTINEL OR every
 *      non-empty line is within WIREFRAME_LENGTH_TOLERANCE of the longest
 *      line (after stripping the block-uniform leading indent).
 *
 * Non-screen `##` headings (e.g., `## API Reference (verified)`,
 * `## WIP endpoints`) are SKIPPED — Rule 1 only fires when the H2 matches
 * the `^(A\d+|U\d+)( |—)` screen pattern. This is what allows the linter
 * to exit 0 against the Plan-01 scaffold state.
 *
 * Exit codes:
 *   0 — all rules satisfied
 *   1 — at least one error diagnostic
 *   2 — internal error (unreadable file, parse failure, etc.)
 *
 * Usage:
 *   pnpm lint:ui-spec
 *   pnpm exec tsx tools/lint-ui-spec.ts <spec-file...>
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import type { Code, Heading, Paragraph, Parent, PhrasingContent, Root, Text } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  BETTER_AUTH_PATHS,
  COPY_KEY_REGEX,
  REQUIRED_SUBSECTIONS,
  WIP_ENDPOINTS,
  WIREFRAME_LENGTH_TOLERANCE,
  WIREFRAME_VISUAL_ONLY_SENTINEL,
} from "./lint-ui-spec.config";

export type DiagnosticRule =
  | "required-subsections"
  | "endpoint-exists"
  | "copy-key-uniqueness"
  | "copy-key-schema"
  | "visual-ref-resolves"
  | "wireframe-monospace"
  | "wip-endpoint";

export interface Diagnostic {
  file: string;
  line: number;
  rule: DiagnosticRule;
  message: string;
  severity: "error" | "warning";
}

// Screen-heading regex: only `## A<digits>` or `## U<digits>` headings (with
// space or em-dash separator) are screen sections. Everything else (API
// Reference tables, Assumptions resolved, WIP endpoints) is skipped.
const SCREEN_HEADING_REGEX = /^(A\d+|U\d+)( |—|–|-)/;

// Endpoint reference inside backticks: "VERB /api/...". Global match.
const ENDPOINT_GLOBAL_REGEX = /\b(GET|POST|PATCH|DELETE|PUT)\s+(\/api\/[A-Za-z0-9/_:.*-]+)/g;

// "See visual: design/<file>.jsx#<Name>"
const SEE_VISUAL_REGEX = /See visual:\s*(design\/[^\s#]+)#([A-Za-z_][A-Za-z0-9_]*)/g;

// Tokens that LOOK like dotted lowercase keys (for copy-key-schema rule).
const KEY_SHAPED_REGEX = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

// Default design directory (relative to project root).
const DEFAULT_DESIGN_DIR = ".planning/phases/07-frontend-ui-spec/design";

// Default UI-SPEC files (relative to project root) — used when CLI is invoked
// with no args (pnpm lint:ui-spec).
const DEFAULT_SPEC_FILES = [
  ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md",
  ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md",
];

const DEFAULT_ROUTES_DIR = "apps/api/src/routes";

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

const SHORTHAND_ROUTE_REGEX =
  /app\.(get|post|patch|delete|put|all)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

const APP_ROUTE_METHOD_FIRST =
  /app\.route\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*url\s*:\s*['"`]([^'"`]+)['"`]/gs;

const APP_ROUTE_URL_FIRST =
  /app\.route\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`]+)['"`][^}]*method\s*:\s*['"`](\w+)['"`]/gs;

/**
 * Recursively scan `dir` for `.ts` files (excluding `*.test.ts`) and extract
 * Fastify route registrations. Returns a Set of `"METHOD /path"` strings.
 */
export function listFastifyRoutes(routesDir: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(routesDir)) return out;
  for (const file of walkTs(routesDir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(SHORTHAND_ROUTE_REGEX)) {
      const method = m[1]!.toUpperCase();
      const path = m[2]!;
      if (method === "ALL") {
        // Catch-all (e.g. /api/auth/*) — represented by BETTER_AUTH_PATHS.
        continue;
      }
      out.add(`${method} ${path}`);
    }
    for (const m of src.matchAll(APP_ROUTE_METHOD_FIRST)) {
      out.add(`${m[1]!.toUpperCase()} ${m[2]!}`);
    }
    for (const m of src.matchAll(APP_ROUTE_URL_FIRST)) {
      out.add(`${m[2]!.toUpperCase()} ${m[1]!}`);
    }
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// mdast helpers
// ---------------------------------------------------------------------------

interface ScreenSection {
  heading: Heading;
  /** Children of the document slice from after `heading` up to the next H2. */
  body: Parent["children"];
}

function parseMarkdown(src: string): Root {
  return unified().use(remarkParse).parse(src) as Root;
}

function isHeading(node: Parent["children"][number], depth: number): node is Heading {
  return node.type === "heading" && (node as Heading).depth === depth;
}

function headingText(h: Heading): string {
  let out = "";
  for (const c of h.children as PhrasingContent[]) {
    if ("value" in c) out += (c as { value: string }).value;
  }
  return out.trim();
}

/** mdast guarantees position information on nodes parsed from source. */
function lineOf(node: { position?: { start: { line: number } } }): number {
  return node.position!.start.line;
}

function collectScreenSections(root: Root): ScreenSection[] {
  const out: ScreenSection[] = [];
  const kids = root.children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]!;
    if (!isHeading(node, 2)) continue;
    const text = headingText(node);
    if (!SCREEN_HEADING_REGEX.test(text)) continue;
    let j = i + 1;
    const body: Parent["children"] = [];
    while (j < kids.length && !isHeading(kids[j]!, 2)) {
      body.push(kids[j]!);
      j++;
    }
    out.push({ heading: node, body });
  }
  return out;
}

/** Subsections within a screen body, keyed by their label. */
interface SubsectionMap {
  /** Map<label, position-line>. */
  found: Map<string, number>;
  /** Body slices keyed by label (for nested rule walking). */
  bodies: Map<string, Parent["children"]>;
}

function collectSubsections(body: Parent["children"]): SubsectionMap {
  const found = new Map<string, number>();
  const bodies = new Map<string, Parent["children"]>();
  let currentLabel: string | null = null;
  let currentBody: Parent["children"] = [];

  const flush = (): void => {
    if (currentLabel !== null) {
      bodies.set(currentLabel, currentBody);
    }
  };

  for (let i = 0; i < body.length; i++) {
    const node = body[i]!;
    const label = subsectionLabel(node);
    if (label !== null) {
      flush();
      currentLabel = label;
      currentBody = [];
      if (!found.has(label)) {
        found.set(label, lineOf(node));
      }
      // The marker node itself contributes to its own body (e.g. the
      // paragraph with the bold lead-in plus its trailing text).
      currentBody.push(node);
      continue;
    }
    if (currentLabel !== null) {
      currentBody.push(node);
    }
  }
  flush();
  return { found, bodies };
}

/**
 * Returns the subsection label if `node` is a `### Label` heading or a
 * paragraph that starts with `**Label.**`. The label is matched
 * case-sensitively against REQUIRED_SUBSECTIONS members.
 */
function subsectionLabel(node: Parent["children"][number]): string | null {
  // `### Label` heading.
  if (node.type === "heading" && (node as Heading).depth === 3) {
    const text = headingText(node as Heading);
    for (const label of REQUIRED_SUBSECTIONS) {
      if (text === label || text.startsWith(`${label} `)) return label;
    }
    return null;
  }
  // Paragraph starting with `**Label.**`.
  if (node.type === "paragraph") {
    const first = (node as Paragraph).children[0];
    if (first && first.type === "strong") {
      const strongText = (first.children as PhrasingContent[])
        .map((c) => ("value" in c ? (c as { value: string }).value : ""))
        .join("");
      // Bold text may be "Label." or "Label" (trailing dot in bold-then-dot
      // pattern). Strip a trailing period for matching.
      const stripped = strongText.replace(/\.$/, "").trim();
      for (const label of REQUIRED_SUBSECTIONS) {
        if (stripped === label) return label;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree walking helpers
// ---------------------------------------------------------------------------

type AnyNode = Parent["children"][number] | Root;

function visit<T extends { type: string }>(
  nodes: Parent["children"] | Root,
  predicate: (n: AnyNode) => n is AnyNode & T,
  cb: (n: T) => void,
): void {
  const stack: AnyNode[] = Array.isArray(nodes) ? [...nodes] : [nodes as AnyNode];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (predicate(node)) cb(node);
    const parent = node as Partial<Parent>;
    if (parent.children && Array.isArray(parent.children)) {
      stack.unshift(...(parent.children as AnyNode[]));
    }
  }
}

const isInlineCode = (n: AnyNode): n is AnyNode & { value: string; type: "inlineCode" } =>
  n.type === "inlineCode";

const isCodeBlock = (n: AnyNode): n is AnyNode & Code => n.type === "code";

const isText = (n: AnyNode): n is AnyNode & Text => n.type === "text";

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

function ruleRequiredSubsections(
  file: string,
  screens: ScreenSection[],
  diags: Diagnostic[],
): void {
  for (const screen of screens) {
    const { found } = collectSubsections(screen.body);
    for (const label of REQUIRED_SUBSECTIONS) {
      if (!found.has(label)) {
        diags.push({
          file,
          line: lineOf(screen.heading),
          rule: "required-subsections",
          severity: "error",
          message: `missing subsection: ${label} (in screen "${headingText(screen.heading)}")`,
        });
      }
    }
  }
}

function ruleEndpointExists(
  file: string,
  root: Root,
  liveRoutes: Set<string>,
  diags: Diagnostic[],
): void {
  visit(root, isInlineCode, (node) => {
    const raw = node.value;
    // The inline code may be the full "VERB /api/path" string, or a wider
    // sentence with embedded matches. Use a global scan.
    ENDPOINT_GLOBAL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
    while ((m = ENDPOINT_GLOBAL_REGEX.exec(raw)) !== null) {
      const method = m[1]!;
      const path = m[2]!;
      const key = `${method} ${path}`;
      const line = lineOf(node);
      if (WIP_ENDPOINTS.includes(key)) {
        diags.push({
          file,
          line,
          rule: "wip-endpoint",
          severity: "warning",
          message: `WIP endpoint ${key} — must resolve before phase close`,
        });
        continue;
      }
      if (path.startsWith("/api/auth/")) {
        if (betterAuthMatches(key)) continue;
        diags.push({
          file,
          line,
          rule: "endpoint-exists",
          severity: "error",
          message: `unknown Better Auth endpoint: ${key}`,
        });
        continue;
      }
      if (liveRoutes.has(key)) continue;
      diags.push({
        file,
        line,
        rule: "endpoint-exists",
        severity: "error",
        message: `endpoint not registered in Fastify routes: ${key}`,
      });
    }
  });
}

function betterAuthMatches(key: string): boolean {
  return BETTER_AUTH_PATHS.includes(key);
}

function ruleCopyKeys(
  file: string,
  screens: ScreenSection[],
  globalKeys: Map<string, { file: string; line: number }>,
  diags: Diagnostic[],
): void {
  for (const screen of screens) {
    const { bodies } = collectSubsections(screen.body);
    const copyBody = bodies.get("Copy keys");
    if (!copyBody) continue;
    // Walk every inlineCode in the Copy keys subsection body.
    visit(copyBody, isInlineCode, (node) => {
      const token = node.value.trim();
      const line = lineOf(node);
      if (COPY_KEY_REGEX.test(token)) {
        const prior = globalKeys.get(token);
        if (prior) {
          diags.push({
            file,
            line,
            rule: "copy-key-uniqueness",
            severity: "error",
            message: `duplicate copy key ${token} (also at ${prior.file}:${prior.line})`,
          });
        } else {
          globalKeys.set(token, { file, line });
        }
        return;
      }
      // Schema violation: token looks key-shaped (dotted lowercase OR a
      // single underscore-bearing identifier) but fails COPY_KEY_REGEX.
      if (
        KEY_SHAPED_REGEX.test(token) ||
        (/^[a-z][a-z0-9_-]*$/.test(token) && token.includes("_"))
      ) {
        diags.push({
          file,
          line,
          rule: "copy-key-schema",
          severity: "error",
          message: `copy key ${token} does not match 5-level dotted schema`,
        });
      }
    });
  }
}

function ruleVisualRefs(
  file: string,
  root: Root,
  designDir: string,
  diags: Diagnostic[],
  jsxCache: Map<string, string>,
): void {
  visit(root, isText, (node) => {
    const raw = node.value;
    SEE_VISUAL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
    while ((m = SEE_VISUAL_REGEX.exec(raw)) !== null) {
      const relPath = m[1]!;
      const name = m[2]!;
      const line = lineOf(node);
      // designDir is the parent directory containing the `design/` folder
      // (typically the phase directory). `relPath` is `design/<file>.jsx`.
      const jsxPath = resolve(dirname(designDir), relPath);
      let src = jsxCache.get(jsxPath);
      if (src === undefined) {
        try {
          src = readFileSync(jsxPath, "utf8");
        } catch {
          src = "";
        }
        jsxCache.set(jsxPath, src);
      }
      if (src === "") {
        diags.push({
          file,
          line,
          rule: "visual-ref-resolves",
          severity: "error",
          message: `cannot read referenced visual file ${relPath}`,
        });
        continue;
      }
      const reFn = new RegExp(`function\\s+${name}\\s*\\(`);
      const reConst = new RegExp(`const\\s+${name}\\s*=`);
      if (!reFn.test(src) && !reConst.test(src)) {
        diags.push({
          file,
          line,
          rule: "visual-ref-resolves",
          severity: "error",
          message: `visual reference ${relPath}#${name} not found in target file`,
        });
      }
    }
  });
}

function ruleWireframeMonospace(file: string, screens: ScreenSection[], diags: Diagnostic[]): void {
  for (const screen of screens) {
    const { bodies } = collectSubsections(screen.body);
    const wireBody = bodies.get("Wireframe");
    if (!wireBody) continue;
    let firstCode: Code | null = null;
    visit(wireBody, isCodeBlock, (node) => {
      if (firstCode === null) firstCode = node;
    });
    if (firstCode === null) continue;
    const codeNode: Code = firstCode;
    const value = codeNode.value;
    const line = lineOf(codeNode);
    if (value.split("\n").some((l) => l.trim() === WIREFRAME_VISUAL_ONLY_SENTINEL)) {
      continue;
    }
    const lines = value.split("\n");
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) continue;
    // Strip uniform leading indent.
    const indent = Math.min(...nonEmpty.map((l) => l.match(/^ */)?.[0].length ?? 0));
    const stripped = nonEmpty.map((l) => l.slice(indent));
    const maxLen = Math.max(...stripped.map((l) => l.length));
    for (const sl of stripped) {
      if (maxLen - sl.length > WIREFRAME_LENGTH_TOLERANCE) {
        diags.push({
          file,
          line,
          rule: "wireframe-monospace",
          severity: "error",
          message: `wireframe lines deviate beyond ±${WIREFRAME_LENGTH_TOLERANCE} chars (max ${maxLen}, got ${sl.length})`,
        });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lint a set of UI-SPEC markdown files. Returns a list of diagnostics
 * (empty when clean). Throws only on truly fatal I/O failures.
 *
 * @param specFiles  absolute or project-relative paths to the spec files
 * @param routesDir  directory to recursively scan for Fastify route files
 * @param designDir  directory that contains the `design/` JSX references
 */
export async function lint(
  specFiles: string[],
  routesDir: string,
  designDir: string = resolve(findProjectRoot(), DEFAULT_DESIGN_DIR),
): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  const liveRoutes = listFastifyRoutes(routesDir);
  const globalKeys = new Map<string, { file: string; line: number }>();
  const jsxCache = new Map<string, string>();

  for (const file of specFiles) {
    const src = readFileSync(file, "utf8");
    const root = parseMarkdown(src);
    const screens = collectScreenSections(root);
    ruleRequiredSubsections(file, screens, diags);
    ruleEndpointExists(file, root, liveRoutes, diags);
    ruleCopyKeys(file, screens, globalKeys, diags);
    ruleVisualRefs(file, root, designDir, diags, jsxCache);
    ruleWireframeMonospace(file, screens, diags);
  }

  return diags;
}

// ---------------------------------------------------------------------------
// Project root discovery
// ---------------------------------------------------------------------------

export function findProjectRoot(start?: string): string {
  let dir = start ?? dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const root = findProjectRoot();
  const specFiles =
    argv.length > 0 ? argv.map((p) => resolve(p)) : DEFAULT_SPEC_FILES.map((p) => resolve(root, p));
  const routesDir = resolve(root, DEFAULT_ROUTES_DIR);
  const designDir = resolve(root, DEFAULT_DESIGN_DIR);

  const diags = await lint(specFiles, routesDir, designDir);
  let errorCount = 0;
  for (const d of diags) {
    if (d.severity === "error") errorCount++;
    const rel = relative(root, d.file);
    process.stderr.write(`${rel}:${d.line} [${d.rule}] ${d.message}\n`);
  }
  return errorCount === 0 ? 0 : 1;
}

// Run when invoked directly (tsx tools/lint-ui-spec.ts ...).
if (process.argv[1]?.endsWith("lint-ui-spec.ts")) {
  main().then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(`lint-ui-spec: fatal: ${(err as Error).stack ?? String(err)}\n`);
      exit(2);
    },
  );
}
