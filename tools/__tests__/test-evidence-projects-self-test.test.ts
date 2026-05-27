// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * test-evidence-projects-self-test.test.ts — Quick 260527-pj6 / Wave 3.T3.
 *
 * Unit tests for the scripted self-test that gates Wave 4's final
 * commit. Coverage target: ≥90/90/90/90 on the pure helpers
 * (`findFragmentProjects` + `runSelfTest`); the CLI wiring at the
 * bottom of the source file is `c8 ignore`'d (process-coupled).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findFragmentProjects, runSelfTest } from "../test-evidence-projects-self-test.js";

let root: string;
let evidenceDir: string;
let manifestPath: string;

const PROJECTS = ["api", "web", "@openwhispr/data", "tools"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "self-test-"));
  evidenceDir = join(root, ".test-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schema: 1, projects: PROJECTS }, null, 2), "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFrag(sha: string, project: string): void {
  const enc = encodeURIComponent(project);
  writeFileSync(
    join(evidenceDir, `${sha}-${enc}.json`),
    JSON.stringify({ schema: 1, project, commit_sha: sha }),
    "utf8",
  );
}

describe("findFragmentProjects", () => {
  it("returns decoded project names for matching prefix", () => {
    const sha = "a".repeat(40);
    for (const p of PROJECTS) writeFrag(sha, p);
    const found = findFragmentProjects(evidenceDir, sha).sort();
    expect(found).toEqual([...PROJECTS].sort());
  });
  it("ignores fragments for other SHAs", () => {
    const sha = "b".repeat(40);
    writeFrag(sha, "api");
    writeFrag("c".repeat(40), "web");
    expect(findFragmentProjects(evidenceDir, sha)).toEqual(["api"]);
  });
  it("returns empty array when directory does not exist", () => {
    const sha = "d".repeat(40);
    expect(findFragmentProjects(join(root, "nonexistent"), sha)).toEqual([]);
  });
  it("ignores non-json files matching the prefix", () => {
    const sha = "e".repeat(40);
    writeFrag(sha, "api");
    writeFileSync(join(evidenceDir, `${sha}-foo.txt`), "noise", "utf8");
    expect(findFragmentProjects(evidenceDir, sha)).toEqual(["api"]);
  });
  it("handles URI-encoded scoped package names", () => {
    const sha = "f".repeat(40);
    writeFrag(sha, "@openwhispr/data");
    expect(findFragmentProjects(evidenceDir, sha)).toEqual(["@openwhispr/data"]);
  });
});

describe("runSelfTest", () => {
  const headSha = "1".repeat(40);
  function stub(testAllCode = 0) {
    let stdout = "";
    let stderr = "";
    const outcome = runSelfTest({
      repoRoot: root,
      manifestPath,
      evidenceDir,
      headSha,
      runTestAll: () => testAllCode,
      stdout: { write: (s) => (stdout += s) },
      stderr: { write: (s) => (stderr += s) },
    });
    return { outcome, stdout, stderr };
  }

  it("exits 0 when all manifest projects emitted evidence + tests passed", () => {
    for (const p of PROJECTS) writeFrag(headSha, p);
    const { outcome, stdout } = stub();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.missing).toEqual([]);
    expect(stdout).toMatch(new RegExp(headSha));
  });

  it("exits 1 with missing projects listed", () => {
    writeFrag(headSha, "api");
    const { outcome, stderr } = stub();
    expect(outcome.exitCode).toBe(1);
    expect(outcome.missing.sort()).toEqual(["@openwhispr/data", "tools", "web"]);
    expect(stderr).toMatch(/web/);
    expect(stderr).toMatch(/tools/);
  });

  it("exits 1 with hint when tests failed but evidence is complete", () => {
    for (const p of PROJECTS) writeFrag(headSha, p);
    const { outcome, stderr } = stub(2);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.testAllExitCode).toBe(2);
    expect(stderr).toMatch(/pnpm test:all exited 2/);
  });

  it("warns on unexpected (drift) projects but still passes", () => {
    for (const p of PROJECTS) writeFrag(headSha, p);
    writeFrag(headSha, "rogue-extra-project");
    const { outcome, stderr } = stub();
    expect(outcome.exitCode).toBe(0);
    expect(stderr).toMatch(/manifest drift|unexpected/i);
  });

  it("exits 2 when manifest is missing", () => {
    rmSync(manifestPath);
    const { outcome, stderr } = stub();
    expect(outcome.exitCode).toBe(2);
    expect(stderr).toMatch(/cannot load manifest/i);
  });
});
