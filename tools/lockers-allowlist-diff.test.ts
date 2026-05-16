// SPDX-License-Identifier: FSL-1.1-ALv2
//
// tools/lockers-allowlist-diff.test.ts — Phase 31 / Plan 31-07 (LOCKER-09).
//
// Unit suite for `lockers-allowlist-diff.ts`. The tool computes net allowlist
// additions across the 6 locker allowlist files between a git base ref and
// the HEAD working-tree contents; CI refuses net additions unless the
// commit body or PR body carries `Allowlist-grow-approved: issue-NNNN`.
//
// We test the pure compute fns (no git): `computeNetAdditions(base, head)`
// + `isApproved(commitMessage, prBody)`. The CLI runner is exercised via a
// thin `run({ baseAllowlists, headAllowlists, commitMessage, prBody })`
// dependency-injection seam so the test suite avoids spawning git.
import { describe, expect, it } from "vitest";
import {
  computeNetAdditions,
  isApproved,
  parseAllowlist,
  run,
} from "./lockers-allowlist-diff.ts";

describe("parseAllowlist", () => {
  it("ignores blank lines, #-prefixed comments, and inline `# rationale`", () => {
    const text = [
      "# header comment",
      "",
      "apps/api/src/a.ts:10  # issue-1234",
      "apps/api/src/b.ts:20",
      "  # indented comment",
      "",
    ].join("\n");
    expect(parseAllowlist(text)).toEqual([
      "apps/api/src/a.ts:10",
      "apps/api/src/b.ts:20",
    ]);
  });

  it("returns an empty array on empty / whitespace-only input", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist("   \n\n  ")).toEqual([]);
  });
});

describe("computeNetAdditions", () => {
  it("returns an empty array when head ⊆ base (clean diff)", () => {
    const base = "a:1\nb:2\nc:3\n";
    const head = "a:1\nb:2\n";
    expect(computeNetAdditions(base, head)).toEqual([]);
  });

  it("returns only the new entries when head ⊋ base (net addition)", () => {
    const base = "a:1\n";
    const head = "a:1\nb:2\nc:3\n";
    expect(computeNetAdditions(base, head)).toEqual(["b:2", "c:3"]);
  });

  it("returns an empty array when head is a pure removal of base (removal-only is allowed)", () => {
    const base = "a:1\nb:2\nc:3\n";
    const head = "a:1\n";
    expect(computeNetAdditions(base, head)).toEqual([]);
  });

  it("treats reordering without addition as no-net-change", () => {
    const base = "a:1\nb:2\n";
    const head = "b:2\na:1\n";
    expect(computeNetAdditions(base, head)).toEqual([]);
  });
});

describe("isApproved", () => {
  it("accepts `Allowlist-grow-approved: issue-1234` in commit body", () => {
    expect(
      isApproved("feat(x): something\n\nAllowlist-grow-approved: issue-1234", ""),
    ).toBe(true);
  });

  it("accepts the trailer in PR body when commit body lacks it", () => {
    expect(isApproved("plain commit", "PR description\nAllowlist-grow-approved: issue-9999\n")).toBe(true);
  });

  it("rejects when neither carries the trailer", () => {
    expect(isApproved("plain commit", "plain PR")).toBe(false);
  });

  it("rejects malformed trailer (missing issue-NNNN token)", () => {
    expect(isApproved("Allowlist-grow-approved: yolo", "")).toBe(false);
  });
});

describe("run (DI seam — no git)", () => {
  it("exit 0 on clean diff", () => {
    const result = run({
      baseAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      headAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      commitMessage: "feat: x",
      prBody: "",
    });
    expect(result.code).toBe(0);
    expect(result.netAdditions).toEqual({});
  });

  it("exit 1 on net addition WITHOUT approval trailer", () => {
    const result = run({
      baseAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      headAllowlists: { "lint-x.allowlist.txt": "a:1\nb:2\n" },
      commitMessage: "feat: x",
      prBody: "",
    });
    expect(result.code).toBe(1);
    expect(result.netAdditions["lint-x.allowlist.txt"]).toEqual(["b:2"]);
  });

  it("exit 0 on net addition WITH `Allowlist-grow-approved: issue-1234`", () => {
    const result = run({
      baseAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      headAllowlists: { "lint-x.allowlist.txt": "a:1\nb:2\n" },
      commitMessage: "feat: x\n\nAllowlist-grow-approved: issue-1234",
      prBody: "",
    });
    expect(result.code).toBe(0);
    expect(result.netAdditions["lint-x.allowlist.txt"]).toEqual(["b:2"]);
  });

  it("exit 0 on pure removal", () => {
    const result = run({
      baseAllowlists: { "lint-x.allowlist.txt": "a:1\nb:2\n" },
      headAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      commitMessage: "feat: x",
      prBody: "",
    });
    expect(result.code).toBe(0);
  });

  it("treats a brand-new allowlist file (absent at base) as full-list net addition", () => {
    const result = run({
      baseAllowlists: {},
      headAllowlists: { "lint-x.allowlist.txt": "a:1\nb:2\n" },
      commitMessage: "feat: x",
      prBody: "",
    });
    expect(result.code).toBe(1);
    expect(result.netAdditions["lint-x.allowlist.txt"]).toEqual(["a:1", "b:2"]);
  });

  it("treats a deleted-at-head allowlist as removal-only (exit 0)", () => {
    const result = run({
      baseAllowlists: { "lint-x.allowlist.txt": "a:1\n" },
      headAllowlists: {},
      commitMessage: "feat: x",
      prBody: "",
    });
    expect(result.code).toBe(0);
  });
});
