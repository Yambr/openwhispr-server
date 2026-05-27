#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * test-evidence-projects-self-test.ts — Quick 260527-pj6 / Wave 3.T3.
 *
 * Scripted self-test (W5 mitigation per PLAN scope item 14) — replaces
 * the previously-prose Wave 3 validation. Wave 4 atomic commit can
 * only proceed after this exits 0.
 *
 * Logic:
 *   1. Spawn `pnpm test:all` via `spawnSync('pnpm', ['test:all'], …)`.
 *      Capture exit code.
 *   2. Resolve EVIDENCE_DIR (env override OR `<root>/.test-evidence`)
 *      and HEAD_SHA (`git rev-parse HEAD`).
 *   3. Glob `${EVIDENCE_DIR}/${HEAD_SHA}-*.json` and extract the
 *      project-name suffix from each filename (URI-decoded).
 *   4. Load `tools/test-evidence-projects-manifest.json` (the 22-
 *      project canonical list).
 *   5. Compute `delta = Set(manifest.projects) − Set(foundProjects)`.
 *   6. If `delta.size > 0` → exit 1 with structured stderr.
 *   7. If `pnpm test:all` exited non-zero AND `delta.size === 0` →
 *      exit 1 with a "tests failed but evidence written" hint.
 *   8. Both pass → exit 0.
 *
 * NOT wired into pre-push lefthook (would deadlock the gate it's
 * validating). Operator-invokes via `pnpm test:evidence:projects-self-test`.
 *
 * Exit codes:
 *   0 — 22/22 projects emitted evidence + all PASS
 *   1 — missing projects OR tests failed
 *   2 — internal error
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

interface RunDeps {
  repoRoot: string;
  manifestPath: string;
  evidenceDir: string;
  headSha: string;
  runTestAll: () => number;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

interface Manifest {
  schema: number;
  projects: string[];
}

/**
 * Inspect the evidence dir and return the set of project names that
 * have a fragment for the current HEAD SHA. The filename shape is
 * `<headSha>-<URIencoded(project)>.json`. We decode the project
 * segment so naming matches the manifest's raw strings.
 */
export function findFragmentProjects(evidenceDir: string, headSha: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(evidenceDir);
  } catch {
    return [];
  }
  const prefix = `${headSha}-`;
  const found: string[] = [];
  for (const e of entries) {
    if (!e.startsWith(prefix) || !e.endsWith(".json")) continue;
    const encoded = e.slice(prefix.length, e.length - ".json".length);
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = encoded;
    }
    found.push(decoded);
  }
  return found;
}

export interface SelfTestOutcome {
  exitCode: 0 | 1 | 2;
  missing: string[];
  found: string[];
  testAllExitCode: number;
}

export function runSelfTest(deps: RunDeps): SelfTestOutcome {
  const testAllExitCode = deps.runTestAll();
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(deps.manifestPath, "utf8")) as Manifest;
  } catch (err) {
    deps.stderr.write(
      `test-evidence-projects-self-test: cannot load manifest at ${deps.manifestPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return { exitCode: 2, missing: [], found: [], testAllExitCode };
  }
  const expected = new Set(manifest.projects);
  const found = findFragmentProjects(deps.evidenceDir, deps.headSha);
  const foundSet = new Set(found);
  const missing = manifest.projects.filter((p) => !foundSet.has(p));
  if (missing.length > 0) {
    deps.stderr.write(
      `test-evidence-projects-self-test FAILED: ${missing.length} project(s) without evidence for HEAD=${deps.headSha}:\n`,
    );
    for (const p of missing) {
      deps.stderr.write(`  - ${p}\n`);
    }
    deps.stderr.write(
      "remediation: each missing project's vitest.config.ts must include the\n" +
        "evidence reporter in `reporters:` (or omit `reporters:` to inherit from root).\n" +
        "Run `pnpm lint:vitest-reporter-inheritance` to identify the file:line.\n",
    );
    return { exitCode: 1, missing, found, testAllExitCode };
  }
  // Surface unexpected projects (manifest drift) as a warning — do
  // not fail. Drift detection is the parity self-test's job.
  const unexpected = found.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    deps.stderr.write(
      `test-evidence-projects-self-test: WARN unexpected project(s) (manifest drift): ${unexpected.join(", ")}\n`,
    );
  }
  if (testAllExitCode !== 0) {
    deps.stderr.write(
      `test-evidence-projects-self-test FAILED: pnpm test:all exited ${testAllExitCode}.\n` +
        `Inspect individual fragments via:\n` +
        `  cat ${deps.evidenceDir}/${deps.headSha}-*.json\n`,
    );
    return { exitCode: 1, missing: [], found, testAllExitCode };
  }
  deps.stdout.write(
    `test-evidence-projects-self-test: ✅ ${manifest.projects.length}/${manifest.projects.length} ` +
      `projects emitted evidence for ${deps.headSha}.\n`,
  );
  return { exitCode: 0, missing: [], found, testAllExitCode };
}

/* c8 ignore start — process-coupled CLI wiring exercised by the
 * Wave 4 self-test invocation only. */
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

function resolveHeadSha(repoRoot: string): string | null {
  if (process.env.OPENWHISPR_TEST_EVIDENCE_SHA) {
    return process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function mainEntry(): number {
  const repoRoot = resolveRepoRoot();
  const headSha = resolveHeadSha(repoRoot);
  if (!headSha) {
    process.stderr.write("test-evidence-projects-self-test: cannot resolve HEAD SHA.\n");
    return 2;
  }
  const evidenceDir =
    process.env.OPENWHISPR_TEST_EVIDENCE_DIR ?? resolve(repoRoot, ".test-evidence");
  const manifestPath = resolve(repoRoot, "tools/test-evidence-projects-manifest.json");
  const outcome = runSelfTest({
    repoRoot,
    manifestPath,
    evidenceDir,
    headSha,
    runTestAll: () => {
      const r = spawnSync("pnpm", ["test:all"], {
        cwd: repoRoot,
        stdio: "inherit",
        shell: false,
      });
      return r.status ?? 1;
    },
    stdout: process.stdout,
    stderr: process.stderr,
  });
  return outcome.exitCode;
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
