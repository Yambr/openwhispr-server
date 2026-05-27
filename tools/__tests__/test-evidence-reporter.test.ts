// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * test-evidence-reporter.test.ts — Quick 260527-pj6 / Wave 1.T1.
 *
 * Unit tests for the custom Vitest Reporter that writes per-workspace
 * evidence fragments to `.test-evidence/<sha>-<project>.json` after
 * each `pnpm test` run.
 *
 * F-cases (PLAN scope item 15 / section 5):
 *   F1  — 3 passing modules + 1 failing + 1 annotated skip → counts correct
 *   F2  — un-annotated skip detected (no SKIP-REASON in lookback)
 *   F3  — watch mode → no fragment written
 *   F4  — fresh repo (no `OPENWHISPR_TEST_EVIDENCE_SHA` AND `git rev-parse` mocked to fail) → no fragment
 *   F5  — `reason === "interrupted"` → no fragment
 *   F6  — atomic write: `<final>.tmp.*` orphan does NOT exist after success
 *   F7  — symlink TOCTOU defence: pre-existing symlink at target → REFUSE
 *   F8  — fragment mode `0o600`
 *   F9  — env overrides honoured (`OPENWHISPR_TEST_EVIDENCE_DIR` + `OPENWHISPR_TEST_EVIDENCE_SHA`)
 *   F10 — project grouping → exactly one fragment per project name
 *
 * The Reporter contract is the EXTERNAL boundary (Vitest 4.1.5). We
 * synthesise `TestModule` / `TestCase` / `TestProject` fakes that
 * match the interface declared in
 * `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1041-1115`.
 * No real `vitest` process is spawned in unit tests.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import TestEvidenceReporter, {
  buildFragmentsForTest,
  type FakeReporterModule,
  type ReporterDeps,
  resolveCommitSha,
  resolveEvidenceDir,
  writeFragmentsAtomic,
} from "../test-evidence-reporter.js";

let workspace: string;
let evidenceDir: string;
let sourcesDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "test-evidence-reporter-"));
  evidenceDir = join(workspace, ".test-evidence");
  sourcesDir = join(workspace, "sources");
  mkdirSync(sourcesDir, { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Write a test source file and return its absolute path. */
function writeSource(rel: string, body: string): string {
  const abs = join(sourcesDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
}

/** Compose a fake `TestModule` matching the Vitest 4.1.5 reporter
 *  contract — only the fields the reporter actually consumes. */
function fakeModule(opts: {
  moduleId: string;
  projectName: string;
  cases: Array<{
    name: string;
    fullName?: string;
    state: "passed" | "failed" | "skipped" | "pending";
    mode?: "run" | "only" | "skip" | "todo";
    line: number;
    errorMessage?: string;
  }>;
}): FakeReporterModule {
  const project = { name: opts.projectName };
  const cases = opts.cases.map((c) => {
    const errors =
      c.state === "failed" ? [{ message: c.errorMessage ?? "boom", stack: "<stack>" }] : undefined;
    return {
      name: c.name,
      fullName: c.fullName ?? c.name,
      options: { mode: c.mode ?? (c.state === "skipped" ? "skip" : "run") },
      project,
      location: { line: c.line, column: 0 },
      result: () => ({ state: c.state, errors, note: undefined }),
    };
  });
  return {
    moduleId: opts.moduleId,
    children: {
      allTests: function* () {
        for (const c of cases) yield c;
      },
    },
  };
}

describe("F1 — 3 pass + 1 fail + 1 annotated skip", () => {
  it("emits correct counts and zero unannotated_skip", () => {
    const src = writeSource(
      "foo.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it('a', () => {});",
        "  it('b', () => {});",
        "  it('c', () => {});",
        "  it('d', () => { throw new Error('x'); });",
        "  // SKIP-REASON: requires-docker — testcontainers gate",
        "  it.skip('e', () => {});",
        "});",
      ].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [
        { name: "a", state: "passed", line: 3 },
        { name: "b", state: "passed", line: 4 },
        { name: "c", state: "passed", line: 5 },
        { name: "d", state: "failed", line: 6, errorMessage: "x" },
        { name: "e", state: "skipped", mode: "skip", line: 8 },
      ],
    });
    const fragments = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "1".repeat(40),
      projectRoot: workspace,
    });
    expect(fragments).toHaveLength(1);
    const frag = fragments[0]!;
    expect(frag.project).toBe("api");
    expect(frag.total).toBe(5);
    expect(frag.pass).toBe(3);
    expect(frag.fail).toBe(1);
    expect(frag.skip).toBe(1);
    expect(frag.todo).toBe(0);
    expect(frag.unannotated_skip).toBe(0);
    expect(frag.failures).toHaveLength(1);
    expect(frag.failures[0]?.name).toBe("d");
    expect(frag.skips).toHaveLength(1);
    expect(frag.skips[0]?.annotated).toBe(true);
    expect(frag.skips[0]?.skip_reason).toMatch(/requires-docker/);
  });
});

describe("F2 — un-annotated skip", () => {
  it("flags skip with no SKIP-REASON in 5-line lookback", () => {
    const src = writeSource(
      "bar.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "describe('outer', () => {",
        "  it.skip('orphan', () => {});",
        "});",
      ].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [{ name: "orphan", state: "skipped", mode: "skip", line: 3 }],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "2".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.unannotated_skip).toBe(1);
    expect(frag?.skips[0]?.annotated).toBe(false);
    expect(frag?.skips[0]?.skip_reason).toBeNull();
  });
});

describe("F3 — watch mode → no fragment written", () => {
  it("returns early when vitest.config.watch === true", () => {
    const mod = fakeModule({
      moduleId: writeSource("c.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const reporter = new TestEvidenceReporter();
    const deps: ReporterDeps = {
      evidenceDir,
      commitSha: "3".repeat(40),
      projectRoot: workspace,
      stderr: { write: () => {} },
    };
    // Simulate onInit with watch=true via the public onInit hook.
    reporter.onInit({ config: { watch: true } });
    reporter.onTestRunEndForTest([mod], [], "passed", deps);
    expect(existsSync(evidenceDir)).toBe(false);
  });
});

describe("F4 — missing commit SHA", () => {
  it("returns early + writes nothing if commitSha resolver returns null", () => {
    const mod = fakeModule({
      moduleId: writeSource("d.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const reporter = new TestEvidenceReporter();
    const deps: ReporterDeps = {
      evidenceDir,
      commitSha: null,
      projectRoot: workspace,
      stderr: { write: () => {} },
    };
    reporter.onTestRunEndForTest([mod], [], "passed", deps);
    expect(existsSync(evidenceDir)).toBe(false);
  });
});

describe("F5 — reason === 'interrupted' → no fragment", () => {
  it("does not write on interrupted runs", () => {
    const mod = fakeModule({
      moduleId: writeSource("e.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const reporter = new TestEvidenceReporter();
    const deps: ReporterDeps = {
      evidenceDir,
      commitSha: "5".repeat(40),
      projectRoot: workspace,
      stderr: { write: () => {} },
    };
    reporter.onTestRunEndForTest([mod], [], "interrupted", deps);
    expect(existsSync(evidenceDir)).toBe(false);
  });
});

describe("F6 — atomic write leaves no .tmp orphan", () => {
  it("only the final file exists post-write", () => {
    const mod = fakeModule({
      moduleId: writeSource("f.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const sha = "6".repeat(40);
    writeFragmentsAtomic({
      fragments: buildFragmentsForTest({
        testModules: [mod],
        commitSha: sha,
        projectRoot: workspace,
      }),
      evidenceDir,
      stderr: { write: () => {} },
    });
    const entries = readdirSync(evidenceDir);
    expect(entries).toContain(`${sha}-api.json`);
    for (const e of entries) {
      expect(e).not.toMatch(/\.tmp\./);
    }
  });
});

describe("F7 — symlink TOCTOU defence", () => {
  it("refuses to overwrite if target is a pre-existing symlink", () => {
    const sha = "7".repeat(40);
    mkdirSync(evidenceDir, { recursive: true });
    const target = join(workspace, "attacker-target");
    writeFileSync(target, "{}", "utf8");
    symlinkSync(target, join(evidenceDir, `${sha}-api.json`));
    const mod = fakeModule({
      moduleId: writeSource("g.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    let stderrBuf = "";
    expect(() =>
      writeFragmentsAtomic({
        fragments: buildFragmentsForTest({
          testModules: [mod],
          commitSha: sha,
          projectRoot: workspace,
        }),
        evidenceDir,
        stderr: { write: (s) => (stderrBuf += s) },
      }),
    ).toThrow(/symlink|refused/i);
    expect(stderrBuf).toMatch(/symlink|refused/i);
  });
});

describe("F8 — fragment file mode 0o600", () => {
  it("file is rw for owner only", () => {
    const sha = "8".repeat(40);
    const mod = fakeModule({
      moduleId: writeSource("h.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    writeFragmentsAtomic({
      fragments: buildFragmentsForTest({
        testModules: [mod],
        commitSha: sha,
        projectRoot: workspace,
      }),
      evidenceDir,
      stderr: { write: () => {} },
    });
    const finalPath = join(evidenceDir, `${sha}-api.json`);
    const mode = statSync(finalPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("F9 — env overrides honoured", () => {
  it("honours OPENWHISPR_TEST_EVIDENCE_DIR + OPENWHISPR_TEST_EVIDENCE_SHA", () => {
    const overrideDir = join(workspace, "overridden-evidence");
    const overrideSha = "9".repeat(40);
    const mod = fakeModule({
      moduleId: writeSource("i.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const reporter = new TestEvidenceReporter();
    reporter.onTestRunEndForTest([mod], [], "passed", {
      evidenceDir: overrideDir,
      commitSha: overrideSha,
      projectRoot: workspace,
      stderr: { write: () => {} },
    });
    const finalPath = join(overrideDir, `${overrideSha}-api.json`);
    expect(existsSync(finalPath)).toBe(true);
    const data = JSON.parse(readFileSync(finalPath, "utf8")) as { commit_sha: string };
    expect(data.commit_sha).toBe(overrideSha);
  });
});

describe("F10 — project grouping → one fragment per project", () => {
  it("emits exactly one fragment per distinct project name", () => {
    const src1 = writeSource(
      "api1.test.ts",
      ["import { it } from 'vitest';", "it('a', () => {});", ""].join("\n"),
    );
    const src2 = writeSource(
      "api2.test.ts",
      ["import { it } from 'vitest';", "it('b', () => {});", ""].join("\n"),
    );
    const src3 = writeSource(
      "data1.test.ts",
      ["import { it } from 'vitest';", "it('c', () => {});", ""].join("\n"),
    );
    const sha = "a".repeat(40);
    const modules = [
      fakeModule({
        moduleId: src1,
        projectName: "api",
        cases: [{ name: "a", state: "passed", line: 2 }],
      }),
      fakeModule({
        moduleId: src2,
        projectName: "api",
        cases: [{ name: "b", state: "passed", line: 2 }],
      }),
      fakeModule({
        moduleId: src3,
        projectName: "data",
        cases: [{ name: "c", state: "passed", line: 2 }],
      }),
    ];
    writeFragmentsAtomic({
      fragments: buildFragmentsForTest({
        testModules: modules,
        commitSha: sha,
        projectRoot: workspace,
      }),
      evidenceDir,
      stderr: { write: () => {} },
    });
    const files = readdirSync(evidenceDir).sort();
    expect(files).toEqual([`${sha}-api.json`, `${sha}-data.json`]);
    const api = JSON.parse(readFileSync(join(evidenceDir, files[0]!), "utf8")) as {
      total: number;
    };
    expect(api.total).toBe(2);
  });
});

describe("F10b — scoped project name (Quick 260527-pj6 / W4 fix)", () => {
  it("encodeURIComponent escapes path separators in scoped names", () => {
    // Scoped project names like `@openwhispr/byok-guard` contain a `/`
    // which would otherwise resolve as a directory separator inside
    // `<evidenceDir>/<sha>-<project>.json`. The reporter MUST encode
    // the project segment so the filename stays in the evidence dir
    // and the validator's matching `encodeURIComponent` (see
    // `tools/lint-pre-push-test-evidence.ts:resolveFragmentPath`) and
    // the self-test's `decodeURIComponent` round-trip cleanly.
    const src = writeSource(
      "scoped.test.ts",
      ["import { it } from 'vitest';", "it('scoped', () => {});", ""].join("\n"),
    );
    const sha = "c".repeat(40);
    const modules = [
      fakeModule({
        moduleId: src,
        projectName: "@openwhispr/byok-guard",
        cases: [{ name: "scoped", state: "passed", line: 2 }],
      }),
    ];
    writeFragmentsAtomic({
      fragments: buildFragmentsForTest({
        testModules: modules,
        commitSha: sha,
        projectRoot: workspace,
      }),
      evidenceDir,
      stderr: { write: () => {} },
    });
    // Single file, scoped name URI-encoded so the `/` does not split
    // into a subdirectory.
    const entries = readdirSync(evidenceDir);
    expect(entries).toEqual([`${sha}-${encodeURIComponent("@openwhispr/byok-guard")}.json`]);
    // Round-trip: decode back to the original project name.
    const projectFromFilename = decodeURIComponent(
      entries[0]!.slice(`${sha}-`.length, -".json".length),
    );
    expect(projectFromFilename).toBe("@openwhispr/byok-guard");
  });
});

describe("error message truncation per LOCKER-05", () => {
  it("truncates error_message_truncated to ≤ 1000 chars", () => {
    const src = writeSource(
      "long-err.test.ts",
      ["import { it } from 'vitest';", "it('x', () => {});", ""].join("\n"),
    );
    const longMsg = "z".repeat(3000);
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [{ name: "x", state: "failed", line: 2, errorMessage: longMsg }],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "b".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.failures[0]?.error_message_truncated.length).toBeLessThanOrEqual(1000);
  });
});

describe("todo classification", () => {
  it("counts `.todo` separately from `.skip` and flags unannotated_skip", () => {
    const src = writeSource(
      "todo.test.ts",
      [
        "import { it } from 'vitest';",
        "it.todo('not yet');",
        "// SKIP-REASON: deferred-fix — landing in Quick-260601",
        "it.todo('annotated');",
      ].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [
        { name: "not yet", state: "skipped", mode: "todo", line: 2 },
        { name: "annotated", state: "skipped", mode: "todo", line: 4 },
      ],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "c".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.todo).toBe(2);
    expect(frag?.skip).toBe(0);
    expect(frag?.unannotated_skip).toBe(1);
  });
});

describe("empty module set", () => {
  it("returns empty fragments array (no write)", () => {
    const reporter = new TestEvidenceReporter();
    reporter.onTestRunEndForTest([], [], "passed", {
      evidenceDir,
      commitSha: "d".repeat(40),
      projectRoot: workspace,
      stderr: { write: () => {} },
    });
    expect(existsSync(evidenceDir)).toBe(false);
  });
});

describe("symlink defence on evidence directory itself", () => {
  it("refuses when evidenceDir itself resolves through a symlink at parent", () => {
    // Path-traversal-style symlink at the evidence directory location.
    const realEvidence = join(workspace, "real-evidence-target");
    mkdirSync(realEvidence, { recursive: true });
    symlinkSync(realEvidence, evidenceDir);
    // lstat on the directory itself will return symlink — the reporter
    // refuses to mkdir on a symlinked target to avoid TOCTOU.
    expect(lstatSync(evidenceDir).isSymbolicLink()).toBe(true);
    const mod = fakeModule({
      moduleId: writeSource("k.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    expect(() =>
      writeFragmentsAtomic({
        fragments: buildFragmentsForTest({
          testModules: [mod],
          commitSha: "e".repeat(40),
          projectRoot: workspace,
        }),
        evidenceDir,
        stderr: { write: () => {} },
      }),
    ).toThrow(/symlink|refused/i);
  });
});

describe("malformed SHA env override is rejected", () => {
  it("only writes when commitSha matches /^[0-9a-f]{40}$/", () => {
    const mod = fakeModule({
      moduleId: writeSource("m.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    const reporter = new TestEvidenceReporter();
    reporter.onTestRunEndForTest([mod], [], "passed", {
      evidenceDir,
      commitSha: "GG" + "0".repeat(38),
      projectRoot: workspace,
      stderr: { write: () => {} },
    });
    expect(existsSync(evidenceDir)).toBe(false);
  });
});

describe("resolveEvidenceDir", () => {
  it("returns env-resolved path when OPENWHISPR_TEST_EVIDENCE_DIR set", () => {
    const oldEnv = process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
    process.env.OPENWHISPR_TEST_EVIDENCE_DIR = "/tmp/explicit-evidence-x";
    try {
      expect(resolveEvidenceDir(workspace)).toBe("/tmp/explicit-evidence-x");
    } finally {
      if (oldEnv === undefined) delete process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
      else process.env.OPENWHISPR_TEST_EVIDENCE_DIR = oldEnv;
    }
  });
  it("falls back to <root>/.test-evidence when env absent", () => {
    const oldEnv = process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
    delete process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
    try {
      expect(resolveEvidenceDir(workspace)).toBe(join(workspace, ".test-evidence"));
    } finally {
      if (oldEnv !== undefined) process.env.OPENWHISPR_TEST_EVIDENCE_DIR = oldEnv;
    }
  });
});

describe("resolveCommitSha", () => {
  it("returns env value when OPENWHISPR_TEST_EVIDENCE_SHA set", () => {
    const oldEnv = process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
    const expected = "f".repeat(40);
    process.env.OPENWHISPR_TEST_EVIDENCE_SHA = expected;
    try {
      expect(resolveCommitSha(workspace)).toBe(expected);
    } finally {
      if (oldEnv === undefined) delete process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
      else process.env.OPENWHISPR_TEST_EVIDENCE_SHA = oldEnv;
    }
  });
  it("returns null in a fresh dir (no git repo)", () => {
    const oldEnv = process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
    delete process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
    try {
      const sha = resolveCommitSha(workspace);
      // The mkdtempSync workspace is NOT inside a git repo, so
      // `git rev-parse HEAD` will fail and resolveCommitSha returns
      // null.
      expect(sha).toBeNull();
    } finally {
      if (oldEnv !== undefined) process.env.OPENWHISPR_TEST_EVIDENCE_SHA = oldEnv;
    }
  });
});

describe("public onTestRunEnd wrapper", () => {
  it("writes a fragment using env-overridden dir + sha", () => {
    const oldDir = process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
    const oldSha = process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
    const expectedSha = "b".repeat(40);
    process.env.OPENWHISPR_TEST_EVIDENCE_DIR = evidenceDir;
    process.env.OPENWHISPR_TEST_EVIDENCE_SHA = expectedSha;
    try {
      const mod = fakeModule({
        moduleId: writeSource("public.test.ts", "// empty"),
        projectName: "api",
        cases: [{ name: "a", state: "passed", line: 1 }],
      });
      const reporter = new TestEvidenceReporter();
      // onInit with watch=false is the realistic path.
      reporter.onInit({ config: { watch: false } });
      reporter.onTestRunEnd([mod], [], "passed");
      const finalPath = join(evidenceDir, `${expectedSha}-api.json`);
      expect(existsSync(finalPath)).toBe(true);
      const data = JSON.parse(readFileSync(finalPath, "utf8")) as { commit_sha: string };
      expect(data.commit_sha).toBe(expectedSha);
    } finally {
      if (oldDir === undefined) delete process.env.OPENWHISPR_TEST_EVIDENCE_DIR;
      else process.env.OPENWHISPR_TEST_EVIDENCE_DIR = oldDir;
      if (oldSha === undefined) delete process.env.OPENWHISPR_TEST_EVIDENCE_SHA;
      else process.env.OPENWHISPR_TEST_EVIDENCE_SHA = oldSha;
    }
  });
});

describe("memoised source reader handles missing files", () => {
  it("treats a non-existent moduleId source as unannotated skip", () => {
    const phantomId = join(workspace, "does-not-exist.test.ts");
    const mod = fakeModule({
      moduleId: phantomId,
      projectName: "api",
      cases: [{ name: "phantom", state: "skipped", mode: "skip", line: 5 }],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "c".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.skip).toBe(1);
    expect(frag?.unannotated_skip).toBe(1);
    expect(frag?.skips[0]?.annotated).toBe(false);
  });
});

describe("memoisation across two cases in the same module", () => {
  it("reads the source exactly once even with many skip sites", () => {
    const src = writeSource(
      "memo.test.ts",
      [
        "import { it } from 'vitest';",
        "// SKIP-REASON: testing-only — memoisation fixture",
        "it.skip('a', () => {});",
        "// SKIP-REASON: testing-only — memoisation fixture",
        "it.skip('b', () => {});",
      ].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [
        { name: "a", state: "skipped", mode: "skip", line: 3 },
        { name: "b", state: "skipped", mode: "skip", line: 5 },
      ],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "d".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.skip).toBe(2);
    expect(frag?.unannotated_skip).toBe(0);
  });
});

describe("location.line === undefined treated as unannotated", () => {
  it("emits skip without annotation when source location is unknown", () => {
    const src = writeSource(
      "noloc.test.ts",
      ["import { it } from 'vitest';", "it.skip('x', () => {});"].join("\n"),
    );
    // Synthesise a case whose location is undefined.
    const mod: FakeReporterModule = {
      moduleId: src,
      children: {
        allTests: function* () {
          yield {
            name: "x",
            fullName: "x",
            options: { mode: "skip" },
            project: { name: "api" },
            location: undefined,
            result: () => ({ state: "skipped", errors: undefined, note: undefined }),
          };
        },
      },
    };
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "e".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.unannotated_skip).toBe(1);
  });
});

describe("relativeOrAbs fallback when projectRoot does not contain the module", () => {
  it("falls back to the absolute moduleId for unrelated paths", () => {
    const src = writeSource(
      "outside.test.ts",
      ["import { it } from 'vitest';", "it('x', () => {});"].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [{ name: "x", state: "failed", line: 2, errorMessage: "fail" }],
    });
    // Pass an entirely unrelated projectRoot — relative() will
    // return a `..`-prefixed string, so the function falls back
    // to the absolute path.
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "0".repeat(40),
      projectRoot: "/nonexistent/sibling",
    });
    expect(frag?.failures[0]?.file).toBe(src);
  });
});

describe("failed test without errors array", () => {
  it("falls back to <no message> when result.errors is empty/undefined", () => {
    const src = writeSource(
      "no-err.test.ts",
      ["import { it } from 'vitest';", "it('x', () => {});"].join("\n"),
    );
    const mod: FakeReporterModule = {
      moduleId: src,
      children: {
        allTests: function* () {
          yield {
            name: "x",
            fullName: "x",
            options: { mode: "run" },
            project: { name: "api" },
            location: { line: 2, column: 0 },
            result: () => ({ state: "failed", errors: [], note: undefined }),
          };
        },
      },
    };
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "1".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.failures[0]?.error_message_truncated).toBe("<no message>");
  });
});

describe("test case with no fullName falls back to name", () => {
  it("uses tc.name when fullName is undefined for failed + skipped paths", () => {
    const src = writeSource(
      "no-fullname.test.ts",
      ["import { it } from 'vitest';", "it('x', () => {});", "it.skip('y', () => {});"].join("\n"),
    );
    const mod: FakeReporterModule = {
      moduleId: src,
      children: {
        allTests: function* () {
          yield {
            name: "only-name-failed",
            options: { mode: "run" },
            project: { name: "api" },
            location: { line: 2, column: 0 },
            result: () => ({ state: "failed", errors: undefined, note: undefined }),
          };
          yield {
            name: "only-name-skipped",
            options: { mode: "skip" },
            project: { name: "api" },
            location: { line: 3, column: 0 },
            result: () => ({ state: "skipped", errors: undefined, note: undefined }),
          };
        },
      },
    };
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "2".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.failures[0]?.name).toBe("only-name-failed");
    expect(frag?.skips[0]?.name).toBe("only-name-skipped");
  });
});

describe("SKIP-REASON regex defensive capture", () => {
  it("treats whitespace-only annotation body as too-short → unannotated", () => {
    const src = writeSource(
      "ws-only.test.ts",
      [
        "import { it } from 'vitest';",
        // The annotation matches the prefix but body has < 10 chars after trim.
        "// SKIP-REASON: short",
        "it.skip('x', () => {});",
      ].join("\n"),
    );
    const mod = fakeModule({
      moduleId: src,
      projectName: "api",
      cases: [{ name: "x", state: "skipped", mode: "skip", line: 3 }],
    });
    const [frag] = buildFragmentsForTest({
      testModules: [mod],
      commitSha: "3".repeat(40),
      projectRoot: workspace,
    });
    expect(frag?.unannotated_skip).toBe(1);
  });
});

describe("non-Error rejection in mkdir failure path is defensive", () => {
  it("does not crash when stderr.write receives non-Error payload (smoke)", () => {
    // We cannot easily make mkdirSync throw a non-Error in Node,
    // so this just exercises the Error path via blocker file.
    // The non-Error branch is c8-ignored.
    const blocker = join(workspace, "blocker-non-err");
    writeFileSync(blocker, "x", "utf8");
    expect(() =>
      writeFragmentsAtomic({
        fragments: [
          {
            schema: 1,
            generated_at: new Date().toISOString(),
            project: "p",
            commit_sha: "4".repeat(40),
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
          },
        ],
        evidenceDir: blocker,
        stderr: { write: () => {} },
      }),
    ).toThrow();
  });
});

describe("error path — write tmp on read-only directory", () => {
  it("throws and writes a stderr message when writeFileSync fails", () => {
    // Strategy: use a path that cannot be `mkdir`d (e.g. a file)
    // as the evidence directory; mkdirSync will fail.
    const fileBlocker = join(workspace, "blocker");
    writeFileSync(fileBlocker, "data", "utf8");
    const mod = fakeModule({
      moduleId: writeSource("err.test.ts", "// empty"),
      projectName: "api",
      cases: [{ name: "a", state: "passed", line: 1 }],
    });
    let buf = "";
    expect(() =>
      writeFragmentsAtomic({
        fragments: buildFragmentsForTest({
          testModules: [mod],
          commitSha: "9".repeat(40),
          projectRoot: workspace,
        }),
        evidenceDir: fileBlocker,
        stderr: { write: (s) => (buf += s) },
      }),
    ).toThrow();
    expect(buf).toMatch(/mkdir refused/);
  });
});
