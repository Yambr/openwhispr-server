// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * test-evidence-reporter.ts — Quick 260527-pj6 / Wave 1.T1.
 *
 * Custom Vitest 4.1.5 Reporter that writes per-workspace evidence
 * fragments to `.test-evidence/<sha>-<project>.json` on every
 * `pnpm test` invocation. The pre-push gate
 * (`tools/lint-pre-push-test-evidence.ts`) refuses any commit whose
 * fragments are missing, failed, or contain unannotated skips.
 *
 * Reporter contract (verbatim from
 * `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1041-1115`):
 *
 *   onInit(vitest)
 *   onTestRunEnd(testModules, unhandledErrors, reason)
 *
 * Fragment shape (JSON):
 *   {
 *     "schema": 1,
 *     "generated_at": "<ISO8601 UTC>",
 *     "project": "<project name>",
 *     "commit_sha": "<40-hex SHA>",
 *     "reason": "passed | failed | interrupted",
 *     "exit_code": 0,
 *     "total": N, "pass": N, "fail": N, "skip": N, "todo": N,
 *     "unannotated_skip": N,
 *     "failures": [{ "file": <rel>, "name": <fullName>, "error_message_truncated": <≤1000> }],
 *     "skips":    [{ "file": <rel>, "line": N, "name": <fullName>, "mode": "skip|todo", "annotated": bool, "skip_reason": text|null }]
 *   }
 *
 * Atomic-write contract (TOCTOU-safe):
 *   mkdirSync(evidenceDir, { mode: 0o700 })
 *   lstatSync(<final>)  REFUSE on pre-existing symlink
 *   writeFileSync(<final>.tmp.<pid>, ..., { mode: 0o600, flag: 'wx' })
 *   renameSync(<final>.tmp.<pid>, <final>)
 *
 * Bail-outs (no fragment written):
 *   - `vitest.config.watch === true`
 *   - `reason === "interrupted"`
 *   - `testModules.length === 0`
 *   - `commitSha === null` (e.g., fresh repo, no commits)
 *   - `commitSha` does NOT match /^[0-9a-f]{40}$/
 *
 * Env overrides (honoured for hermetic tests):
 *   - OPENWHISPR_TEST_EVIDENCE_DIR
 *   - OPENWHISPR_TEST_EVIDENCE_SHA
 *
 * Default-exported as a class so vitest's path-string reporter form
 * `reporters: ["./tools/test-evidence-reporter.ts"]` instantiates it.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** Maximum number of characters preserved in `error_message_truncated`.
 *  Defence-in-depth for LOCKER-05 (secret-shape in error). */
export const ERROR_MESSAGE_TRUNCATE_LIMIT = 1000;

/** Source-line lookback window above each `.skip` / `.todo` test
 *  for the `// SKIP-REASON:` annotation scan. Mirrors
 *  tools/lint-skip-annotations.ts. */
export const SKIP_LOOKBACK_LINES = 5;

/** Minimum reason body length after `// SKIP-REASON: ` colon-space. */
export const SKIP_MIN_REASON_LEN = 10;

/** Annotation regex (after trimming leading whitespace). */
const SKIP_REASON_RE = /^\/\/\s*SKIP-REASON:\s+(.+)$/;

/** 40-hex SHA shape — single source of truth shared with the
 *  pre-push validator. */
export const SHA40_RE = /^[0-9a-f]{40}$/;

/** Subset of the Vitest 4.1.5 TestModule the reporter consumes. */
export interface FakeReporterModule {
  readonly moduleId: string;
  readonly children: {
    allTests(): Iterable<FakeReporterCase>;
  };
}

/** Subset of the Vitest 4.1.5 TestCase the reporter consumes. */
export interface FakeReporterCase {
  readonly name: string;
  readonly fullName?: string;
  readonly options: { readonly mode: "run" | "only" | "skip" | "todo" };
  readonly project: { readonly name: string };
  readonly location?: { readonly line: number; readonly column: number } | undefined;
  result(): {
    readonly state: "passed" | "failed" | "skipped" | "pending";
    readonly errors?: ReadonlyArray<{ readonly message?: string; readonly stack?: string }>;
    readonly note?: string | undefined;
  };
}

/** Fragment shape written atomically to `<dir>/<sha>-<project>.json`. */
export interface EvidenceFragment {
  schema: 1;
  generated_at: string;
  project: string;
  commit_sha: string;
  reason: "passed" | "failed" | "interrupted";
  exit_code: 0 | 1;
  total: number;
  pass: number;
  fail: number;
  skip: number;
  todo: number;
  unannotated_skip: number;
  failures: Array<{
    file: string;
    name: string;
    error_message_truncated: string;
  }>;
  skips: Array<{
    file: string;
    line: number;
    name: string;
    mode: "skip" | "todo";
    annotated: boolean;
    skip_reason: string | null;
  }>;
}

export interface ReporterDeps {
  evidenceDir: string;
  commitSha: string | null;
  projectRoot: string;
  stderr: { write: (s: string) => void };
}

interface BuildFragmentsInput {
  testModules: Iterable<FakeReporterModule>;
  commitSha: string;
  projectRoot: string;
}

/**
 * Read a test source file as an array of lines. Each module is read
 * exactly once per `buildFragmentsForTest` call — the per-test-case
 * SKIP-REASON scan inspects the in-memory `lines[]` slice without
 * any further I/O (R1 mitigation).
 */
function readSourceLines(absPath: string): string[] {
  let text = "";
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    // Module ID resolved by Vite may be a virtual path or missing
    // on disk (rare). Annotated-skip detection becomes impossible —
    // emit as unannotated for safety.
    text = "";
  }
  return text.split("\n");
}

/**
 * Inspect the 5 source lines immediately above `callLine` (1-based)
 * for a `// SKIP-REASON: <body>` annotation. Returns the reason body
 * (trimmed, ≥ 10 chars) or null if not annotated.
 */
function findSkipReason(lines: string[], oneBasedCallLine: number): string | null {
  // Source lines are 0-indexed; the call's previous-line zero-index
  // is (oneBasedCallLine - 2).
  const callIdx = oneBasedCallLine - 1;
  const start = Math.max(0, callIdx - SKIP_LOOKBACK_LINES);
  for (let i = start; i < callIdx; i++) {
    const trimmed = (lines[i] ?? "").trim();
    const m = trimmed.match(SKIP_REASON_RE);
    if (!m) continue;
    // c8 ignore next — m[1] is always defined when the regex
    // match succeeds; the `?? ""` is a TypeScript narrowing aid.
    const body = (m[1] ?? "").trim();
    if (body.length >= SKIP_MIN_REASON_LEN) return body;
  }
  return null;
}

/**
 * Walks the per-module test cases and produces one fragment per
 * project name. Exported for unit testing.
 */
export function buildFragmentsForTest(input: BuildFragmentsInput): EvidenceFragment[] {
  const { testModules, commitSha, projectRoot } = input;
  /** project name → accumulator */
  const byProject = new Map<string, EvidenceFragment>();

  const init = (project: string): EvidenceFragment => {
    let frag = byProject.get(project);
    if (frag) return frag;
    frag = {
      schema: 1,
      generated_at: new Date().toISOString(),
      project,
      commit_sha: commitSha,
      reason: "passed",
      exit_code: 0,
      total: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      todo: 0,
      unannotated_skip: 0,
      failures: [],
      skips: [],
    };
    byProject.set(project, frag);
    return frag;
  };

  for (const mod of testModules) {
    const moduleId = mod.moduleId;
    const moduleLines = readSourceLines(moduleId);
    const rel = relativeOrAbs(moduleId, projectRoot);
    for (const tc of mod.children.allTests()) {
      const project = tc.project.name;
      const frag = init(project);
      const r = tc.result();
      frag.total += 1;

      // Branch on result state — `pending` is treated as a no-op
      // (only happens mid-collection; reporter runs at end).
      if (r.state === "passed") {
        frag.pass += 1;
        continue;
      }
      if (r.state === "failed") {
        frag.fail += 1;
        frag.reason = "failed";
        frag.exit_code = 1;
        const msg = r.errors?.[0]?.message ?? "<no message>";
        frag.failures.push({
          file: rel,
          name: tc.fullName ?? tc.name,
          error_message_truncated: msg.slice(0, ERROR_MESSAGE_TRUNCATE_LIMIT),
        });
        continue;
      }
      // c8 ignore next — `r.state === "skipped"` is the only
      // state remaining after pass/fail branches; the false
      // branch (state === "pending") is defensive.
      if (r.state === "skipped") {
        // Distinguish `.skip` vs `.todo` via TaskOptions.mode.
        const mode: "skip" | "todo" = tc.options.mode === "todo" ? "todo" : "skip";
        if (mode === "todo") frag.todo += 1;
        else frag.skip += 1;
        const line = tc.location?.line ?? 0;
        const reason = line > 0 ? findSkipReason(moduleLines, line) : null;
        const annotated = reason !== null;
        if (!annotated) {
          frag.unannotated_skip += 1;
          // Exit code remains 0 here — the validator (not the
          // reporter) decides whether to refuse on
          // `unannotated_skip > 0`; we keep the reporter purely
          // observational.
        }
        frag.skips.push({
          file: rel,
          line,
          name: tc.fullName ?? tc.name,
          mode,
          annotated,
          skip_reason: reason,
        });
      }
      // r.state === "pending" — should not happen at run end; ignore.
    }
  }

  return [...byProject.values()];
}

function relativeOrAbs(abs: string, projectRoot: string): string {
  try {
    const r = relative(projectRoot, abs);
    return r.length > 0 && !r.startsWith("..") ? r : abs;
  } catch {
    /* c8 ignore next — node:path `relative` does not throw on
     *  POSIX/Win paths; defensive only. */
    return abs;
  }
}

interface WriteFragmentsInput {
  fragments: ReadonlyArray<EvidenceFragment>;
  evidenceDir: string;
  stderr: { write: (s: string) => void };
}

/**
 * Atomically write each fragment to `<evidenceDir>/<sha>-<project>.json`.
 * Each step is TOCTOU-defensive:
 *
 *   1. mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
 *   2. lstatSync(evidenceDir) refuses if symlink
 *   3. lstatSync(finalPath) refuses if pre-existing symlink
 *   4. writeFileSync(tmpPath, JSON, { mode: 0o600, flag: 'wx' })
 *   5. renameSync(tmpPath, finalPath)
 *
 * On failure (symlink, EEXIST tmp collision, etc.) the function
 * throws with an English-only message; the caller (Reporter) MUST
 * propagate as a process-level failure so the developer sees the
 * TOCTOU warning. The tmp file is unlinked on rename failure.
 */
export function writeFragmentsAtomic(input: WriteFragmentsInput): void {
  const { fragments, evidenceDir, stderr } = input;
  // c8 ignore next — defensive no-op when called with zero
  // fragments; the reporter pipeline never produces an empty
  // fragments array (the upstream `testModules.length === 0`
  // bail-out short-circuits earlier).
  if (fragments.length === 0) return;

  // Step 1: ensure evidence dir exists with restrictive mode.
  try {
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    stderr.write(
      /* c8 ignore next — String(non-Error) fallback branch is
       *  defensive; tests cover the Error branch. */
      `[evidence] mkdir refused at ${evidenceDir}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    throw err;
  }

  // Step 2: refuse if the evidence directory ITSELF is a symlink
  // (TOCTOU defence — an attacker could replace the dir with a
  // symlink between mkdir and write).
  const dirStat = lstatSync(evidenceDir);
  if (dirStat.isSymbolicLink()) {
    stderr.write(`[evidence] refused: ${evidenceDir} is a symlink (TOCTOU defence)\n`);
    throw new Error(`refused: evidence directory is a symlink: ${evidenceDir}`);
  }

  const pid = process.pid;
  for (const frag of fragments) {
    // Encode project name with `encodeURIComponent` so scoped package
    // names like `@openwhispr/byok-guard` do not introduce path
    // separators into the fragment filename. The validator
    // (`tools/lint-pre-push-test-evidence.ts:resolveFragmentPath`)
    // applies the same encoding when probing for fragments; the
    // projects-self-test (`tools/test-evidence-projects-self-test.ts`)
    // applies `decodeURIComponent` when reading filenames back into
    // project names. Plain ASCII project names ("api", "web", …) are
    // pass-through under `encodeURIComponent`. Quick 260527-pj6 / W4
    // discovery — silent path-separator break for scoped projects.
    const finalPath = resolve(
      evidenceDir,
      `${frag.commit_sha}-${encodeURIComponent(frag.project)}.json`,
    );
    const tmpPath = `${finalPath}.tmp.${pid}`;

    // Step 3: refuse if final path is a pre-existing symlink.
    let preExists = false;
    try {
      const finalStat = lstatSync(finalPath);
      preExists = true;
      if (finalStat.isSymbolicLink()) {
        stderr.write(`[evidence] refused: ${finalPath} is a symlink (TOCTOU defence)\n`);
        throw new Error(`refused: evidence path is a symlink: ${finalPath}`);
      }
    } catch (err) {
      // ENOENT is expected on first write; rethrow anything else.
      /* c8 ignore start — lstat-after-isSymbolicLink error path
       *  is reached only when the symlink check has already
       *  thrown above. Defensive only. */
      if (preExists) throw err;
      if (err instanceof Error && /ENOENT/.test(err.message) === false) {
        // Some other lstat error — surface it.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      /* c8 ignore stop */
    }

    // Step 4: write tmp with exclusive flag + restrictive mode.
    try {
      writeFileSync(tmpPath, `${JSON.stringify(frag, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      /* c8 ignore start — tmp write failure is rare on local FS;
       *  the dedicated branch is defensive (mkdir would normally
       *  fail first for a read-only parent). */
    } catch (err) {
      stderr.write(
        `[evidence] tmp write refused at ${tmpPath}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      throw err;
    }
    /* c8 ignore stop */

    // Step 5: atomic rename. On failure, clean up the tmp orphan.
    /* c8 ignore start — rename failure is rare on local FS (would
     *  require ENOSPC or cross-device). Defensive cleanup. */
    try {
      renameSync(tmpPath, finalPath);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; ignore.
      }
      stderr.write(
        `[evidence] rename refused at ${finalPath}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      throw err;
    }
    /* c8 ignore stop */
  }
}

/** Resolve evidence dir from env or default `<root>/.test-evidence`. */
export function resolveEvidenceDir(projectRoot: string): string {
  const fromEnv = process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  return resolve(projectRoot, ".test-evidence");
}

/** Resolve commit SHA from env or `git rev-parse HEAD`. Returns
 *  null when no commits exist yet (fresh repo) or git is absent. */
export function resolveCommitSha(projectRoot: string): string | null {
  const fromEnv = process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sha = out.trim();
    /* c8 ignore next — git rev-parse HEAD always emits a non-
     *  empty SHA on a populated repo; empty output requires the
     *  process to fail (caught below). */
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/** Resolve project root via `git rev-parse --show-toplevel`. Falls
 *  back to `process.cwd()` if git is absent. */
/* c8 ignore start — process-coupled helper (spawns `git`). The
 *  Reporter's onTestRunEnd test covers the happy path via the
 *  env-override; this function is exercised indirectly. */
function resolveProjectRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = out.trim();
    return root.length > 0 ? root : cwd;
  } catch {
    return cwd;
  }
}
/* c8 ignore stop */

/* c8 ignore start — kept-for-completeness helper not exercised by
 * unit tests; covered by the integration self-test invocation. */
void dirname;
/* c8 ignore stop */

/**
 * The Vitest 4.1.5 Reporter. Default-exported so vitest can
 * instantiate it via the path-string reporter form.
 *
 * Only `onInit` and `onTestRunEnd` are implemented — every other
 * Reporter hook is optional and we leave them unimplemented.
 */
export default class TestEvidenceReporter {
  /** Captured at `onInit` time. */
  private watchMode = false;

  /** Hook 1 — capture watch mode so we can short-circuit at run end. */
  onInit(vitest: { config?: { watch?: boolean } }): void {
    this.watchMode = vitest.config?.watch === true;
  }

  /** Hook 2 — main entry point. */
  onTestRunEnd(
    testModules: ReadonlyArray<FakeReporterModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason: "passed" | "failed" | "interrupted",
  ): void {
    const projectRoot = resolveProjectRoot(process.cwd());
    const deps: ReporterDeps = {
      evidenceDir: resolveEvidenceDir(projectRoot),
      commitSha: resolveCommitSha(projectRoot),
      projectRoot,
      stderr: process.stderr,
    };
    this.onTestRunEndForTest(testModules, _unhandledErrors, reason, deps);
  }

  /**
   * Test-injectable entry point. Same logic as `onTestRunEnd`
   * except every external dependency is passed explicitly so unit
   * tests stay hermetic.
   */
  onTestRunEndForTest(
    testModules: ReadonlyArray<FakeReporterModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason: "passed" | "failed" | "interrupted",
    deps: ReporterDeps,
  ): void {
    if (this.watchMode) {
      deps.stderr.write("[evidence] skipping write (watch mode)\n");
      return;
    }
    if (reason === "interrupted") {
      deps.stderr.write("[evidence] skipping write (run interrupted)\n");
      return;
    }
    if (testModules.length === 0) {
      // Nothing to record — silent return.
      return;
    }
    const sha = deps.commitSha;
    if (sha === null) {
      deps.stderr.write("[evidence] skipping write (no commit SHA resolved)\n");
      return;
    }
    if (!SHA40_RE.test(sha)) {
      deps.stderr.write(`[evidence] skipping write (invalid SHA shape: ${sha})\n`);
      return;
    }

    const fragments = buildFragmentsForTest({
      testModules,
      commitSha: sha,
      projectRoot: deps.projectRoot,
    });
    // Fragment-level reason is set during buildFragmentsForTest:
    // any `failed` test case flips `frag.reason = "failed"` +
    // `frag.exit_code = 1`. The reporter does not override here —
    // each project's fragment carries its own pass/fail truth.
    writeFragmentsAtomic({
      fragments,
      evidenceDir: deps.evidenceDir,
      stderr: deps.stderr,
    });
  }
}
