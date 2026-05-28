#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-pre-push-test-evidence.ts — Quick 260527-pj6 / Wave 2.
 *
 * Pre-push hook validator that refuses `git push` to origin for the
 * TIP commit of each pushed ref without `.test-evidence/<sha>-<project>.json`
 * fragments covering all 22 canonical Vitest projects.
 *
 * Tip-only: intermediate commits in a push are TDD process artifacts
 * (a `test: red` commit fails by design); the gate validates the tip
 * tree state that actually lands.
 *
 * Git pre-push protocol (man githooks(5) §pre-push):
 *   stdin: <local_ref> <local_sha> <remote_ref> <remote_sha>\n
 *   one line per ref being pushed.
 *   Empty remote_sha = NEW REF; localSha == "0"*40 = DELETION.
 *
 * Refusal criteria (ANY → exit 1):
 *   - The TIP commit of any pushed ref lacks a fragment for one of the
 *     22 canonical project names.
 *   - Any fragment has `exit_code !== 0`.
 *   - Any fragment has `fail > 0`.
 *   - Any fragment has `unannotated_skip > 0`.
 *   - Any fragment is malformed JSON.
 *   - Any fragment path resolves through a symlink (TOCTOU defence).
 *   - Any pushed SHA from stdin is not 40-hex.
 *
 * CI bypass:
 *   `GITHUB_ACTIONS === "true"` OR `CI === "true"` → exit 0 + log
 *   `[ci] skipping evidence gate (CI runs validator directly)` to
 *   stderr. The L3 GitHub Actions job runs the validator
 *   server-side against `${{ github.event.before }}..${{ github.event.after }}`
 *   so the bypass is safe.
 *
 * Path-safety (PLAN scope item 2 §3):
 *   1. canonicalise via `fs.realpathSync(evidenceDir)`
 *   2. `fs.lstatSync(fragmentPath)` REFUSE if symlink
 *   3. assert `realpathSync(fragmentPath).startsWith(canonicalEvidenceDir + sep)`
 *   4. block any path containing `..` segment after `realpathSync`
 *
 * Exit codes:
 *   0 — push allowed (or CI bypass)
 *   1 — push refused (one or more violations)
 *   2 — internal error (manifest missing, parser bomb, etc.)
 *
 * Usage:
 *   pnpm lint:pre-push-test-evidence    # reads stdin from lefthook
 *   pnpm test:evidence:check            # synthetic stdin against HEAD
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { exit } from "node:process";

/** Path of the canonical 22-project manifest relative to repo root. */
export const CANONICAL_MANIFEST_PATH_REL = "tools/test-evidence-projects-manifest.json";

/** 40-hex SHA shape regex — single source of truth. */
const SHA40_RE = /^[0-9a-f]{40}$/;

/** The null-SHA Git emits for new refs and deletions. */
const NULL_SHA = "0".repeat(40);

export interface EvidenceFragmentForTest {
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
    /**
     * Quick 260527-pj6 / Wave 4.T5 — Blocker 3 (Path 3a). True iff the
     * test was skipped at the SUITE level (`.skipIf` / `.runIf` /
     * `describe.skip`) — Vitest emits `location.line === 0` for these,
     * and the per-call SKIP-REASON annotation contract is by
     * construction unsatisfiable. The reporter DOES NOT count
     * suite-level skips in `unannotated_skip`; the validator therefore
     * treats them as observed-but-not-blocking.
     *
     * Field is OPTIONAL on the validator side for back-compat with any
     * fragments written by a reporter on a pre-Wave-4.T5 commit (which
     * would omit it). Treat `undefined` as `false` (the legacy posture).
     */
    suite_level?: boolean;
  }>;
}

export function validateSha(s: string): boolean {
  return SHA40_RE.test(s);
}

interface PushLine {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

interface ParsedStdin {
  lines: PushLine[];
  malformed: string[];
}

function parseStdin(stdin: string): ParsedStdin {
  const lines: PushLine[] = [];
  const malformed: string[] = [];
  for (const raw of stdin.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 4) {
      malformed.push(trimmed);
      continue;
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts as [string, string, string, string];
    lines.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return { lines, malformed };
}

/** Enumerate the commit SHAs that need evidence for a single push
 *  line. Returns ONLY the tip commit (`[localSha]`) for a normal push,
 *  `[]` for a deletion, and `[]` when the tip is already on a remote
 *  (the F13 already-validated optimization). Throws an Error if the
 *  localSha is malformed.
 *
 *  Tip-only rationale: intermediate commits in a push are TDD process
 *  artifacts (a `test: red` commit fails by design and can never carry
 *  passing evidence); what lands/deploys is the tip tree state, so the
 *  gate validates exactly the tip. */
function enumerateCommitsForRef(line: PushLine, repoRoot: string): string[] {
  const { localSha } = line;

  // Deletion: localSha is all-zero → nothing to validate.
  if (localSha === NULL_SHA) {
    return [];
  }

  // Otherwise, the localSha must be 40-hex.
  if (!validateSha(localSha)) {
    throw new Error(`malformed SHA from pre-push stdin: ${localSha}`);
  }

  // Probe whether the tip is already on a remote. If `rev-list <tip>
  // --not --remotes` is empty, the commit (e.g. a tag push of an
  // already-validated commit) is already on a remote → nothing to
  // validate (F13 optimization).
  let out: string;
  try {
    out = execFileSync("git", ["rev-list", localSha, "--not", "--remotes"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    /* c8 ignore start — git rev-list always succeeds on a populated
     *  repo; catch + msg fallback are defence-in-depth. */
    throw new Error(
      `git rev-list failed for ${line.localRef}: ${err instanceof Error ? err.message : String(err)}`,
    );
    /* c8 ignore stop */
  }
  const probe = out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (probe.length === 0) {
    return [];
  }

  // The tip is new-to-remotes → validate exactly the tip. localSha was
  // already validated as 40-hex above; we do not return the probe list.
  return [localSha];
}

/** Sanitised glob for fragment files. We do NOT use a real glob
 *  library — the input is a fixed `<sha>-<project>.json` shape and
 *  the project name is URI-encoded so no glob metachars escape.
 *
 *  Path-safety order:
 *    1. lstatSync → REFUSE on symlink (TOCTOU defence) — this MUST
 *       precede realpathSync so a symlink fragment surfaces as a
 *       symlink violation, not a "path escape".
 *    2. realpathSync → assert canonical path starts with
 *       canonicalEvidenceDir + sep.
 *    3. block any `..` segment after canonicalisation. */
function expectedFragmentPath(
  evidenceDir: string,
  canonicalEvidenceDir: string,
  sha: string,
  project: string,
): { final: string; canonical: string } | { error: string; kind: "symlink" | "path-escape" } {
  const final = resolve(evidenceDir, `${sha}-${encodeURIComponent(project)}.json`);
  // Step 1: lstat — refuse on symlink BEFORE following.
  try {
    const st = lstatSync(final);
    if (st.isSymbolicLink()) {
      return { error: `${final} is a symlink (TOCTOU defence)`, kind: "symlink" };
    }
  } catch {
    // ENOENT is the normal "missing" case — the caller will see
    // the same ENOENT from the subsequent lstat and emit a
    // `missing-projects` violation.
    return { final, canonical: final };
  }
  // Step 2: realpath + containment check.
  /* c8 ignore start — defensive containment check; reached only
   *  when lstatSync sees a regular file but realpath canonicalises
   *  somewhere outside the evidence dir (race condition or
   *  bind-mount). The symlink branch above catches the common
   *  attack path. */
  let canonical: string;
  try {
    canonical = realpathSync(final);
  } catch {
    return { final, canonical: final };
  }
  if (!canonical.startsWith(canonicalEvidenceDir + sep) && canonical !== canonicalEvidenceDir) {
    return { error: `path escape: ${final} → ${canonical}`, kind: "path-escape" };
  }
  if (canonical.includes(`${sep}..${sep}`)) {
    return { error: `path traversal: ${canonical}`, kind: "path-escape" };
  }
  return { final, canonical };
  /* c8 ignore stop */
}

interface ValidationViolation {
  kind:
    | "missing-projects"
    | "fragment-failed"
    | "fragment-unannotated-skip"
    | "fragment-malformed"
    | "fragment-symlink"
    | "fragment-path-escape";
  sha: string;
  detail: string;
}

interface ValidateOneCommitResult {
  violations: ValidationViolation[];
}

function validateOneCommit(
  sha: string,
  evidenceDir: string,
  canonicalEvidenceDir: string,
  projects: ReadonlyArray<string>,
): ValidateOneCommitResult {
  const violations: ValidationViolation[] = [];
  const missing: string[] = [];

  for (const project of projects) {
    const result = expectedFragmentPath(evidenceDir, canonicalEvidenceDir, sha, project);
    if ("error" in result) {
      // c8 ignore next — path-escape branch is defensive; symlink
      // is the only kind currently emitted (containment check is
      // unreachable in tests, see expectedFragmentPath c8 block).
      const kind: ValidationViolation["kind"] =
        result.kind === "symlink" ? "fragment-symlink" : "fragment-path-escape";
      violations.push({ kind, sha, detail: result.error });
      continue;
    }
    const { final } = result;
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(final);
    } catch {
      missing.push(project);
      continue;
    }
    /* c8 ignore start — symlink branch handled in
     *  expectedFragmentPath above; this is a defensive duplicate
     *  for the race-condition window between the two calls. */
    if (st.isSymbolicLink()) {
      violations.push({
        kind: "fragment-symlink",
        sha,
        detail: `${final} is a symlink (TOCTOU defence)`,
      });
      continue;
    }
    /* c8 ignore stop */
    let parsed: EvidenceFragmentForTest;
    try {
      const body = readFileSync(final, "utf8");
      parsed = JSON.parse(body) as EvidenceFragmentForTest;
    } catch {
      violations.push({
        kind: "fragment-malformed",
        sha,
        detail: `Malformed evidence at ${final}`,
      });
      continue;
    }
    if (parsed.exit_code !== 0 || parsed.fail > 0 || parsed.reason === "failed") {
      violations.push({
        kind: "fragment-failed",
        sha,
        detail: `project=${project} exit_code=${parsed.exit_code} fail=${parsed.fail} reason=${parsed.reason}`,
      });
    }
    if (parsed.unannotated_skip > 0) {
      violations.push({
        kind: "fragment-unannotated-skip",
        sha,
        detail: `project=${project} unannotated_skip=${parsed.unannotated_skip}`,
      });
    }
  }

  if (missing.length > 0) {
    violations.push({
      kind: "missing-projects",
      sha,
      detail: `No test evidence for commit ${sha}. Missing projects: [${missing.join(", ")}]. Run pnpm test:all (or pnpm test:evidence) to regenerate.`,
    });
  }
  return { violations };
}

export interface RunMainDeps {
  repoRoot: string;
  evidenceDir: string;
  manifestPath: string;
  stdin: string;
  env: Record<string, string | undefined>;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

export function runMain(deps: RunMainDeps): number {
  // CI bypass first (RESEARCH R6 anti-abuse).
  if (deps.env.GITHUB_ACTIONS === "true" || deps.env.CI === "true") {
    deps.stderr.write("[ci] skipping evidence gate (CI runs validator directly)\n");
    return 0;
  }

  // Load manifest.
  let manifest: { schema: number; projects: string[] };
  try {
    const body = readFileSync(deps.manifestPath, "utf8");
    manifest = JSON.parse(body) as { schema: number; projects: string[] };
  } catch (err) {
    deps.stderr.write(
      // c8 ignore next — String(non-Error) fallback is defensive.
      `lint-pre-push-test-evidence: cannot load manifest at ${deps.manifestPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (!Array.isArray(manifest.projects) || manifest.projects.length === 0) {
    deps.stderr.write(
      `lint-pre-push-test-evidence: manifest at ${deps.manifestPath} has no projects[].\n`,
    );
    return 2;
  }
  const projects = manifest.projects;

  // Canonicalise evidence dir (TOCTOU defence). The dir may not yet
  // exist (e.g. pre-test push) — fall back to the lexical path; the
  // per-fragment `realpathSync` still defends.
  let canonicalEvidenceDir: string;
  try {
    canonicalEvidenceDir = realpathSync(deps.evidenceDir);
  } catch {
    canonicalEvidenceDir = resolve(deps.evidenceDir);
  }

  // Parse stdin (the pre-push protocol).
  const { lines, malformed } = parseStdin(deps.stdin);
  if (malformed.length > 0) {
    deps.stderr.write(
      `lint-pre-push-test-evidence: malformed stdin lines (expected 4 tokens per line):\n`,
    );
    for (const m of malformed) deps.stderr.write(`  ${m}\n`);
    return 1;
  }

  if (lines.length === 0) {
    // No refs to validate — Git may invoke the hook with empty stdin
    // when pushing nothing (rare). Allow.
    return 0;
  }

  let totalCommits = 0;
  const allViolations: ValidationViolation[] = [];

  for (const line of lines) {
    let shas: string[];
    try {
      shas = enumerateCommitsForRef(line, deps.repoRoot);
    } catch (err) {
      deps.stderr.write(
        // c8 ignore next — String(non-Error) fallback is defensive.
        `lint-pre-push-test-evidence: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
    for (const sha of shas) {
      totalCommits += 1;
      const { violations } = validateOneCommit(
        sha,
        deps.evidenceDir,
        canonicalEvidenceDir,
        projects,
      );
      for (const v of violations) allViolations.push(v);
    }
  }

  if (allViolations.length === 0) {
    deps.stderr.write(
      `lint-pre-push-test-evidence: ✅ PASS across ${projects.length} projects on ${totalCommits} commit(s). Push allowed.\n`,
    );
    return 0;
  }

  deps.stderr.write(
    `lint-pre-push-test-evidence FAILED: ${allViolations.length} violation(s) on push:\n`,
  );
  for (const v of allViolations) {
    deps.stderr.write(`  [${v.kind}] sha=${v.sha} ${v.detail}\n`);
  }
  deps.stderr.write(
    "remediation: see docs/test-evidence-gate.md. `git push --no-verify` is BANNED (CLAUDE.md hard-rule 4).\n",
  );
  return 1;
}

/* c8 ignore start — process-coupled CLI wiring. */
function readStdinSync(): string {
  // Synchronous read of stdin (lefthook pipes pre-push lines).
  try {
    const buf = readFileSync(0);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function resolveRepoRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function mainEntry(): number {
  const repoRoot = resolveRepoRoot();
  return runMain({
    repoRoot,
    evidenceDir: resolve(repoRoot, ".test-evidence"),
    manifestPath: resolve(repoRoot, CANONICAL_MANIFEST_PATH_REL),
    stdin: readStdinSync(),
    env: process.env as Record<string, string | undefined>,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

const _argvUrl = (() => {
  try {
    return new URL(`file://${process.argv[1] ?? ""}`).href;
  } catch {
    return "";
  }
})();
const _isMain = import.meta.url === _argvUrl;

if (_isMain) {
  exit(mainEntry());
}
/* c8 ignore stop */
