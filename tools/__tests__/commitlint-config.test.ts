// SPDX-License-Identifier: FSL-1.1-ALv2
// Asserts the split between strict (`commitlint.config.cjs`) and relaxed
// (`commitlint.config.dependabot.cjs`) configs:
//   • Dependabot-shaped commits PASS the dependabot config and FAIL the strict config.
//   • Conventional human commits PASS the strict config.
//   • The DOCS-09 Cyrillic ban applies to BOTH configs (defence-in-depth).
//
// The CI commitlint job selects the config via `github.actor == 'dependabot[bot]'`
// (see `.github/workflows/ci.yml`); lefthook's `commit-msg` hook uses the
// strict default for local commits.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const STRICT = "commitlint.config.cjs";
const RELAXED = "commitlint.config.dependabot.cjs";

function runCommitlint(
  input: string,
  configFile: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node_modules/.bin/commitlint", ["--config", configFile], {
    cwd: REPO_ROOT,
    input,
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("commitlint config split (strict vs dependabot)", () => {
  const dependabotMsg = [
    "chore(deps): Bump the actions-minor-and-patch group across 1 directory with 4 updates",
    "",
    "Bumps the actions-minor-and-patch group with 4 updates in the / directory: very long body line that would normally trip body-max-line-length=100 default rule for sure.",
  ].join("\n");

  const humanCorrect = "fix(api): patch upstream relay timeout\n\nshort body\n";
  // Cyrillic codepoints injected via \u escapes so this source file remains
  // ASCII-only (tools/lint-english.ts contract — mirrors the same pattern
  // used in `commitlint.config.cjs` for the DOCS-09 RegExp build).
  const cyrillicBody =
    "fix(api): patch upstream relay timeout\n\n" +
    String.fromCharCode(0x042d, 0x0442, 0x043e) +
    " body\n";

  it("dependabot-shaped commit PASSES the dependabot config", () => {
    const r = runCommitlint(dependabotMsg, RELAXED);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
  });

  it("dependabot-shaped commit FAILS the strict config", () => {
    const r = runCommitlint(dependabotMsg, STRICT);
    expect(r.status).not.toBe(0);
    // Should trip either subject-case or body-max-line-length.
    expect(`${r.stdout}${r.stderr}`).toMatch(/subject-case|body-max-line-length/);
  });

  it("conventional human commit PASSES the strict config", () => {
    const r = runCommitlint(humanCorrect, STRICT);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
  });

  it("Cyrillic-in-body commit FAILS the strict config (DOCS-09)", () => {
    const r = runCommitlint(cyrillicBody, STRICT);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/body-no-cyrillic/);
  });

  it("Cyrillic-in-body commit FAILS the dependabot config (DOCS-09 universal)", () => {
    const r = runCommitlint(cyrillicBody, RELAXED);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/body-no-cyrillic/);
  });
});
