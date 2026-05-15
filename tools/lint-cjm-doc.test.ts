// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-02 — execFileSync-driven + in-process
// unit tests for tools/lint-cjm-doc.ts. Pattern lifted from
// tools/lint-weak-assertions.test.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectFeatureFiles,
  extractAnchors,
  extractFeatureTags,
  lintCjmDoc,
  lintExpectedRedPairing,
  lintFeatureCrossRef,
  run,
} from "./lint-cjm-doc";

const SCRIPT = join(process.cwd(), "tools", "lint-cjm-doc.ts");

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
    const e = err as {
      status: number | null;
      stderr?: Buffer;
      stdout?: Buffer;
    };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
      stdout: e.stdout?.toString() ?? "",
    };
  }
}

function writeCjmDoc(dir: string, body: string): string {
  const path = join(dir, "customer-journeys.md");
  writeFileSync(path, body);
  return path;
}

function writeFeature(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

// --------- CLI subprocess tests (exit codes / stderr formatting) ----------

describe("lint-cjm-doc (CLI)", () => {
  it("exits 0 against the canonical in-repo docs/customer-journeys.md", () => {
    const r = runLint([]);
    expect(r.code).toBe(0);
  });

  it("exits 0 with --features against the in-repo features directory", () => {
    const r = runLint(["--features", "tests/e2e-cjm/features"]);
    expect(r.code).toBe(0);
  });

  it("exits 1 on a happy-only CJM doc fixture (no negative twin in a section)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-bad-"));
    const path = writeCjmDoc(
      dir,
      "# Customer Journeys\n\n## 1. Foo\n\n### @cjm-1.1 Happy only\n\nBody.\n",
    );
    const r = runLint([path]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/CJM lint violation/);
  });

  it("exits 1 on an orphan @cjm-N.M tag in a .feature file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-orphan-"));
    const doc = writeCjmDoc(
      dir,
      "# Customer Journeys\n\n## 1. Foo\n\n### @cjm-1.1 Happy\n\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(
      featDir,
      "orphan.feature",
      "Feature: Orphan\n\n  @cjm-99.1\n  Scenario: Not in doc\n    Given x\n",
    );
    const r = runLint([doc, "--features", featDir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/orphan|@cjm-99\.1/);
  });

  it("exits 1 on @expected-red without @after-phase-N with --check-expected-red", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-er-"));
    const doc = writeCjmDoc(
      dir,
      "# Customer Journeys\n\n## 1. Foo\n\n### @cjm-1.1 Happy\n\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(
      featDir,
      "er.feature",
      "Feature: Er\n\n  @cjm-1.1 @expected-red\n  Scenario: missing phase tag\n    Given x\n",
    );
    const r = runLint([doc, "--features", featDir, "--check-expected-red"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/expected-red/i);
  });

  it("exits 0 with --check-expected-red when every @expected-red has @after-phase-N", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-er-ok-"));
    const doc = writeCjmDoc(
      dir,
      "# Customer Journeys\n\n## 1. Foo\n\n### @cjm-1.1 Happy\n\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(
      featDir,
      "er.feature",
      "Feature: Er\n\n  @cjm-1.1 @expected-red @after-phase-12\n  Scenario: paired\n    Given x\n",
    );
    const r = runLint([doc, "--features", featDir, "--check-expected-red"]);
    expect(r.code).toBe(0);
  });

  it("exits 2 on a missing CJM doc", () => {
    const r = runLint([join(tmpdir(), `lcd-missing-${Date.now()}-${Math.random()}.md`)]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/internal error|not found|ENOENT/i);
  });
});

// --------- In-process API tests (coverage; v8 can't see subprocesses) ----

describe("lint-cjm-doc (in-process)", () => {
  it("extractAnchors picks up every `### @cjm-N.M` heading", () => {
    const doc = [
      "# X",
      "## 1. Foo",
      "### @cjm-1.1 Happy",
      "### @cjm-1.2 Negative twin error",
      "## 2. Bar",
      "### @cjm-2.1 Happy",
      "### @cjm-2.2 Invalid token (negative twin)",
    ].join("\n");
    const anchors = extractAnchors(doc);
    expect(anchors).toHaveLength(4);
    expect(anchors.map((a) => `${a.major}.${a.minor}`)).toEqual(["1.1", "1.2", "2.1", "2.2"]);
    expect(anchors[1].title).toMatch(/negative twin/i);
  });

  it("lintCjmDoc returns 0 offenders for a valid doc (every section has happy + negative)", () => {
    const doc = [
      "## 1. Foo",
      "### @cjm-1.1 Happy",
      "### @cjm-1.2 Negative twin error",
      "## 2. Bar",
      "### @cjm-2.1 Happy",
      "### @cjm-2.2 Rejected on bad token",
    ].join("\n");
    const offenders = lintCjmDoc(doc);
    expect(offenders).toHaveLength(0);
  });

  it("lintCjmDoc flags a section with only one anchor", () => {
    const doc = ["## 1. Foo", "### @cjm-1.1 Happy only"].join("\n");
    const offenders = lintCjmDoc(doc);
    expect(offenders.length).toBeGreaterThanOrEqual(1);
    expect(offenders[0].message).toMatch(/section 1/i);
  });

  it("lintCjmDoc flags a section with two happy anchors (no negative-twin keyword)", () => {
    const doc = ["## 1. Foo", "### @cjm-1.1 Happy first", "### @cjm-1.2 Happy second"].join("\n");
    const offenders = lintCjmDoc(doc);
    expect(offenders.length).toBeGreaterThanOrEqual(1);
    expect(offenders[0].message).toMatch(/negative.twin/i);
  });

  it("extractFeatureTags pulls every @cjm-N.M from a feature file", () => {
    const feature = [
      "Feature: X",
      "",
      "  @cjm-1.1",
      "  Scenario: A",
      "    Given x",
      "",
      "  @cjm-1.2 @expected-red @after-phase-12",
      "  Scenario: B",
      "    Given y",
    ].join("\n");
    const tags = extractFeatureTags(feature);
    expect(tags.cjm).toEqual([
      { major: 1, minor: 1, line: 3 },
      { major: 1, minor: 2, line: 7 },
    ]);
    expect(tags.expectedRed).toHaveLength(1);
    expect(tags.expectedRed[0].afterPhase).toBe(12);
  });

  it("lintFeatureCrossRef flags an orphan tag", () => {
    const doc = "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n";
    const features = new Map<string, string>([["orphan.feature", "  @cjm-99.1\n  Scenario: X\n"]]);
    const offenders = lintFeatureCrossRef(doc, features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].file).toBe("orphan.feature");
    expect(offenders[0].message).toMatch(/@cjm-99\.1/);
  });

  it("lintFeatureCrossRef returns 0 offenders for matching tags", () => {
    const doc = "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n";
    const features = new Map<string, string>([
      ["ok.feature", "  @cjm-1.1\n  Scenario: X\n  @cjm-1.2\n  Scenario: Y\n"],
    ]);
    const offenders = lintFeatureCrossRef(doc, features);
    expect(offenders).toHaveLength(0);
  });

  it("lintExpectedRedPairing flags @expected-red without @after-phase-N", () => {
    const features = new Map<string, string>([
      ["bad.feature", "  @cjm-1.1 @expected-red\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/after-phase/);
  });

  it("lintExpectedRedPairing returns 0 offenders when paired", () => {
    const features = new Map<string, string>([
      ["ok.feature", "  @cjm-1.1 @expected-red @after-phase-15\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(0);
  });

  // Phase 18.1 / Plan 05 — sub-phase tag form `@after-phase-N.M` admitted
  // alongside back-compat `@after-phase-N`. Malformed shapes still rejected.
  it("lintExpectedRedPairing accepts sub-phase tag form @after-phase-19.1 (D-29)", () => {
    const features = new Map<string, string>([
      ["ok-sub.feature", "  @cjm-3.1 @expected-red @after-phase-19.1\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(0);
  });

  it("lintExpectedRedPairing accepts back-compat @after-phase-N form", () => {
    const features = new Map<string, string>([
      ["ok-bc.feature", "  @cjm-1.1 @expected-red @after-phase-19\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(0);
  });

  it("lintExpectedRedPairing rejects malformed @after-phase-19a (suffix)", () => {
    const features = new Map<string, string>([
      ["bad-suffix.feature", "  @cjm-1.1 @expected-red @after-phase-19a\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/after-phase/);
  });

  it("lintExpectedRedPairing rejects malformed @after-phase- (no digits)", () => {
    const features = new Map<string, string>([
      ["bad-empty.feature", "  @cjm-1.1 @expected-red @after-phase-\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/after-phase/);
  });

  it("lintExpectedRedPairing rejects malformed @after-phase-19. (trailing dot)", () => {
    const features = new Map<string, string>([
      ["bad-trail.feature", "  @cjm-1.1 @expected-red @after-phase-19.\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/after-phase/);
  });

  it("extractFeatureTags parses sub-phase tag and records major component in afterPhase", () => {
    const feature = "  @cjm-3.1 @expected-red @after-phase-19.1\n  Scenario: X\n";
    const tags = extractFeatureTags(feature);
    expect(tags.expectedRed).toHaveLength(1);
    expect(tags.expectedRed[0].afterPhase).toBe(19);
    expect(tags.expectedRed[0].raw).toMatch(/@after-phase-19\.1/);
  });

  // Phase 19a / SR-19a.3 — @after-docker-up is a valid pairing for @expected-red
  // when the scenario is gated on the full compose stack being up rather than
  // a specific code phase landing. Six pre-existing offenders in Phase 17 TLS,
  // traefik-host-split, and locale-switch features carry this token.
  it("lintExpectedRedPairing accepts @after-docker-up as valid pairing", () => {
    const features = new Map<string, string>([
      ["ok-docker.feature", "  @cjm-tls-x @expected-red @after-docker-up\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(0);
  });

  it("extractFeatureTags records dockerUp=true when @after-docker-up present", () => {
    const feature = "  @cjm-tls-x @expected-red @after-docker-up\n  Scenario: X\n";
    const tags = extractFeatureTags(feature);
    expect(tags.expectedRed).toHaveLength(1);
    expect(tags.expectedRed[0].afterPhase).toBeNull();
    expect(tags.expectedRed[0].dockerUp).toBe(true);
    expect(tags.expectedRed[0].raw).toMatch(/@after-docker-up/);
  });

  it("lintExpectedRedPairing still rejects @expected-red with no pairing at all", () => {
    const features = new Map<string, string>([
      ["bad-bare.feature", "  @cjm-1.1 @expected-red\n  Scenario: X\n"],
    ]);
    const offenders = lintExpectedRedPairing(features);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/after-phase|after-docker-up/);
  });

  it("collectFeatureFiles returns [] for non-existent dir", () => {
    const dir = join(tmpdir(), `lcd-missing-${Date.now()}-${Math.random()}`);
    expect(collectFeatureFiles(dir)).toEqual([]);
  });

  it("collectFeatureFiles recurses into nested subdirs", () => {
    const root = mkdtempSync(join(tmpdir(), "lcd-recurse-"));
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "deep.feature"), "Feature: deep\n");
    writeFileSync(join(root, "top.feature"), "Feature: top\n");
    writeFileSync(join(root, "ignore.txt"), "not a feature\n");
    const files = collectFeatureFiles(root);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("deep.feature"))).toBe(true);
    expect(files.some((f) => f.endsWith("top.feature"))).toBe(true);
  });

  it("parseArgs accepts --features without --check-expected-red (mode 2 only)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-mode2-"));
    const doc = writeCjmDoc(
      dir,
      "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(featDir, "ok.feature", "  @cjm-1.1 @expected-red\n  Scenario: X\n");
    // Without --check-expected-red, unpaired @expected-red is NOT flagged.
    const io = {
      out: [] as string[],
      err: [] as string[],
      stdout: (s: string) => io.out.push(s),
      stderr: (s: string) => io.err.push(s),
    };
    const code = await run({
      argv: [doc, "--features", featDir],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
  });

  it("lintCjmDoc flags an H2 section with zero anchors at all", () => {
    const doc = ["## 1. Foo", "(intentionally blank)"].join("\n");
    const offenders = lintCjmDoc(doc);
    expect(offenders.length).toBeGreaterThanOrEqual(1);
    expect(offenders[0].line).toBe(1);
  });

  it("parseArgs tolerates --features as the final argv token (null featuresDir)", async () => {
    // Invoked through run() to also exercise the branch on the next line.
    const io = {
      out: [] as string[],
      err: [] as string[],
      stdout: (s: string) => io.out.push(s),
      stderr: (s: string) => io.err.push(s),
    };
    const dir = mkdtempSync(join(tmpdir(), "lcd-features-noarg-"));
    const doc = writeCjmDoc(
      dir,
      "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n",
    );
    // `--features` with no following arg — featuresDir becomes null
    // BUT the parseArgs loop also advances `i += 1` past the missing slot.
    // Run accepts it as "no features dir" → equivalent to mode 1.
    const code = await run({
      argv: [doc, "--features"],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
  });

  it("lintCjmDoc accepts a section with `(negative twin)` parenthetical in title", () => {
    const doc = [
      "## 1. Foo",
      "### @cjm-1.1 Happy",
      "### @cjm-1.2 Already-registered (negative twin)",
    ].join("\n");
    const offenders = lintCjmDoc(doc);
    expect(offenders).toHaveLength(0);
  });
});

// --------- In-process run() tests for exit-code branches -----------------

describe("lint-cjm-doc run()", () => {
  function captureIo() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    };
  }

  it("returns 0 on a valid doc with no --features flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-run-ok-"));
    const doc = writeCjmDoc(
      dir,
      "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n",
    );
    const io = captureIo();
    const code = await run({
      argv: [doc],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
    expect(io.out.join("")).toMatch(/CJM lint passed/);
  });

  it("returns 1 on a doc-only violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-run-bad-"));
    const doc = writeCjmDoc(dir, "## 1. Foo\n### @cjm-1.1 Happy only\n");
    const io = captureIo();
    const code = await run({
      argv: [doc],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(1);
    expect(io.err.join("")).toMatch(/CJM lint violation/);
  });

  it("returns 2 on a missing CJM doc", async () => {
    const io = captureIo();
    const code = await run({
      argv: [join(tmpdir(), `lcd-run-missing-${Date.now()}-${Math.random()}.md`)],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(2);
    expect(io.err.join("")).toMatch(/internal error/);
  });

  it("returns 1 on cross-ref orphan when --features set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-run-xref-"));
    const doc = writeCjmDoc(
      dir,
      "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(featDir, "x.feature", "  @cjm-99.1\n  Scenario: orphan\n    Given x\n");
    const io = captureIo();
    const code = await run({
      argv: [doc, "--features", featDir],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(1);
    expect(io.err.join("")).toMatch(/@cjm-99\.1/);
  });

  it("returns 0 with --check-expected-red when all pairs present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-run-er-ok-"));
    const doc = writeCjmDoc(
      dir,
      "## 1. Foo\n### @cjm-1.1 Happy\n### @cjm-1.2 Negative twin error\n",
    );
    const featDir = join(dir, "features");
    writeFeature(
      featDir,
      "ok.feature",
      "  @cjm-1.1 @expected-red @after-phase-12\n  Scenario: paired\n    Given x\n",
    );
    const io = captureIo();
    const code = await run({
      argv: [doc, "--features", featDir, "--check-expected-red"],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
  });
});
