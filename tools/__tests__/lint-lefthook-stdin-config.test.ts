// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-lefthook-stdin-config.test.ts — Quick 260527-pj6 / Wave 3.T2.
 *
 * YAML-shape regression test that pins the lefthook 2.1.8
 * single-stdin-consumer invariant (RESEARCH R2.3 #2 + the
 * `use_stdin: true` requirement for the pre-push test-evidence gate
 * — without it, lefthook's pseudo-TTY default deadlocks every push).
 *
 * Assertions:
 *   1. `pre-push.commands.test-evidence.use_stdin === true`
 *   2. `pre-push.commands.test-evidence.run` matches
 *      `/lint-pre-push-test-evidence\.ts/`
 *   3. Exactly ONE command under `pre-push.commands` has
 *      `use_stdin: true` (single-consumer constraint).
 *   4. `pre-commit.commands.vitest-reporter-inheritance.run` matches
 *      `/lint-vitest-reporter-inheritance\.ts/` (B1 BLOCKER fix lock).
 *
 * Style mirrors `tools/lockers-allowlist-diff.test.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const LEFTHOOK_PATH = resolve(process.cwd(), "lefthook.yml");

interface LefthookCommand {
  run?: string;
  use_stdin?: boolean;
  glob?: string;
  fail_text?: string;
}

interface LefthookHook {
  parallel?: boolean;
  commands?: Record<string, LefthookCommand>;
}

interface LefthookConfig {
  "pre-commit"?: LefthookHook;
  "pre-push"?: LefthookHook;
  "commit-msg"?: LefthookHook;
}

function loadConfig(): LefthookConfig {
  const text = readFileSync(LEFTHOOK_PATH, "utf8");
  return parse(text) as LefthookConfig;
}

describe("pre-push.commands.test-evidence", () => {
  const cfg = loadConfig();
  const cmd = cfg["pre-push"]?.commands?.["test-evidence"];

  it("exists in pre-push commands", () => {
    expect(cmd).toBeDefined();
  });

  it("has use_stdin: true (mandatory — lefthook 2.1.8 deadlock guard)", () => {
    expect(cmd?.use_stdin).toBe(true);
  });

  it("runs the canonical validator script", () => {
    expect(cmd?.run).toMatch(/lint-pre-push-test-evidence\.ts/);
  });

  it("carries a fail_text mentioning --no-verify ban", () => {
    expect(cmd?.fail_text).toMatch(/no-verify/);
  });
});

describe("single-stdin-consumer constraint", () => {
  it("at most one command under pre-push.commands has use_stdin: true", () => {
    const cfg = loadConfig();
    const cmds = cfg["pre-push"]?.commands ?? {};
    const consumers = Object.entries(cmds).filter(([, c]) => c.use_stdin === true);
    expect(consumers.length).toBeLessThanOrEqual(1);
    if (consumers.length === 1) {
      // The sole consumer MUST be `test-evidence`.
      expect(consumers[0]?.[0]).toBe("test-evidence");
    }
  });
});

describe("pre-commit.commands.vitest-reporter-inheritance", () => {
  const cfg = loadConfig();
  const cmd = cfg["pre-commit"]?.commands?.["vitest-reporter-inheritance"];

  it("exists in pre-commit commands (B1 BLOCKER fix lock)", () => {
    expect(cmd).toBeDefined();
  });

  it("runs the canonical drift-defender script", () => {
    expect(cmd?.run).toMatch(/lint-vitest-reporter-inheritance\.ts/);
  });

  it("scopes the glob to vitest.config.ts files", () => {
    expect(cmd?.glob).toMatch(/vitest\.config\.ts/);
  });
});
