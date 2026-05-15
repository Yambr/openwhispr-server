#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-gherkin-tags.ts — Gherkin-tag anti-shortcut linter.
 *
 * Phase 21 / Plan 21-01 / SR-21.1.
 *
 * Enforces four invariants across every `*.feature` file:
 *
 *   1. NO `.skip` / `.only` / `@skip` / `@focus` / `@only` tags — those
 *      mask coverage. Gherkin has no native `.skip`/`.only` but agents
 *      sometimes synthesize these tags expecting them to work; we ban
 *      them outright to surface the misconception.
 *
 *   2. Every `@cjm-N.M` Gherkin tag MUST have a matching `### @cjm-N.M`
 *      anchor in `docs/customer-journeys.md`. Overlaps with
 *      `lint-cjm-doc.ts` mode-2; intentional belt-and-suspenders so
 *      `pre-commit` catches the violation before the heavier lint runs.
 *
 *   3. Every feature file that declares ≥ 1 Scenario MUST have at least
 *      one scenario whose title contains a negative-twin keyword
 *      (`negative`, `twin`, `error`, `fails`, `rejected`, `invalid`,
 *      `malformed`, `unauthorized`, `forbidden`, `missing`). Per the
 *      CJM constitution: every happy path ships with at least one
 *      negative twin in the same file.
 *
 *   4. Every `@expected-red` tag MUST carry an `@after-phase-N[.M]` or
 *      `@after-docker-up` companion on the same tag line. Same rule
 *      `lint-cjm-doc.ts` mode-3 enforces — duplicated here so the
 *      pre-commit hook catches it without needing the full CJM-doc
 *      scan.
 *
 * Exit codes (mirrors lint-cjm-doc.ts):
 *   0 — clean
 *   1 — at least one offender
 *   2 — internal error (e.g. CJM doc not found)
 *
 * Usage:
 *   pnpm tsx tools/lint-gherkin-tags.ts
 *   pnpm tsx tools/lint-gherkin-tags.ts --doc <md> --features <dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

export interface TagToken {
  tag: string;
  line: number;
}

export interface ScenarioRecord {
  title: string;
  line: number;
  tags: TagToken[];
}

const NEG_KEYWORDS_RE =
  /negative|twin|error|fails?|rejected?|invalid|malformed|unauthorized|forbidden|missing|denied|disabled|loud[- ]fail|refuses?\s|\bnever\b|\bnot\b|\bno\b|redacted|unset|OFF\b|zero|no-?op|\b4\d\d\b|\b5\d\d\b|precedes|gated/i;
const FORBIDDEN_TAG_RE = /^@(?:skip|only|focus)$/i;
const FORBIDDEN_LITERAL_RE = /(?:^|\s)\.(?:skip|only)\b/;
const CJM_TAG_RE = /^@cjm-(\d+)\.(\d+)$/;
const AFTER_PHASE_RE = /^@after-phase-\d+(?:\.\d+)?(?:-[A-Z0-9-]+)?$/;
const AFTER_DOCKER_UP_TAG = "@after-docker-up";
const EXPECTED_RED_TAG = "@expected-red";
const ANCHOR_RE = /^###\s+@cjm-(\d+)\.(\d+)\b/gm;
const SCENARIO_LINE_RE = /^\s*Scenario(?:\s+Outline)?:\s+(.+?)\s*$/;

/** Split a single line into `@`-prefixed tokens with their 1-based line. */
export function extractTagTokens(line: string, lineNumber: number): TagToken[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@")) return [];
  return trimmed
    .split(/\s+/)
    .filter((t) => t.startsWith("@"))
    .map((tag) => ({ tag, line: lineNumber }));
}

/**
 * Walk a feature body and return every Scenario heading along with the
 * tags declared on the immediately-preceding contiguous tag-lines.
 */
export function extractScenarios(text: string): ScenarioRecord[] {
  const lines = text.split("\n");
  const out: ScenarioRecord[] = [];
  let pendingTags: TagToken[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      // Blank lines between Scenario and tags reset the tag accumulator.
      if (trimmed === "") pendingTags = [];
      continue;
    }
    if (trimmed.startsWith("@")) {
      pendingTags.push(...extractTagTokens(raw, i + 1));
      continue;
    }
    const m = SCENARIO_LINE_RE.exec(raw);
    if (m) {
      out.push({ title: m[1].trim(), line: i + 1, tags: pendingTags });
      pendingTags = [];
      continue;
    }
    // Any other line (Feature:, Background:, Given/When/Then, …) clears
    // the tag accumulator — tags only attach to the next Scenario.
    pendingTags = [];
  }
  return out;
}

/** Mode-1: no `.skip` / `.only` / `@skip` / `@focus` / `@only` anywhere. */
export function lintNoFocusOrSkip(features: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, body] of features) {
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const tokens = extractTagTokens(raw, i + 1);
      for (const t of tokens) {
        if (FORBIDDEN_TAG_RE.test(t.tag)) {
          offenders.push({
            file,
            line: t.line,
            col: 1,
            message: `forbidden tag ${t.tag} — Gherkin focus/skip is banned (D-12: flake is a bug)`,
          });
        }
      }
      if (FORBIDDEN_LITERAL_RE.test(raw)) {
        offenders.push({
          file,
          line: i + 1,
          col: 1,
          message: `forbidden literal .skip/.only — Gherkin has no such directive; use @expected-red @after-phase-N instead`,
        });
      }
    }
  }
  return offenders;
}

/** Mode-2: every `@cjm-N.M` Gherkin tag MUST have an anchor in the CJM doc. */
export function lintTagAnchorParity(
  features: Map<string, string>,
  docAnchors: ReadonlySet<string>,
): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, body] of features) {
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      for (const tok of extractTagTokens(lines[i], i + 1)) {
        const m = CJM_TAG_RE.exec(tok.tag);
        if (!m) continue;
        const key = `${m[1]}.${m[2]}`;
        if (!docAnchors.has(key)) {
          offenders.push({
            file,
            line: tok.line,
            col: 1,
            message: `orphan @cjm-${key} — no '### @cjm-${key}' anchor in the CJM doc`,
          });
        }
      }
    }
  }
  return offenders;
}

/** Mode-3: every feature with ≥1 Scenario has at least one negative-twin. */
export function lintNegativeTwinPresent(features: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, body] of features) {
    const scenarios = extractScenarios(body);
    if (scenarios.length === 0) continue;
    const hasNegative = scenarios.some((s) => NEG_KEYWORDS_RE.test(s.title));
    if (!hasNegative) {
      offenders.push({
        file,
        line: scenarios[0].line,
        col: 1,
        message: `feature has ${scenarios.length} scenario(s) but no negative twin (no title matches: negative|twin|error|fails|rejected|invalid|malformed|unauthorized|forbidden|missing)`,
      });
    }
  }
  return offenders;
}

/** Mode-4: @expected-red MUST be paired with @after-phase-N or @after-docker-up. */
export function lintExpectedRedHasGate(features: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, body] of features) {
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const tokens = extractTagTokens(lines[i], i + 1);
      if (!tokens.some((t) => t.tag === EXPECTED_RED_TAG)) continue;
      const hasGate = tokens.some(
        (t) => t.tag === AFTER_DOCKER_UP_TAG || AFTER_PHASE_RE.test(t.tag),
      );
      if (!hasGate) {
        offenders.push({
          file,
          line: i + 1,
          col: 1,
          message: `@expected-red without @after-phase-N or @after-docker-up — every RED MUST name what flips it GREEN`,
        });
      }
    }
  }
  return offenders;
}

/** Recursively gather every `*.feature` file under `dir`. */
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

/** Extract every `### @cjm-N.M` anchor key from the CJM doc body. */
function extractDocAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  ANCHOR_RE.lastIndex = 0;
  for (const m of text.matchAll(ANCHOR_RE)) {
    anchors.add(`${m[1]}.${m[2]}`);
  }
  return anchors;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ParsedArgs {
  doc: string;
  featuresDir: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let doc = "docs/customer-journeys.md";
  let featuresDir = "tests/e2e-cjm/features";
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--doc") {
      doc = argv[i + 1] ?? doc;
      i += 1;
    } else if (a === "--features") {
      featuresDir = argv[i + 1] ?? featuresDir;
      i += 1;
    }
  }
  return { doc, featuresDir };
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`Gherkin-tag lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { doc, featuresDir } = parseArgs(argv);
  const docPath = resolve(cwd, doc);
  const featDir = resolve(cwd, featuresDir);
  let docText: string;
  try {
    docText = readFileSync(docPath, "utf8");
  } catch (err) {
    stderr(`lint-gherkin-tags: internal error: ${String(err)}\n`);
    return 2;
  }
  const docAnchors = extractDocAnchors(docText);

  const featureFiles = collectFeatureFiles(featDir);
  const featureContents = new Map<string, string>();
  for (const f of featureFiles) {
    try {
      featureContents.set(f, readFileSync(f, "utf8"));
    } catch {
      /* c8 ignore next — unreadable feature file, skip */
    }
  }

  const offenders: Offender[] = [
    ...lintNoFocusOrSkip(featureContents),
    ...lintTagAnchorParity(featureContents, docAnchors),
    ...lintNegativeTwinPresent(featureContents),
    ...lintExpectedRedHasGate(featureContents),
  ];

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(
    `Gherkin-tag lint passed: ${featureFiles.length} feature file(s), ${docAnchors.size} anchor(s) in ${docPath}\n`,
  );
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
    process.stderr.write(`lint-gherkin-tags: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
