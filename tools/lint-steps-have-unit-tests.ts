#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-steps-have-unit-tests.ts — every Gherkin step binding MUST have
 * sibling vitest coverage with the HTTP boundary mocked.
 *
 * Phase 21 / Plan 21-03 / SR-21.3.
 *
 * Two invariants over `tests/e2e-cjm/steps/*.steps.ts`:
 *
 *   1. Every `<name>.steps.ts` MUST have a sibling
 *      `__tests__/<name>.steps.test.ts` (or be on the allowlist).
 *      Enforces memory `feedback_cjm_steps_need_unit_tests`: without
 *      unit coverage, URL/payload bugs hide behind 30 s compose-debug
 *      cycles instead of surfacing at lint-time.
 *
 *   2. Every present unit-test file MUST import a boundary-mock symbol
 *      (one of: `vi.spyOn`, `nock`, `msw`, or contain the literal
 *      `mockFetch`). Heuristic — catches the obvious failure mode where
 *      a unit test was created to pass the linter but does no actual
 *      mocking, making the e2e and unit tiers indistinguishable.
 *
 * The allowlist (`tools/lint-steps-have-unit-tests.allowlist.txt`) names
 * pre-existing step files that lack unit tests. It MUST NOT grow — new
 * step files added by Phase 24..32 MUST ship with their unit tests in
 * the same atomic commit.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one offender
 *   2 — internal error
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

const BOUNDARY_MOCK_PATTERNS = [
  /\bvi\.spyOn\b/,
  /\bvi\.fn\(\)/, // `vi.fn()` used as a fetch stub is a valid boundary mock (assigned to `fetchSpy`, then mockResolvedValue)
  /\bvi\.stubGlobal\b/, // vi.stubGlobal('fetch', …) pattern
  /\bnock\b/,
  /\bmsw\b/,
  /\bmockFetch\b/,
  /\bfetchSpy\b/, // by-name spy assigned from vi.fn()
  /\bsetupServer\b/, // msw/node convenience
];

// HTTP-surface markers — if a unit test references NONE of these symbols,
// it is asserting pure-function behaviour (e.g. cert-path regex helpers)
// and does not need a boundary mock. The boundary-mock rule only applies
// when the test actually crosses the HTTP boundary.
const HTTP_SURFACE_PATTERNS = [
  /\bfetch\(/,
  /\bundici\b/,
  /\baxios\b/,
  /\bhttp\.request\b/,
  /\bnew\s+URL\(/,
  /\bsuperagent\b/,
  /\bgot\b/,
  // Boundary-mock imports themselves imply HTTP-boundary involvement.
  /\bvi\.spyOn\b/,
  /\bnock\b/,
  /\bmsw\b/,
  /\bmockFetch\b/,
];

/** Read an allowlist file; one repo-relative path per line; # = comment. */
export function loadAllowlist(allowlistPath: string): Set<string> {
  const out = new Set<string>();
  let body: string;
  try {
    body = readFileSync(allowlistPath, "utf8");
  } catch {
    return out;
  }
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

/** Collect every `*.steps.ts` file under `dir`, excluding `__tests__/`. */
export function collectStepFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry === "node_modules") continue;
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
      out.push(...collectStepFiles(full));
    } else if (entry.endsWith(".steps.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Rule 1 — every step file MUST have a sibling
 * `__tests__/<name>.steps.test.ts`. The allowlist exempts pre-existing
 * step files that document their absent unit tests as known debt.
 */
export function lintSiblingUnitTestExists(
  stepFiles: readonly string[],
  allowlistAbsPaths: ReadonlySet<string>,
): Offender[] {
  const offenders: Offender[] = [];
  for (const file of stepFiles) {
    if (allowlistAbsPaths.has(file)) continue;
    const dir = dirname(file);
    const name = basename(file, ".steps.ts");
    const sibling = resolve(dir, "__tests__", `${name}.steps.test.ts`);
    if (!existsSync(sibling)) {
      offenders.push({
        file,
        line: 1,
        col: 1,
        message: `missing sibling unit test — expected ${sibling.replace(`${dir}/`, "")} (feedback_cjm_steps_need_unit_tests: every steps.ts MUST have HTTP-boundary-mocked vitest coverage)`,
      });
    }
  }
  return offenders;
}

/**
 * Rule 2 — every unit-test file MUST contain at least one boundary-mock
 * pattern. `unitContents` is a Map<unit-test-path, file-body>.
 * `_stepContents` is reserved for future use (e.g. cross-referencing which
 * fetch URLs a steps.ts file calls).
 */
export function lintBoundaryMocked(
  unitContents: Map<string, string>,
  _stepContents: Map<string, string>,
): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, body] of unitContents) {
    // Pure-function tests (no HTTP surface) are exempt.
    if (!HTTP_SURFACE_PATTERNS.some((re) => re.test(body))) continue;
    if (BOUNDARY_MOCK_PATTERNS.some((re) => re.test(body))) continue;
    offenders.push({
      file,
      line: 1,
      col: 1,
      message: `unit test crosses an HTTP boundary but mocks none — expected one of: vi.spyOn / nock / msw / mockFetch / setupServer`,
    });
  }
  return offenders;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function parseArgs(argv: readonly string[]): { stepsDir: string; allowlist: string } {
  let stepsDir = "tests/e2e-cjm/steps";
  let allowlist = "tools/lint-steps-have-unit-tests.allowlist.txt";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--steps-dir") {
      stepsDir = argv[i + 1] ?? stepsDir;
      i += 1;
    } else if (argv[i] === "--allowlist") {
      allowlist = argv[i + 1] ?? allowlist;
      i += 1;
    }
  }
  return { stepsDir, allowlist };
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`Steps-unit-test lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { stepsDir, allowlist } = parseArgs(argv);
  const stepsAbs = resolve(cwd, stepsDir);
  const allowlistAbs = resolve(cwd, allowlist);
  const allowlistRel = loadAllowlist(allowlistAbs);
  const allowlistAbsSet = new Set([...allowlistRel].map((p) => resolve(cwd, p)));

  const stepFiles = collectStepFiles(stepsAbs);
  const unitDir = resolve(stepsAbs, "__tests__");
  const unitFiles: string[] = [];
  try {
    for (const entry of readdirSync(unitDir)) {
      if (entry.endsWith(".test.ts")) unitFiles.push(resolve(unitDir, entry));
    }
  } catch {
    /* __tests__/ may not exist yet — that's fine */
  }
  const unitContents = new Map<string, string>();
  for (const f of unitFiles) {
    try {
      unitContents.set(f, readFileSync(f, "utf8"));
    } catch {
      /* c8 ignore next — unreadable, skip */
    }
  }

  const offenders: Offender[] = [
    ...lintSiblingUnitTestExists(stepFiles, allowlistAbsSet),
    ...lintBoundaryMocked(unitContents, new Map()),
  ];

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(
    `Steps-unit-test lint passed: ${stepFiles.length} step file(s), ${unitFiles.length} unit test(s), ${allowlistRel.size} on allowlist\n`,
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
    process.stderr.write(`lint-steps-have-unit-tests: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
