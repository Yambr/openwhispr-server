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
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  computeNetAdditions,
  defaultCliIo,
  defaultReadAtHead,
  defaultReadAtRef,
  isApproved,
  parseAllowlist,
  resolveBaseRef,
  run,
  runCli,
  type CliIo,
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

describe("resolveBaseRef", () => {
  it("prefers BASE_REF env override", () => {
    expect(resolveBaseRef({ BASE_REF: "origin/feature-x" })).toBe("origin/feature-x");
  });

  it("falls back to GITHUB_BASE_REF (prefixed with origin/) when BASE_REF absent", () => {
    expect(resolveBaseRef({ GITHUB_BASE_REF: "main" })).toBe("origin/main");
  });

  it("defaults to HEAD~1 when neither env var is set", () => {
    expect(resolveBaseRef({})).toBe("HEAD~1");
  });

  it("defaults to HEAD~1 when env vars are empty strings", () => {
    expect(resolveBaseRef({ BASE_REF: "", GITHUB_BASE_REF: "" })).toBe("HEAD~1");
  });
});

describe("defaultReadAtHead", () => {
  it("returns file contents when the path exists", () => {
    const root = mkdtempSync(join(tmpdir(), "alw-head-"));
    writeFileSync(join(root, "f.txt"), "hello\n");
    expect(defaultReadAtHead(root)("f.txt")).toBe("hello\n");
  });

  it("returns empty string when the path is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "alw-head-absent-"));
    expect(defaultReadAtHead(root)("missing.txt")).toBe("");
  });
});

describe("defaultReadAtRef", () => {
  it("returns the file contents at a real git ref", () => {
    // Build a tiny throwaway git repo with one commit so we exercise the
    // happy path of `git show <ref>:<path>`.
    const root = mkdtempSync(join(tmpdir(), "alw-ref-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "x@x.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "x"], { cwd: root });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
    writeFileSync(join(root, "f.txt"), "v1\n");
    execFileSync("git", ["add", "f.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "v1"], { cwd: root });
    expect(defaultReadAtRef(root)("HEAD", "f.txt")).toBe("v1\n");
  });

  it("returns empty string when the path is absent at the ref", () => {
    const root = mkdtempSync(join(tmpdir(), "alw-ref-absent-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "x@x.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "x"], { cwd: root });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
    writeFileSync(join(root, "other.txt"), "x\n");
    execFileSync("git", ["add", "other.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: root });
    expect(defaultReadAtRef(root)("HEAD", "missing.txt")).toBe("");
  });
});

describe("defaultCliIo", () => {
  it("returns a CliIo bundle (smoke — internals exercised via CLI entry)", () => {
    // The wiring is `c8 ignore`'d in the source because patching
    // process.exit + process.stderr.write inside a vitest worker
    // de-stabilises the worker pool (vitest@4 fork-pool emits an
    // "unexpected exit" event). The shape is asserted here; behaviour
    // is exercised by the live CLI under `tests/e2e/lockers.test.ts`.
    const io = defaultCliIo();
    expect(typeof io.writeStderr).toBe("function");
    expect(typeof io.exit).toBe("function");
  });
});

describe("runCli", () => {
  /** Build a string-collecting Io for assertion. */
  function collector(): {
    io: CliIo;
    out: { stderr: string; exitCode: number | null };
  } {
    const out = { stderr: "", exitCode: null as number | null };
    const io: CliIo = {
      writeStderr: (m: string) => {
        out.stderr += m;
      },
      // throw to short-circuit the `never`-typed exit so the test can capture
      // both the exit code AND the just-written stderr without process death.
      exit: (code: number) => {
        out.exitCode = code;
        throw new Error("__cli_exit__");
      },
    };
    return { io, out };
  }

  it("exit 0 with clean summary when no net additions", () => {
    const { io, out } = collector();
    expect(() =>
      runCli({
        files: ["a.txt", "b.txt"],
        baseRef: "HEAD~1",
        readAtRef: (_r, p) => (p === "a.txt" ? "x:1\n" : "y:1\n"),
        readAtHead: (p) => (p === "a.txt" ? "x:1\n" : "y:1\n"),
        env: {},
        io,
      }),
    ).toThrow("__cli_exit__");
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toMatch(/clean \(no net additions\)/);
  });

  it("exit 0 with approval summary when net additions are trailer-approved", () => {
    const { io, out } = collector();
    expect(() =>
      runCli({
        files: ["a.txt"],
        baseRef: "HEAD~1",
        readAtRef: () => "x:1\n",
        readAtHead: () => "x:1\nz:9\n",
        env: { COMMIT_MESSAGE: "feat: x\n\nAllowlist-grow-approved: issue-42" },
        io,
      }),
    ).toThrow("__cli_exit__");
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toMatch(/1 net addition\(s\) approved/);
  });

  it("exit 1 with per-file diagnostics when net additions lack approval", () => {
    const { io, out } = collector();
    expect(() =>
      runCli({
        files: ["a.txt", "b.txt"],
        baseRef: "HEAD~1",
        readAtRef: (_r, p) => (p === "a.txt" ? "x:1\n" : ""),
        readAtHead: (p) => (p === "a.txt" ? "x:1\nq:2\n" : "n:1\n"),
        env: {},
        io,
      }),
    ).toThrow("__cli_exit__");
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toMatch(/REFUSED/);
    expect(out.stderr).toMatch(/a\.txt: 1 net addition/);
    expect(out.stderr).toMatch(/\+ q:2/);
    expect(out.stderr).toMatch(/b\.txt: 1 net addition/);
    expect(out.stderr).toMatch(/\+ n:1/);
    expect(out.stderr).toMatch(/Allowlist-grow-approved: issue-NNNN/);
  });
});

