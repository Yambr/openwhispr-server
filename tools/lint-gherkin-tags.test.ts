// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 21 / Plan 21-01 / SR-21.1 — RED→GREEN tests for tools/lint-gherkin-tags.ts.
//
// Pattern matches tools/lint-cjm-doc.test.ts: execFileSync-driven subprocess
// tests for CLI exit codes + in-process pure-function tests for granular
// coverage.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectFeatureFiles,
  extractScenarios,
  extractTagTokens,
  lintExpectedRedHasGate,
  lintNegativeTwinPresent,
  lintNoFocusOrSkip,
  lintTagAnchorParity,
  run,
} from "./lint-gherkin-tags";

const SCRIPT = join(process.cwd(), "tools", "lint-gherkin-tags.ts");

function runLint(args: string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer; stdout?: Buffer };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
      stdout: e.stdout?.toString() ?? "",
    };
  }
}

function makeRepo(): { dir: string; doc: string; featDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "lgt-"));
  const docDir = join(dir, "docs");
  mkdirSync(docDir, { recursive: true });
  const doc = join(docDir, "customer-journeys.md");
  writeFileSync(
    doc,
    [
      "# Customer Journeys",
      "",
      "## 1. Foo",
      "",
      "### @cjm-1.1 Happy",
      "",
      "### @cjm-1.2 Negative twin error",
      "",
    ].join("\n"),
  );
  const featDir = join(dir, "tests", "e2e-cjm", "features");
  mkdirSync(featDir, { recursive: true });
  return { dir, doc, featDir };
}

function writeFeature(featDir: string, name: string, body: string): string {
  const p = join(featDir, name);
  writeFileSync(p, body);
  return p;
}

// ──────────────────────────────────────────────────────────────────
// Pure-function tests (in-process — high coverage, fast).
// ──────────────────────────────────────────────────────────────────

describe("extractTagTokens", () => {
  it("returns the empty array on a non-tag line", () => {
    expect(extractTagTokens("Feature: Foo", 1)).toEqual([]);
    expect(extractTagTokens("  Scenario: bar", 2)).toEqual([]);
  });

  it("returns @-tags on a tag line with their line number", () => {
    const out = extractTagTokens("  @cjm-1.1 @expected-red @after-phase-19.1", 7);
    expect(out).toEqual([
      { tag: "@cjm-1.1", line: 7 },
      { tag: "@expected-red", line: 7 },
      { tag: "@after-phase-19.1", line: 7 },
    ]);
  });
});

describe("extractScenarios", () => {
  it("captures scenario headings with their preceding tag line", () => {
    const body = [
      "Feature: F",
      "",
      "  @cjm-1.1",
      "  Scenario: happy",
      "    Given x",
      "",
      "  @cjm-1.2",
      "  Scenario: negative twin error",
      "    Given y",
    ].join("\n");
    const scs = extractScenarios(body);
    expect(scs).toHaveLength(2);
    expect(scs[0].title).toBe("happy");
    expect(scs[0].tags.map((t) => t.tag)).toEqual(["@cjm-1.1"]);
    expect(scs[1].title).toBe("negative twin error");
  });
});

describe("lintNoFocusOrSkip", () => {
  it("flags @skip", () => {
    const offenders = lintNoFocusOrSkip(new Map([["a.feature", "  @skip\n  Scenario: x\n"]]));
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/@skip/);
  });

  it("flags @focus and @only and .skip and .only", () => {
    const cases = ["  @focus\n  Scenario: x", "  @only\n  Scenario: x"];
    for (const body of cases) {
      const offenders = lintNoFocusOrSkip(new Map([["a.feature", body]]));
      expect(offenders.length).toBeGreaterThan(0);
    }
  });

  it("flags inline .skip / .only literals appearing anywhere in a line", () => {
    const offenders = lintNoFocusOrSkip(
      new Map([["lit.feature", "Feature: F\n\n  Scenario: x .skip me please\n    Given y\n"]]),
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/forbidden literal/i);
  });

  it("returns no offenders for a clean file", () => {
    const offenders = lintNoFocusOrSkip(
      new Map([["a.feature", "  @cjm-1.1\n  Scenario: happy\n"]]),
    );
    expect(offenders).toEqual([]);
  });
});

describe("extractScenarios (edge cases)", () => {
  it("treats comment lines as transparent — tag accumulator preserved", () => {
    const body = ["Feature: F", "  @cjm-1.1", "# a comment line", "  Scenario: happy"].join("\n");
    const scs = extractScenarios(body);
    expect(scs).toHaveLength(1);
    expect(scs[0].tags.map((t) => t.tag)).toEqual(["@cjm-1.1"]);
  });

  it("clears tag accumulator at a blank line", () => {
    const body = ["  @cjm-1.1", "", "  Scenario: untagged because of blank reset"].join("\n");
    const scs = extractScenarios(body);
    expect(scs[0].tags).toEqual([]);
  });

  it("clears tag accumulator on a non-tag non-scenario non-blank line", () => {
    const body = [
      "  @cjm-1.1",
      "  Background:",
      "  Scenario: untagged because background interrupted",
    ].join("\n");
    const scs = extractScenarios(body);
    expect(scs[0].tags).toEqual([]);
  });
});

describe("lintTagAnchorParity", () => {
  it("flags @cjm-X.Y not anchored in the doc", () => {
    const docAnchors = new Set(["1.1", "1.2"]);
    const features = new Map([
      ["orph.feature", "  @cjm-99.1\n  Scenario: orph\n"],
      ["ok.feature", "  @cjm-1.1\n  Scenario: ok\n"],
    ]);
    const offenders = lintTagAnchorParity(features, docAnchors);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/@cjm-99\.1/);
  });

  it("returns empty when every tag has an anchor", () => {
    const docAnchors = new Set(["1.1"]);
    const features = new Map([["a.feature", "  @cjm-1.1\n  Scenario: a\n"]]);
    expect(lintTagAnchorParity(features, docAnchors)).toEqual([]);
  });
});

describe("lintNegativeTwinPresent", () => {
  it("flags a feature that has a happy scenario but no negative twin", () => {
    const features = new Map([
      ["happy-only.feature", "Feature: F\n\n  @cjm-1.1\n  Scenario: happy path\n    Given x\n"],
    ]);
    const offenders = lintNegativeTwinPresent(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/negative twin/i);
  });

  it("passes when at least one negative-keyword scenario exists in the file", () => {
    const features = new Map([
      [
        "both.feature",
        [
          "Feature: F",
          "",
          "  @cjm-1.1",
          "  Scenario: happy path",
          "    Given x",
          "",
          "  @cjm-1.2",
          "  Scenario: malformed input rejected",
          "    Given y",
        ].join("\n"),
      ],
    ]);
    expect(lintNegativeTwinPresent(features)).toEqual([]);
  });

  it("ignores feature files that have no scenarios", () => {
    expect(lintNegativeTwinPresent(new Map([["empty.feature", "Feature: F\n"]]))).toEqual([]);
  });
});

describe("lintExpectedRedHasGate", () => {
  it("flags @expected-red without @after-phase-N or @after-docker-up", () => {
    const features = new Map([["bad.feature", "  @cjm-1.1 @expected-red\n  Scenario: bare red\n"]]);
    const offenders = lintExpectedRedHasGate(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/@expected-red/);
  });

  it("accepts @expected-red @after-phase-19.1", () => {
    const features = new Map([
      ["ok.feature", "  @cjm-1.1 @expected-red @after-phase-19.1\n  Scenario: ok\n"],
    ]);
    expect(lintExpectedRedHasGate(features)).toEqual([]);
  });

  it("accepts @expected-red @after-docker-up", () => {
    const features = new Map([
      ["ok.feature", "  @cjm-1.1 @expected-red @after-docker-up\n  Scenario: ok\n"],
    ]);
    expect(lintExpectedRedHasGate(features)).toEqual([]);
  });
});

describe("collectFeatureFiles", () => {
  it("recursively collects .feature files; ignores other extensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "lgt-collect-"));
    const sub = join(dir, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, "a.feature"), "");
    writeFileSync(join(dir, "b.md"), "");
    writeFileSync(join(sub, "c.feature"), "");
    const out = collectFeatureFiles(dir).sort();
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.endsWith("a.feature"))).toBe(true);
    expect(out.some((p) => p.endsWith("c.feature"))).toBe(true);
  });

  it("returns empty when the directory does not exist", () => {
    expect(collectFeatureFiles(join(tmpdir(), "definitely-does-not-exist-lgt"))).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// run() opts-injection tests (no subprocess — covers the orchestrator).
// ──────────────────────────────────────────────────────────────────

describe("run (in-process)", () => {
  it("exits 0 on a clean fixture repo", async () => {
    const { dir, doc, featDir } = makeRepo();
    writeFeature(
      featDir,
      "ok.feature",
      [
        "Feature: F",
        "",
        "  @cjm-1.1",
        "  Scenario: happy",
        "    Given x",
        "",
        "  @cjm-1.2",
        "  Scenario: malformed input rejected",
        "    Given y",
      ].join("\n"),
    );
    let out = "";
    let err = "";
    const code = await run({
      argv: ["--doc", "docs/customer-journeys.md", "--features", "tests/e2e-cjm/features"],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toMatch(/passed/i);
  });

  it("exits 2 when the doc is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lgt-nodoc-"));
    let err = "";
    const code = await run({
      argv: ["--doc", "no-such.md", "--features", "tests/e2e-cjm/features"],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(2);
    expect(err).toMatch(/internal error/i);
  });

  it("exits 1 with all offenders aggregated", async () => {
    const { dir, doc, featDir } = makeRepo();
    writeFeature(
      featDir,
      "bad.feature",
      [
        "Feature: F",
        "",
        "  @skip",
        "  Scenario: skipped",
        "    Given x",
        "",
        "  @cjm-99.1 @expected-red",
        "  Scenario: orphan red",
        "    Given y",
      ].join("\n"),
    );
    let err = "";
    const code = await run({
      argv: [],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/@skip/);
    expect(err).toMatch(/orphan|@cjm-99\.1/);
    expect(err).toMatch(/@expected-red/);
  });
});

// ──────────────────────────────────────────────────────────────────
// CLI subprocess tests (real argv parsing + exit code).
// ──────────────────────────────────────────────────────────────────

describe("lint-gherkin-tags (CLI)", () => {
  it("exits 0 against the in-repo tree (sanity)", () => {
    const r = runLint([]);
    expect(r.code).toBe(0);
  });

  it("exits 1 on a .skip fixture in an isolated dir", () => {
    const { dir, doc, featDir } = makeRepo();
    writeFeature(featDir, "skip.feature", "Feature: F\n\n  @skip\n  Scenario: x\n    Given y\n");
    const r = (() => {
      try {
        const stdout = execFileSync(
          "pnpm",
          ["exec", "tsx", SCRIPT, "--doc", doc, "--features", featDir],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return { code: 0, stdout, stderr: "" };
      } catch (e: unknown) {
        const x = e as { status: number | null; stderr?: Buffer };
        return { code: x.status ?? 1, stdout: "", stderr: x.stderr?.toString() ?? "" };
      }
    })();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/@skip/i);
  });
});
