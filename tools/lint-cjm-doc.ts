#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: Apache-2.0
/**
 * lint-cjm-doc.ts — Customer-Journey-Map doc + .feature cross-ref linter.
 *
 * Phase 13 / Plan 02 / Task 13-02-02.
 *
 * The CJM doc (`docs/customer-journeys.md`) is the canonical enumeration of
 * user journeys. Each top-level section (`## N. Name`) groups one or more
 * `### @cjm-N.M Title` anchors. The constitutional invariant: every section
 * MUST have at least one happy-path anchor AND at least one negative-twin
 * anchor (keywords: negative, twin, error, fails, rejected, invalid,
 * malformed). The matching .feature files in `tests/e2e-cjm/features/`
 * carry `@cjm-N.M` Gherkin tags that point back to the doc anchors.
 *
 * Three modes:
 *
 *   1. Default (no `--features` flag): parse the CJM doc, group anchors by
 *      major number, and assert each group has ≥ 2 anchors with at least
 *      one negative-twin keyword in its heading.
 *
 *   2. `--features <glob>`: additionally glob all .feature files under the
 *      directory and assert every `@cjm-N.M` Gherkin tag has a matching
 *      `### @cjm-N.M` heading in the CJM doc. Orphan tags exit 1.
 *
 *   3. `--check-expected-red` (requires `--features`): additionally assert
 *      every `@expected-red` tag is paired with an `@after-phase-N` tag on
 *      the same Scenario-tag line. Unpaired `@expected-red` exits 1.
 *
 * Exit codes (mirrors `tools/lint-english.ts` and `lint-weak-assertions.ts`):
 *   0 — no offenders
 *   1 — at least one offender (each printed to stderr as
 *       `file:line:col  message`)
 *   2 — internal error during scan (e.g. CJM doc not found)
 *
 * Usage:
 *   pnpm tsx tools/lint-cjm-doc.ts [docs/customer-journeys.md]
 *   pnpm tsx tools/lint-cjm-doc.ts [doc.md] --features tests/e2e-cjm/features
 *   pnpm tsx tools/lint-cjm-doc.ts [doc.md] --features <dir> --check-expected-red
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Anchor {
  major: number;
  minor: number;
  title: string;
  line: number;
}

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

const ANCHOR_RE = /^###\s+@cjm-(\d+)\.(\d+)\s+(.+)$/gm;
const NEG_RE = /negative|twin|error|fails|rejected|invalid|malformed/i;
const SECTION_HEADING_RE = /^##\s+(\d+)\.\s+/gm;
const FEATURE_TAG_LINE_RE = /^\s*@cjm-(\d+)\.(\d+)(.*)$/gm;
// Scenario-tag lines may carry MULTIPLE @cjm tags AND additional @-tags
// (e.g. `@cjm-1.1 @expected-red @after-phase-12`). We split on whitespace
// and walk tokens.

/**
 * Extract every `### @cjm-N.M Title` heading. Returns a stable-ordered list.
 */
export function extractAnchors(text: string): Anchor[] {
  const out: Anchor[] = [];
  ANCHOR_RE.lastIndex = 0;
  for (const m of text.matchAll(ANCHOR_RE)) {
    /* c8 ignore next — matchAll always sets index; defense-in-depth only */
    if (m.index === undefined) continue;
    const before = text.slice(0, m.index);
    const line = before.split("\n").length;
    out.push({
      major: Number.parseInt(m[1], 10),
      minor: Number.parseInt(m[2], 10),
      title: m[3].trim(),
      line,
    });
  }
  return out;
}

/**
 * Mode-1 linter — assert every section has ≥ 2 anchors and at least one
 * negative-twin keyword in its headings.
 */
export function lintCjmDoc(text: string, file = "docs/customer-journeys.md"): Offender[] {
  const offenders: Offender[] = [];
  const anchors = extractAnchors(text);
  const sections = new Set<number>();
  SECTION_HEADING_RE.lastIndex = 0;
  for (const m of text.matchAll(SECTION_HEADING_RE)) {
    sections.add(Number.parseInt(m[1], 10));
  }
  // Union the section-set from H2 headings with the major-numbers from
  // anchors — a freshly authored fixture may only declare anchors without
  // H2 wrappers, and the lint should still apply.
  for (const a of anchors) sections.add(a.major);

  for (const major of [...sections].sort((a, b) => a - b)) {
    const group = anchors.filter((a) => a.major === major);
    if (group.length < 2) {
      const lineHint = group[0]?.line ?? 1;
      offenders.push({
        file,
        line: lineHint,
        col: 1,
        message: `section ${major} has ${group.length} anchor(s); expected ≥ 2 (happy + at least one negative twin)`,
      });
      continue;
    }
    const hasNegative = group.some((a) => NEG_RE.test(a.title));
    if (!hasNegative) {
      offenders.push({
        file,
        line: group[0].line,
        col: 1,
        message: `section ${major} has no negative-twin anchor (no heading contains: negative|twin|error|fails|rejected|invalid|malformed)`,
      });
    }
  }
  return offenders;
}

export interface FeatureTags {
  cjm: Array<{ major: number; minor: number; line: number }>;
  expectedRed: Array<{ line: number; afterPhase: number | null; raw: string }>;
}

/**
 * Extract @cjm-N.M tags AND @expected-red ↔ @after-phase-N pairing data
 * from a .feature file body.
 */
export function extractFeatureTags(text: string): FeatureTags {
  const lines = text.split("\n");
  const cjm: FeatureTags["cjm"] = [];
  const expectedRed: FeatureTags["expectedRed"] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const tokens = raw
      .trim()
      .split(/\s+/)
      .filter((t) => t.startsWith("@"));
    if (tokens.length === 0) continue;
    for (const t of tokens) {
      const m = /^@cjm-(\d+)\.(\d+)$/.exec(t);
      if (m) {
        cjm.push({
          major: Number.parseInt(m[1], 10),
          minor: Number.parseInt(m[2], 10),
          line: i + 1,
        });
      }
    }
    if (tokens.includes("@expected-red")) {
      const phaseTok = tokens.find((t) => /^@after-phase-\d+$/.test(t));
      const phase = phaseTok ? Number.parseInt(phaseTok.replace("@after-phase-", ""), 10) : null;
      expectedRed.push({ line: i + 1, afterPhase: phase, raw: raw.trim() });
    }
  }
  return { cjm, expectedRed };
}

/**
 * Mode-2 linter — for every `@cjm-N.M` tag in a feature file, assert a
 * matching `### @cjm-N.M` heading exists in the CJM doc body.
 */
export function lintFeatureCrossRef(
  docText: string,
  featureContents: Map<string, string>,
): Offender[] {
  const anchors = new Set(extractAnchors(docText).map((a) => `${a.major}.${a.minor}`));
  const offenders: Offender[] = [];
  for (const [file, text] of featureContents) {
    const { cjm } = extractFeatureTags(text);
    for (const tag of cjm) {
      const key = `${tag.major}.${tag.minor}`;
      if (!anchors.has(key)) {
        offenders.push({
          file,
          line: tag.line,
          col: 1,
          message: `orphan tag @cjm-${key} — no matching '### @cjm-${key}' heading in CJM doc`,
        });
      }
    }
  }
  return offenders;
}

/**
 * Mode-3 linter — assert every `@expected-red` carries a paired
 * `@after-phase-N` on the same tag line.
 */
export function lintExpectedRedPairing(featureContents: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, text] of featureContents) {
    const { expectedRed } = extractFeatureTags(text);
    for (const er of expectedRed) {
      if (er.afterPhase === null) {
        offenders.push({
          file,
          line: er.line,
          col: 1,
          message: `@expected-red without paired @after-phase-N tag`,
        });
      }
    }
  }
  return offenders;
}

/** Recursively collect every `*.feature` file under `dir`. */
export function collectFeatureFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      /* c8 ignore next — race: file disappears between readdir + stat */
      continue;
    }
    if (st === undefined) continue;
    if (st.isDirectory()) {
      out.push(...collectFeatureFiles(full));
    } else if (entry.endsWith(".feature")) {
      out.push(full);
    }
  }
  return out;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ParsedArgs {
  doc: string;
  featuresDir: string | null;
  checkExpectedRed: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let doc = "docs/customer-journeys.md";
  let featuresDir: string | null = null;
  let checkExpectedRed = false;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--features") {
      featuresDir = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--check-expected-red") {
      checkExpectedRed = true;
    } else if (!a.startsWith("--")) {
      positionals.push(a);
    }
  }
  if (positionals.length > 0) doc = positionals[0];
  return { doc, featuresDir, checkExpectedRed };
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`CJM lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { doc, featuresDir, checkExpectedRed } = parseArgs(argv);
  const docPath = resolve(cwd, doc);
  let docText: string;
  try {
    docText = readFileSync(docPath, "utf8");
  } catch (err) {
    stderr(`lint-cjm-doc: internal error: ${String(err)}\n`);
    return 2;
  }
  const offenders: Offender[] = lintCjmDoc(docText, docPath);

  if (featuresDir !== null) {
    const featDir = resolve(cwd, featuresDir);
    const files = collectFeatureFiles(featDir);
    const featureContents = new Map<string, string>();
    for (const f of files) {
      try {
        featureContents.set(f, readFileSync(f, "utf8"));
      } catch {
        /* unreadable feature file — skip; lint can't speak about it. */
      }
    }
    offenders.push(...lintFeatureCrossRef(docText, featureContents));
    if (checkExpectedRed) {
      offenders.push(...lintExpectedRedPairing(featureContents));
    }
  }

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(`CJM lint passed: ${docPath} (${extractAnchors(docText).length} anchors)\n`);
  return 0;
}

/* c8 ignore start — CLI bootstrap; behavior covered by subprocess tests. */
async function main(): Promise<void> {
  const code = await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
  exit(code);
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsCli) {
  main().catch((err) => {
    process.stderr.write(`lint-cjm-doc: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
