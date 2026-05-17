#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * check-expected-red-staleness.ts — weekly staleness reporter for
 * `@expected-red @after-phase-N` Gherkin tags.
 *
 * Phase 49 / Plan 49-01 / L8.
 *
 * Closes L8 from `.planning/qa-audit/2026-05-16-test-layering.md`. The
 * audit doc flagged that 14 of 44 CJM scenarios were `@expected-red`
 * with no mechanism to alert if a scenario stayed RED past its named
 * phase ETA. This script is invoked by a weekly GHA cron workflow and:
 *
 *   1. Walks `tests/e2e-cjm/features/**\/*.feature`
 *   2. Extracts every `@expected-red @after-phase-N[.M][-SUFFIX]` pair
 *   3. Cross-references `.planning/ROADMAP.md` to find each phase's
 *      `closed: <YYYY-MM-DD>` marker (or `Status: CLOSED <date>` form)
 *   4. Emits a Markdown report listing scenarios whose phase has been
 *      closed for > STALE_DAYS days (default 7) — those should have
 *      flipped GREEN and have not.
 *
 * Exit codes:
 *   0 — clean (no stale RED scenarios)
 *   1 — at least one stale scenario found (the GHA job uses this to
 *       open/update a tracking issue)
 *   2 — internal error
 *
 * The GHA workflow at `.github/workflows/expected-red-staleness.yml`
 * runs this on a weekly schedule and pipes the Markdown output into
 * `gh issue create --title 'Stale @expected-red scenarios' …` (or
 * `gh issue edit` if the tracking issue already exists, deduplicating
 * via the `staleness-report` label).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface RedScenario {
  file: string;
  line: number;
  scenarioTitle: string;
  phaseTag: string; // e.g. "@after-phase-19.1" or "@after-phase-51-WIRE-11-PUT"
  phaseId: string; // normalized: "19.1", "51-WIRE-11-PUT"
}

export interface StaleScenario extends RedScenario {
  closedAt: string; // ISO YYYY-MM-DD
  daysStale: number;
}

const EXPECTED_RED_RE = /@expected-red(?:\s|$)/;
const AFTER_PHASE_RE = /@after-phase-(\d+(?:\.\d+)?(?:-[A-Z0-9-]+)?)/;
const SCENARIO_RE = /^\s*Scenario(?:\s+Outline)?:\s+(.+?)\s*$/;
const STALE_DAYS_DEFAULT = 7;

/** Walk a feature body and emit one RedScenario per `@expected-red @after-phase-N` Scenario. */
export function extractRedScenarios(text: string, file: string): RedScenario[] {
  const out: RedScenario[] = [];
  const lines = text.split("\n");
  let pendingTagLine: string | null = null;
  let pendingTagLineNo = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.startsWith("@")) {
      pendingTagLine = trimmed;
      pendingTagLineNo = i + 1;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = SCENARIO_RE.exec(raw);
    if (m && pendingTagLine && EXPECTED_RED_RE.test(pendingTagLine)) {
      const phaseM = AFTER_PHASE_RE.exec(pendingTagLine);
      if (phaseM) {
        out.push({
          file,
          line: pendingTagLineNo,
          scenarioTitle: m[1].trim(),
          phaseTag: `@after-phase-${phaseM[1]}`,
          phaseId: phaseM[1],
        });
      }
      pendingTagLine = null;
      continue;
    }
    pendingTagLine = null;
  }
  return out;
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
      /* c8 ignore next — race */
      continue;
    }
    if (!st) continue;
    if (st.isDirectory()) out.push(...collectFeatureFiles(full));
    else if (entry.endsWith(".feature")) out.push(full);
  }
  return out;
}

/**
 * Parse ROADMAP.md and produce a Map<phaseId, ISODate> of closure dates.
 * Recognizes lines of the form:
 *   - `[x] **Phase N: Title** — CLOSED YYYY-MM-DD`
 *   - `### Phase N: Title — CLOSED YYYY-MM-DD`
 *   - `closed: YYYY-MM-DD` (lowercase frontmatter / inline)
 * The phaseId is the bare numeric `N` or `N.M`; suffixed forms
 * (`51-WIRE-11-PUT`) are matched by numeric prefix.
 */
export function parseRoadmapClosures(roadmapText: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = roadmapText.split("\n");
  const reClosed = /\b(?:CLOSED|closed)\s+(\d{4}-\d{2}-\d{2})/;
  const rePhaseId = /Phase\s+(\d+(?:\.\d+)?)/i;
  for (const line of lines) {
    const c = reClosed.exec(line);
    if (!c) continue;
    const p = rePhaseId.exec(line);
    if (!p) continue;
    const phaseId = p[1];
    if (!out.has(phaseId)) out.set(phaseId, c[1]);
  }
  return out;
}

/** Match a scenario's phase tag (may carry a `-SUFFIX`) to a ROADMAP closure. */
function findClosureFor(closures: Map<string, string>, phaseId: string): string | undefined {
  // Exact match first.
  const direct = closures.get(phaseId);
  if (direct) return direct;
  // Numeric prefix match for `N-SUFFIX` forms.
  const prefix = phaseId.split("-")[0];
  return closures.get(prefix);
}

/** Filter to scenarios whose phase has been closed for ≥ staleDays days. */
export function findStale(
  scenarios: readonly RedScenario[],
  closures: Map<string, string>,
  now: Date,
  staleDays: number,
): StaleScenario[] {
  const out: StaleScenario[] = [];
  for (const s of scenarios) {
    const closedAt = findClosureFor(closures, s.phaseId);
    if (!closedAt) continue;
    const closedDate = new Date(`${closedAt}T00:00:00Z`);
    if (Number.isNaN(closedDate.getTime())) continue;
    const daysStale = Math.floor((now.getTime() - closedDate.getTime()) / 86400_000);
    if (daysStale >= staleDays) {
      out.push({ ...s, closedAt, daysStale });
    }
  }
  return out;
}

/** Build the GitHub-issue body. */
export function renderReport(stale: readonly StaleScenario[], now: Date): string {
  if (stale.length === 0) {
    return `# Stale @expected-red scenarios\n\n_Generated ${now.toISOString()}_\n\nNone — every \`@expected-red\` scenario's named phase is either still open or closed less than the staleness window.\n`;
  }
  let out = `# Stale @expected-red scenarios\n\n_Generated ${now.toISOString()}_\n\nThe following \`@expected-red\` scenarios reference a phase that closed but they did not flip GREEN. Each is a regression sentinel that needs investigation.\n\n| Scenario | Phase tag | Closed | Days stale | File |\n|---|---|---|---|---|\n`;
  for (const s of stale) {
    out += `| ${s.scenarioTitle} | \`${s.phaseTag}\` | ${s.closedAt} | ${s.daysStale} | ${s.file}:${s.line} |\n`;
  }
  return out;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  now: Date;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function parseArgs(argv: readonly string[]): {
  features: string;
  roadmap: string;
  staleDays: number;
} {
  let features = "tests/e2e-cjm/features";
  let roadmap = ".planning/ROADMAP.md";
  let staleDays = STALE_DAYS_DEFAULT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--features") {
      features = argv[i + 1] ?? features;
      i += 1;
    } else if (argv[i] === "--roadmap") {
      roadmap = argv[i + 1] ?? roadmap;
      i += 1;
    } else if (argv[i] === "--stale-days") {
      const v = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isNaN(v)) staleDays = v;
      i += 1;
    }
  }
  return { features, roadmap, staleDays };
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, now, stdout, stderr } = opts;
  const { features, roadmap, staleDays } = parseArgs(argv);
  let roadmapText: string;
  try {
    roadmapText = readFileSync(resolve(cwd, roadmap), "utf8");
  } catch (err) {
    stderr(`check-expected-red-staleness: cannot read ROADMAP: ${String(err)}\n`);
    return 2;
  }
  const closures = parseRoadmapClosures(roadmapText);

  const scenarios: RedScenario[] = [];
  for (const f of collectFeatureFiles(resolve(cwd, features))) {
    try {
      scenarios.push(...extractRedScenarios(readFileSync(f, "utf8"), f));
    } catch {
      /* c8 ignore next — unreadable */
    }
  }

  const stale = findStale(scenarios, closures, now, staleDays);
  stdout(renderReport(stale, now));
  return stale.length > 0 ? 1 : 0;
}

/* c8 ignore start — CLI bootstrap; behavior covered by colocated tests. */
async function main(): Promise<void> {
  const code = await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    now: new Date(),
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
    process.stderr.write(`check-expected-red-staleness: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
