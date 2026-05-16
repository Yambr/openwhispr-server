// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-gitleaks-hook.test.ts — integration test for the lefthook
 * pre-commit + pre-push gitleaks gate.
 *
 * Phase 260516-kya / Plan 01 / Task 2.
 *
 * Contract guaranteed by this suite:
 *   1. Pre-commit gate (L1) — staging a file with a synthetic live
 *      secret shape and invoking `lefthook run pre-commit` against
 *      a throwaway git repo MUST exit non-zero, blocking the commit.
 *   2. Pre-push gate (L2) — committing the same file with
 *      `git commit --no-verify` (bypassing L1) and then invoking
 *      `lefthook run pre-push` MUST exit non-zero, catching the
 *      `--no-verify` bypass before the push reaches the remote.
 *
 * Strategy:
 *   - Spin up a clean git repo inside a temp directory.
 *   - Copy in the repo's `lefthook.yml` + `.gitleaks.toml` so the
 *     hook config under test is the one we just committed.
 *   - Drive the workflow via argv-array `spawnSync` (LOCKER-06).
 *   - Skip with a clear hint when `gitleaks` or `lefthook` is not
 *     available on PATH (the harness binaries, not the repo
 *     toolchain).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const REPO_LEFTHOOK = join(REPO_ROOT, "lefthook.yml");
const REPO_GITLEAKS_CFG = join(REPO_ROOT, ".gitleaks.toml");

// High-entropy synthetic shape that clears gitleaks default
// generic-api-key entropy floor. Intentionally NOT a real secret.
const SYNTH_LEAK = "SYNTH9xY2vW8nP1jL5kRgD7sM6cF0hX3uZbN0qE4tR7wA1bSYNTH";

function which(bin: string): string | null {
  // Prefer the repo's local bin first — `which lefthook` in a pnpm
  // workspace returns the RELATIVE path `./node_modules/.bin/lefthook`,
  // which silently fails when spawnSync sets cwd to a tmpdir. Resolve
  // to an absolute path so the test's tmp-cwd cannot lose the binary.
  const local = resolve(REPO_ROOT, "node_modules", ".bin", bin);
  if (existsSync(local)) return local;
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const got = r.stdout.trim();
    // Only accept an absolute path; reject `./` relative forms.
    if (got.startsWith("/")) return got;
  }
  return null;
}

const GITLEAKS = which("gitleaks");
const LEFTHOOK = which("lefthook");

function run(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): { status: number; output: string } {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...extraEnv },
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function git(args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  return run("git", args, cwd, extraEnv);
}

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitleaks-hook-"));
  // Quiet, deterministic identity for commits.
  const env = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  expect(git(["init", "-q", "-b", "main"], dir, env).status).toBe(0);
  expect(git(["config", "user.email", "test@example.com"], dir).status).toBe(0);
  expect(git(["config", "user.name", "Test"], dir).status).toBe(0);
  // Copy in the lefthook config + the gitleaks config under test.
  copyFileSync(REPO_LEFTHOOK, join(dir, "lefthook.yml"));
  copyFileSync(REPO_GITLEAKS_CFG, join(dir, ".gitleaks.toml"));
  // Seed an initial commit so HEAD~N refs are valid for pre-push.
  writeFileSync(join(dir, "README.md"), "# tmp\n");
  git(["add", "README.md", "lefthook.yml", ".gitleaks.toml"], dir);
  expect(git(["commit", "-q", "--no-verify", "-m", "init"], dir, env).status).toBe(0);
  return dir;
}

describe("gitleaks lefthook integration (L1 pre-commit + L2 pre-push)", () => {
  beforeAll(() => {
    if (!GITLEAKS || !LEFTHOOK) {
      console.warn(
        "[lint-gitleaks-hook.test] gitleaks or lefthook not on PATH; suite SKIPPED.\n" +
          "  Install gitleaks: bash tools/install-gitleaks.sh\n" +
          "  Install lefthook: pnpm install (it lands in node_modules/.bin)",
      );
    }
  });

  it("L1: pre-commit BLOCKS a staged file containing a synthetic live secret", () => {
    if (!GITLEAKS || !LEFTHOOK) return;
    const dir = makeTmpRepo();
    try {
      // Stage a file with the synthetic leak. Path is intentionally
      // OUTSIDE the allowlist (root of repo, not under tests/).
      writeFileSync(join(dir, "leaky.txt"), `OPENAI_KEY=${SYNTH_LEAK}\n`);
      expect(git(["add", "leaky.txt"], dir).status).toBe(0);
      // Drive only the gitleaks command — other pre-commit jobs
      // (biome, english, lockers) need the full monorepo tree.
      // `lefthook run pre-commit --commands gitleaks` scopes to the
      // single command under test.
      // --no-tty forces lefthook to write to stdout/stderr rather than
      // the controlling terminal, so spawnSync captures the output.
      const r = run(LEFTHOOK, ["run", "pre-commit", "--command", "gitleaks", "--no-tty"], dir);
      expect(r.status, `expected non-zero; output:\n${r.output}`).not.toBe(0);
      // Reasonable evidence the failure was the gitleaks gate, not
      // a missing-config or other plumbing error.
      expect(r.output.toLowerCase()).toMatch(/gitleaks|leaks found|secret/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L2: pre-push BLOCKS a committed leak that bypassed L1 via --no-verify", () => {
    if (!GITLEAKS || !LEFTHOOK) return;
    const dir = makeTmpRepo();
    try {
      writeFileSync(join(dir, "leaky.txt"), `OPENAI_KEY=${SYNTH_LEAK}\n`);
      expect(git(["add", "leaky.txt"], dir).status).toBe(0);
      // Bypass the pre-commit gate explicitly.
      const c = git(["commit", "-q", "--no-verify", "-m", "smuggled leak"], dir, {
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      });
      expect(c.status).toBe(0);
      // Now invoke the pre-push gate.
      const r = run(LEFTHOOK, ["run", "pre-push", "--command", "gitleaks", "--no-tty"], dir);
      expect(r.status, `expected non-zero; output:\n${r.output}`).not.toBe(0);
      expect(r.output.toLowerCase()).toMatch(/gitleaks|leaks found|secret/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config-path wired into CI security workflow", () => {
    // Defense-in-depth check: the workflow file references the same
    // single-source-of-truth config that lefthook uses, so L3 cannot
    // silently drift to a different ruleset.
    const wf = join(REPO_ROOT, ".github", "workflows", "security.yml");
    expect(existsSync(wf)).toBe(true);
    const text = require("node:fs").readFileSync(wf, "utf8");
    expect(text).toMatch(/config-path:\s*\.gitleaks\.toml/);
  });

  it("install-hooks.cjs bootstraps tools/install-gitleaks.sh", () => {
    const hooks = join(REPO_ROOT, "tools", "install-hooks.cjs");
    const text = require("node:fs").readFileSync(hooks, "utf8");
    expect(text).toMatch(/install-gitleaks\.sh/);
  });
});
