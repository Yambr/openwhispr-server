// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-lefthook-stdin-config.test.ts — Quick 260527-pj6 / Wave 3.T2,
 * updated by Quick 260528-kqv.
 *
 * YAML-shape regression test that pins the lefthook 2.1.8
 * single-stdin-consumer invariant (RESEARCH R2.3 #2 + the
 * `use_stdin: true` requirement for the pre-push test-evidence gate
 * — without it, lefthook's pseudo-TTY default deadlocks every push).
 *
 * Quick 260528-kqv: the gate moved from `pre-push.commands.test-evidence`
 * to `pre-push.scripts['test-evidence.sh']`. lefthook 2.1.8 skips any
 * pre-push COMMAND with no file template when the push file-diff is
 * empty ("(skip) no matching push files", build_command.go:72-80, #57),
 * leaving the gate dormant on an in-sync branch. lefthook SCRIPTS
 * (build_script.go) never apply the push-files skip, so the gate now
 * runs on EVERY push. `use_stdin: true` composes with scripts and
 * forwards the pre-push stdin protocol unchanged; the gate remains the
 * SOLE pre-push stdin consumer.
 *
 * Assertions:
 *   1. `pre-push.scripts['test-evidence.sh'].use_stdin === true`
 *   2. `pre-push.scripts['test-evidence.sh'].runner === "bash"`
 *   3. `pre-push.scripts['test-evidence.sh'].fail_text` matches
 *      `/no-verify/` (the --no-verify ban).
 *   4. Exactly ONE entry across `pre-push.commands` AND
 *      `pre-push.scripts` has `use_stdin: true`, and it is
 *      `test-evidence.sh` (single-consumer constraint).
 *   5. `pre-commit.commands.vitest-reporter-inheritance.run` matches
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
  runner?: string;
}

interface LefthookHook {
  parallel?: boolean;
  commands?: Record<string, LefthookCommand>;
  scripts?: Record<string, LefthookCommand>;
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

describe("pre-push.scripts test-evidence.sh", () => {
  const cfg = loadConfig();
  const cmd = cfg["pre-push"]?.scripts?.["test-evidence.sh"];

  it("exists in pre-push scripts (Quick 260528-kqv: command → script, #57)", () => {
    expect(cmd).toBeDefined();
  });

  it("has use_stdin: true (mandatory — lefthook 2.1.8 deadlock guard)", () => {
    expect(cmd?.use_stdin).toBe(true);
  });

  it("uses the bash runner (scripts use runner + script file, not inline run)", () => {
    expect(cmd?.runner).toBe("bash");
  });

  it("carries a fail_text mentioning --no-verify ban", () => {
    expect(cmd?.fail_text).toMatch(/no-verify/);
  });
});

describe("single-stdin-consumer constraint", () => {
  it("exactly one entry across pre-push commands AND scripts has use_stdin: true", () => {
    const cfg = loadConfig();
    const prePush = cfg["pre-push"] ?? {};
    const entries: Array<[string, LefthookCommand]> = [
      ...Object.entries(prePush.commands ?? {}),
      ...Object.entries(prePush.scripts ?? {}),
    ];
    const consumers = entries.filter(([, c]) => c.use_stdin === true);
    expect(consumers.length).toBe(1);
    // The sole consumer MUST be the `test-evidence.sh` script.
    expect(consumers[0]?.[0]).toBe("test-evidence.sh");
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
