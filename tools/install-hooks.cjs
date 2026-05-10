#!/usr/bin/env node
/**
 * install-hooks.cjs — idempotent git-hook installer for `pnpm install` prepare.
 *
 * Why this exists:
 *   Lefthook's `install` subcommand fails hard when `core.hooksPath` is set
 *   locally (even when it points at `.git/hooks`, the default). It also has
 *   no business running in CI / Docker image builds where `.git/` does not
 *   exist. A bare `prepare: "lefthook install"` therefore breaks fresh
 *   `pnpm install` runs and forces contributors to `git commit --no-verify`,
 *   which is explicitly forbidden by CLAUDE.md.
 *
 * Behaviour:
 *   1. If `.git/` is absent (CI image build, npm pack, tarball install) →
 *      exit 0 silently. Hooks are a dev-machine concern only.
 *   2. Otherwise invoke `lefthook install --force`, which respects an
 *      existing `core.hooksPath` and overwrites any stale hook scripts
 *      (e.g. hooks pointing at deleted worktree paths).
 *   3. If lefthook itself is not yet on disk (first install pass, before its
 *      bin landed in node_modules) → warn and exit 0; the next install pass
 *      will succeed once the dep is materialized.
 *
 * Exit code is ALWAYS 0 on the happy/expected paths so `pnpm install`
 * never wedges. Genuine failures (lefthook present, .git present, but
 * `install --force` still erroring) propagate with exit 1.
 */
"use strict";

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

function main() {
  const repoRoot = process.cwd();
  const gitDir = join(repoRoot, ".git");

  // 1. CI / Docker / tarball install — nothing to do.
  if (!existsSync(gitDir)) {
    if (process.env.LEFTHOOK_INSTALL_VERBOSE) {
      console.log("[install-hooks] no .git directory; skipping (CI/Docker build).");
    }
    return 0;
  }

  // Allow operators / CI to opt out explicitly.
  if (process.env.SKIP_LEFTHOOK_INSTALL === "1") {
    console.log("[install-hooks] SKIP_LEFTHOOK_INSTALL=1 set; skipping.");
    return 0;
  }

  // 2. Run lefthook via pnpm exec — handles platform-specific bin resolution.
  //    --force: overwrite stale hook scripts AND tolerate `core.hooksPath` being set.
  const result = spawnSync("pnpm", ["exec", "lefthook", "install", "--force"], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    // pnpm itself missing — extremely unlikely inside a pnpm prepare hook,
    // but be defensive.
    console.warn(
      `[install-hooks] could not invoke 'pnpm exec lefthook': ${result.error.message}. ` +
        "Hooks not installed; run 'pnpm exec lefthook install --force' manually.",
    );
    return 0;
  }

  if (result.status === 0) {
    return 0;
  }

  // 3. Lefthook binary not yet materialized (first-pass install, .pnpm store
  //    not yet linked). pnpm will re-run prepare scripts on the next install;
  //    don't break this one.
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (/lefthook.*not found|Cannot find module/i.test(combined)) {
    console.warn(
      "[install-hooks] lefthook binary not yet available; rerun 'pnpm install' " +
        "or 'pnpm exec lefthook install --force' to install hooks.",
    );
    return 0;
  }

  return result.status ?? 1;
}

process.exit(main());
