// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-pre-push-test-evidence.test.ts — Quick 260527-pj6 / Wave 2.
 *
 * RED-then-GREEN unit tests for the pre-push test-evidence validator
 * (`tools/lint-pre-push-test-evidence.ts`).
 *
 * F-cases (PLAN scope item 15 / section 5):
 *   F1  — no fragments at all for SHA → exit 1 with all-22 missing list
 *   F2  — 21/22 projects covered → exit 1 names the 1 missing
 *   F3  — 22/22 clean → exit 0 with `✅ ...Push allowed.`
 *   F4  — `exit_code !== 0` fragment → exit 1
 *   F5  — `fail > 0` fragment → exit 1
 *   F6  — `unannotated_skip > 0` fragment → exit 1
 *   F7  — malformed JSON → exit 1 with `Malformed evidence at <path>`
 *   F8  — symlink fragment → exit 1 with path-safety error
 *   F9  — GITHUB_ACTIONS=true → exit 0 + stderr bypass log
 *   F10 — CI=true → exit 0 + stderr bypass log
 *   F11 — multi-ref stdin (4 lines, mixed branches + tag)
 *   F12 — deletion push (localSha = "0".repeat(40)) → skipped per-line
 *   F13 — tag push of already-validated commit → rev-list empty → exit 0
 *   F14 — new-branch push (remoteSha = "0".repeat(40)) → validates only the tip
 *   F15 — malformed SHA from stdin → exit 1 with `malformed SHA`
 *   F16 — path-traversal attempt → rejected
 *   F17 — force-push (--force-with-lease) → validates only the tip of the
 *         pushed range (TDD-compatible); refuses when the TIP lacks evidence
 *   F18 — force-push deletion semantics → identical to F12
 *   F19 — tip-only TDD-compat: red intermediate commits + green tip → exit 0
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANONICAL_MANIFEST_PATH_REL,
  type EvidenceFragmentForTest,
  runMain,
  validateSha,
} from "../lint-pre-push-test-evidence.js";

const NULL_SHA = "0".repeat(40);
const PROJECTS = [
  "api",
  "web",
  "worker",
  "@openwhispr/byok-guard",
  "@openwhispr/contract-tests",
  "data",
  "@openwhispr/email",
  "@openwhispr/litellm-client",
  "load-test",
  "test-probe",
  "mock-litellm",
  "e2e",
  "mock-realtime",
  "@openwhispr/auth-stub",
  "@openwhispr/i18n-stub",
  "@openwhispr/observability",
  "@openwhispr/wire-schemas",
  "tools",
  "tests-e2e-cjm-steps",
  "tests-e2e-cjm-support",
  "tests-integration",
  "tests-self-tests",
];

let root: string;
let evidenceDir: string;
let manifestPath: string;

/** Write all 22 clean-PASS fragments for the given SHA. */
function writeAllClean(sha: string): void {
  for (const project of PROJECTS) {
    writeFragment(sha, project, {
      reason: "passed",
      exit_code: 0,
      total: 1,
      pass: 1,
      fail: 0,
      skip: 0,
      todo: 0,
      unannotated_skip: 0,
      failures: [],
      skips: [],
    });
  }
}

function writeFragment(
  sha: string,
  project: string,
  body: Partial<EvidenceFragmentForTest>,
): string {
  const fp = join(evidenceDir, `${sha}-${encodeURIComponent(project)}.json`);
  const fragment: EvidenceFragmentForTest = {
    schema: 1,
    generated_at: "2026-05-27T00:00:00.000Z",
    project,
    commit_sha: sha,
    reason: "passed",
    exit_code: 0,
    total: 1,
    pass: 1,
    fail: 0,
    skip: 0,
    todo: 0,
    unannotated_skip: 0,
    failures: [],
    skips: [],
    ...body,
  };
  writeFileSync(fp, JSON.stringify(fragment, null, 2), { mode: 0o600 });
  return fp;
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "pre-push-evidence-"));
  // Init a real git repo so rev-list / cat-file resolve.
  execFileSync("git", ["init", "-q", "-b", "main"], {
    cwd: repo,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  return repo;
}

function commitInRepo(repo: string, content: string, msg: string): string {
  writeFileSync(join(repo, "file.txt"), content, "utf8");
  execFileSync("git", ["add", "file.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", msg], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

beforeEach(() => {
  root = makeRepo();
  evidenceDir = join(root, ".test-evidence");
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  manifestPath = join(root, "tools", "test-evidence-projects-manifest.json");
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ schema: 1, projects: PROJECTS }, null, 2), "utf8");
});

afterEach(() => {
  try {
    chmodSync(evidenceDir, 0o755);
  } catch {
    /* ignore */
  }
  rmSync(root, { recursive: true, force: true });
});

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runValidator(stdin: string, env: Record<string, string> = {}): CapturedRun {
  let stdout = "";
  let stderr = "";
  const code = runMain({
    repoRoot: root,
    evidenceDir,
    manifestPath,
    stdin,
    env: {
      // Default to non-CI env so the bypass doesn't fire by accident.
      ...env,
    },
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
  });
  return { exitCode: code, stdout, stderr };
}

describe("CANONICAL_MANIFEST_PATH_REL constant", () => {
  it("points at tools/test-evidence-projects-manifest.json", () => {
    expect(CANONICAL_MANIFEST_PATH_REL).toBe("tools/test-evidence-projects-manifest.json");
  });
});

describe("validateSha", () => {
  it("accepts 40-hex lower-case", () => {
    expect(validateSha("abc1234".padEnd(40, "0"))).toBe(true);
  });
  it("rejects upper-case + non-hex", () => {
    expect(validateSha("ABC".padEnd(40, "0"))).toBe(false);
    expect(validateSha("GG".padEnd(40, "0"))).toBe(false);
  });
  it("rejects short / long strings", () => {
    expect(validateSha("a".repeat(39))).toBe(false);
    expect(validateSha("a".repeat(41))).toBe(false);
  });
});

describe("F1 — no fragments at all → exit 1 with all-22 missing", () => {
  it("refuses push when no fragments exist for the SHA", () => {
    const sha = commitInRepo(root, "a", "first");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/No test evidence/);
    // Spot-check that several projects are named.
    expect(r.stderr).toMatch(/api/);
    expect(r.stderr).toMatch(/@openwhispr\/contract-tests/);
  });
});

describe("F2 — 21/22 fragments → exit 1 naming the missing one", () => {
  it("refuses push when one project's fragment is missing", () => {
    const sha = commitInRepo(root, "b", "second");
    writeAllClean(sha);
    // Remove one fragment to simulate a partial run.
    rmSync(join(evidenceDir, `${sha}-${encodeURIComponent("data")}.json`));
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/Missing projects:.*data/);
  });
});

describe("F3 — 22/22 clean → exit 0", () => {
  it("allows push when all projects PASS", () => {
    const sha = commitInRepo(root, "c", "third");
    writeAllClean(sha);
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/Push allowed/);
  });
});

describe("F4 — exit_code !== 0 fragment → exit 1", () => {
  it("refuses push when one fragment has non-zero exit code", () => {
    const sha = commitInRepo(root, "d", "fourth");
    writeAllClean(sha);
    writeFragment(sha, "api", {
      reason: "failed",
      exit_code: 1,
      total: 2,
      pass: 1,
      fail: 1,
      failures: [{ file: "x.test.ts", name: "x", error_message_truncated: "boom" }],
    });
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/api/);
  });
});

describe("F5 — fail > 0 fragment → exit 1", () => {
  it("refuses push when fail count is positive even if exit_code happens to be 0", () => {
    const sha = commitInRepo(root, "e", "fifth");
    writeAllClean(sha);
    writeFragment(sha, "web", {
      reason: "failed",
      exit_code: 0,
      total: 2,
      pass: 1,
      fail: 1,
      failures: [{ file: "y.test.ts", name: "y", error_message_truncated: "fail" }],
    });
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/fail/);
  });
});

describe("F6 — unannotated_skip > 0 fragment → exit 1", () => {
  it("refuses push when any skip lacks SKIP-REASON annotation", () => {
    const sha = commitInRepo(root, "f", "sixth");
    writeAllClean(sha);
    writeFragment(sha, "worker", {
      total: 2,
      pass: 1,
      skip: 1,
      unannotated_skip: 1,
      skips: [
        {
          file: "z.test.ts",
          line: 5,
          name: "z",
          mode: "skip",
          annotated: false,
          skip_reason: null,
        },
      ],
    });
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unannotated/);
    expect(r.stderr).toMatch(/worker/);
  });
});

describe("F7 — malformed JSON fragment", () => {
  it("refuses push with explicit error pointing at the malformed file", () => {
    const sha = commitInRepo(root, "g", "seventh");
    writeAllClean(sha);
    const fp = join(evidenceDir, `${sha}-${encodeURIComponent("api")}.json`);
    writeFileSync(fp, "{ not json", "utf8");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/Malformed evidence at/);
  });
});

describe("F8 — symlink fragment", () => {
  it("refuses push when a fragment file is a symlink", () => {
    const sha = commitInRepo(root, "h", "eighth");
    writeAllClean(sha);
    const realTarget = join(root, "attacker");
    writeFileSync(realTarget, "{}", "utf8");
    const linkPath = join(evidenceDir, `${sha}-${encodeURIComponent("api")}.json`);
    rmSync(linkPath);
    symlinkSync(realTarget, linkPath);
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/symlink/i);
  });
});

describe("F9 — GITHUB_ACTIONS=true bypasses with stderr log", () => {
  it("exits 0 + logs bypass to stderr in GitHub Actions CI", () => {
    const sha = commitInRepo(root, "i", "ninth");
    // No fragments at all — would normally fail; bypass should kick in.
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin, { GITHUB_ACTIONS: "true" });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/skipping evidence gate/);
  });
});

describe("F10 — CI=true bypasses with stderr log", () => {
  it("exits 0 + logs bypass to stderr when CI env set", () => {
    const sha = commitInRepo(root, "j", "tenth");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin, { CI: "true" });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/skipping evidence gate/);
  });
});

describe("F11 — multi-ref push (4 stdin lines)", () => {
  it("validates each ref independently", () => {
    // Tip-only: each ref contributes exactly its own localSha (its tip).
    const sha1 = commitInRepo(root, "k1", "first");
    const sha2 = commitInRepo(root, "k2", "second");
    writeAllClean(sha2); // sha2 is clean; sha1 will be missing.
    const stdin = [
      `refs/heads/main ${sha2} refs/heads/main ${NULL_SHA}`,
      `refs/heads/old-branch ${sha1} refs/heads/old-branch ${NULL_SHA}`,
      "",
    ].join("\n");
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    // sha1 is the one missing evidence.
    expect(r.stderr).toMatch(new RegExp(sha1));
  });
});

describe("F12 — deletion push (localSha = 0..0) → skipped", () => {
  it("ignores a deletion line and exits 0 if no other refs", () => {
    const stdin = `(delete) ${NULL_SHA} refs/heads/feature ${"a".repeat(40)}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("F13 — tag push of already-validated commit → rev-list empty", () => {
  it("exits 0 when rev-list returns empty (commit already on remote)", () => {
    const sha = commitInRepo(root, "tag-target", "tag");
    // Mark commit as already on a remote via fake remote ref.
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
      cwd: root,
    });
    writeAllClean(sha);
    // Push: tag pointing at sha; rev-list <sha> --not --remotes returns empty.
    const stdin = `refs/tags/v1 ${sha} refs/tags/v1 ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("F14 — new-branch push (remoteSha = 0..0)", () => {
  it("validates only the tip commit (intermediate commits need no evidence)", () => {
    // Build a 3-commit chain c1 → c2 → tip. Under the OLD range-based impl,
    // `rev-list <tip> --not --remotes` enumerates ALL THREE commits, so the
    // missing c1/c2 evidence would refuse the push. Under tip-only, only the
    // tip's evidence is inspected → exit 0.
    const c1 = commitInRepo(root, "c1", "c1");
    const c2 = commitInRepo(root, "c2", "c2");
    const tip = commitInRepo(root, "tip", "tip");
    void c1;
    void c2;
    writeAllClean(tip); // evidence on the TIP only.
    const stdin = `refs/heads/new-feature ${tip} refs/heads/new-feature ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("F15 — malformed SHA from stdin", () => {
  it("exits 1 with `malformed SHA`", () => {
    const stdin = `refs/heads/main ${"GG".repeat(20)} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/malformed SHA/);
  });
});

describe("F16 — path-traversal attempt via symlink replacing a real fragment", () => {
  it("rejects when an EXPECTED fragment is replaced with a symlink escaping the evidence dir", () => {
    const sha = commitInRepo(root, "p", "pt");
    writeAllClean(sha);
    // Path-traversal: replace a legitimate fragment (api) with a
    // symlink whose target is OUTSIDE the canonical evidence dir.
    // This is the actual attack the symlink defence + realpath
    // containment check exists to refuse.
    const outsideTarget = join(root, "outside.json");
    writeFileSync(outsideTarget, JSON.stringify({ schema: 1 }), "utf8");
    const linkPath = join(evidenceDir, `${sha}-${encodeURIComponent("api")}.json`);
    rmSync(linkPath);
    symlinkSync(outsideTarget, linkPath);
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/symlink/i);
  });
});

describe("F17 — force-push (--force-with-lease)", () => {
  it("validates only the tip d (non-tip c needs no evidence)", () => {
    // Build divergent history:
    //   M -- A -- B  (was on remote)
    //    \
    //     -- C -- D  (force-pushed)
    const m = commitInRepo(root, "M", "M");
    const a = commitInRepo(root, "A", "A");
    const b = commitInRepo(root, "B", "B");
    // Mark A,B as on remote.
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", b], { cwd: root });
    // Rewind to M and build C,D.
    execFileSync("git", ["reset", "--hard", "-q", m], { cwd: root });
    const c = commitInRepo(root, "C", "C");
    const d = commitInRepo(root, "D", "D");
    // Reference variables to satisfy lint and document the history.
    void a;
    void c;
    // Push: remoteSha = b (last remote-known); localSha = d (force-push tip).
    // Tip-only: only d's evidence is inspected. Under the OLD range impl
    // (rev-list b..d → [c, d]) the missing c evidence would refuse → RED.
    writeAllClean(d); // evidence on the TIP d only; c intentionally missing.
    const stdin = `refs/heads/main ${d} refs/heads/main ${b}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
  it("refuses when the TIP commit itself has no evidence (non-tip gaps are now allowed)", () => {
    const m = commitInRepo(root, "M", "M");
    const b = commitInRepo(root, "A", "A");
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", b], { cwd: root });
    execFileSync("git", ["reset", "--hard", "-q", m], { cwd: root });
    const c = commitInRepo(root, "C", "C");
    const d = commitInRepo(root, "D", "D");
    // Evidence on the NON-tip c only; the TIP d is missing → still REFUSED,
    // and the refusal names the TIP d (not the non-tip c). This proves the
    // tip is still guarded.
    writeAllClean(c);
    const stdin = `refs/heads/main ${d} refs/heads/main ${b}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(new RegExp(d));
  });
});

describe("F18 — force-push deletion semantics", () => {
  it("skips the deletion line with no other refs to validate", () => {
    const stdin = `(delete) ${NULL_SHA} refs/heads/feature ${"b".repeat(40)}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("F19 — tip-only TDD-compat: red intermediate commits, green tip → exit 0", () => {
  it("accepts a push whose intermediate commits are red but whose tip is green", () => {
    // Load-bearing TDD-compatibility regression proof.
    //
    // A constitutional red→green→refactor history looks like:
    //   base — c1 (`test: red`, fails BY DESIGN) — c2 (intermediate) — tip (green)
    //
    // c1 can never produce passing evidence (the test exists, the impl does
    // not), so a per-commit-range gate would deadlock the discipline. Tip-only
    // validates the tip tree state that actually lands → exit 0.
    const base = commitInRepo(root, "base", "base");
    const c1 = commitInRepo(root, "c1", "test: red");
    const c2 = commitInRepo(root, "c2", "wip");
    const tip = commitInRepo(root, "tip", "feat: green");
    void c2;
    // Model a real TDD red commit: a single FAILING fragment for c1 (a red
    // commit has no full 22-project evidence by design — only the failing run).
    writeFragment(c1, "api", {
      reason: "failed",
      exit_code: 1,
      total: 1,
      pass: 0,
      fail: 1,
      failures: [{ file: "x.test.ts", name: "red", error_message_truncated: "intentional red" }],
    });
    // The TIP has full, clean evidence.
    writeAllClean(tip);
    const stdin = `refs/heads/main ${tip} refs/heads/main ${base}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("empty stdin", () => {
  it("exits 0 (nothing to validate)", () => {
    const r = runValidator("");
    expect(r.exitCode).toBe(0);
  });
});

describe("manifest missing", () => {
  it("exits 2 (internal error) when manifest file is absent", () => {
    rmSync(manifestPath);
    const sha = commitInRepo(root, "n", "n");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/manifest/i);
  });
});

describe("manifest has empty projects array", () => {
  it("exits 2 with explicit error", () => {
    writeFileSync(manifestPath, JSON.stringify({ schema: 1, projects: [] }), "utf8");
    const sha = commitInRepo(root, "o", "o");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/no projects/i);
  });
});

describe("malformed stdin lines", () => {
  it("exits 1 when a line has fewer than 4 tokens", () => {
    const stdin = "refs/heads/main onlytwo\n";
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/malformed stdin/);
  });
});

describe("evidence dir does not yet exist", () => {
  it("still exits 1 when fragments are absent (lexical fallback)", () => {
    rmSync(evidenceDir, { recursive: true, force: true });
    const sha = commitInRepo(root, "q", "q");
    const stdin = `refs/heads/main ${sha} refs/heads/main ${NULL_SHA}\n`;
    const r = runValidator(stdin);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/Missing projects/);
  });
});
