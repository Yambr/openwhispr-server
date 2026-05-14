// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 03 — execFileSync-driven unit tests for
// tools/lint-weak-assertions.ts. Pattern lifted from tools/lint-english.test.ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { run, scanRoot, selfTest, WEAK_ASSERTION } from "./lint-weak-assertions";

const SCRIPT = join(process.cwd(), "tools", "lint-weak-assertions.ts");

function runLint(arg: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, arg], {
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

describe("lint-weak-assertions", () => {
  it("exits 0 on a clean fixture tree", () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-clean-"));
    writeFileSync(
      join(root, "ok.test.ts"),
      "import { expect, it } from 'vitest';\n" +
        "it('renders', async () => {\n" +
        "  expect(await screen.findByText(/x/)).toBeInTheDocument();\n" +
        "});\n",
    );
    const r = runLint(root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("exits 1 on getAllByText(...).length.toBeGreaterThan(0)", () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-gt-"));
    writeFileSync(
      join(root, "bad.test.tsx"),
      "import { expect, it } from 'vitest';\n" +
        "it('counts', () => {\n" +
        "  expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);\n" +
        "});\n",
    );
    const r = runLint(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad\.test\.tsx:3:/);
    expect(r.stderr).toMatch(/Use findByText/);
  });

  it("exits 1 on queryAllByRole(...).length.toBeGreaterThanOrEqual(2)", () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-gte-"));
    writeFileSync(
      join(root, "bad2.test.tsx"),
      "import { expect, it } from 'vitest';\n" +
        "it('counts', () => {\n" +
        "  expect(screen.queryAllByRole('button').length).toBeGreaterThanOrEqual(2);\n" +
        "});\n",
    );
    const r = runLint(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad2\.test\.tsx:3:/);
  });

  it("--self-test exits 0", () => {
    const r = runLint("--self-test");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/self-test: PASS/);
  });

  it("exits 2 on a non-existent root directory", () => {
    const r = runLint(join(tmpdir(), `lwa-missing-${Date.now()}-${Math.random()}`));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/internal error/);
  });

  it("does NOT flag findAllByText with .toBeInTheDocument() (negative control)", () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-neg-"));
    writeFileSync(
      join(root, "ok2.test.ts"),
      "import { expect, it } from 'vitest';\n" +
        "it('renders', async () => {\n" +
        "  const items = await screen.findAllByRole('listitem');\n" +
        "  expect(items).toHaveLength(3);\n" +
        "});\n",
    );
    const r = runLint(root);
    expect(r.code).toBe(0);
  });
});

// In-process tests against the exported API. The execFileSync-driven tests
// above cover the CLI shape (exit codes, stderr format) but vitest's v8
// coverage instrument cannot see subprocess execution. These tests exercise
// the same module in-process so the constitutional ≥90/90/90/90 floor on
// tools/lint-weak-assertions.ts is enforceable.
describe("lint-weak-assertions (in-process)", () => {
  it("WEAK_ASSERTION matches the canonical offender shape", () => {
    expect(WEAK_ASSERTION.test("expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);")).toBe(
      true,
    );
  });

  it("WEAK_ASSERTION matches the OrEqual variant", () => {
    expect(
      WEAK_ASSERTION.test(
        'expect(screen.queryAllByRole("button").length).toBeGreaterThanOrEqual(2);',
      ),
    ).toBe(true);
  });

  it("WEAK_ASSERTION matches findAllBy* + length", () => {
    expect(
      WEAK_ASSERTION.test("expect(screen.findAllByLabelText(/x/).length).toBeGreaterThan(1);"),
    ).toBe(true);
  });

  it("WEAK_ASSERTION does NOT match toBeInTheDocument", () => {
    expect(WEAK_ASSERTION.test("expect(await screen.findByText(/x/)).toBeInTheDocument();")).toBe(
      false,
    );
  });

  it("WEAK_ASSERTION does NOT match toHaveLength", () => {
    expect(WEAK_ASSERTION.test("expect(items).toHaveLength(3);")).toBe(false);
  });

  it("selfTest() returns true", () => {
    expect(selfTest()).toBe(true);
  });

  it("scanRoot returns 0 offenders for a clean tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-inproc-clean-"));
    writeFileSync(join(root, "ok.test.ts"), "expect(items).toHaveLength(3);\n");
    const r = await scanRoot(root);
    expect(r.offenders).toHaveLength(0);
    expect(r.scanned).toBe(1);
  });

  it("scanRoot finds offenders with correct location metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-inproc-bad-"));
    writeFileSync(
      join(root, "bad.test.tsx"),
      "// line1\n" + "// line2\n" + "expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);\n",
    );
    const r = await scanRoot(root);
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0].line).toBe(3);
    expect(r.offenders[0].file).toBe("bad.test.tsx");
    expect(r.offenders[0].col).toBeGreaterThan(0);
    expect(r.offenders[0].preview).toMatch(/getAllByText/);
  });

  it("scanRoot ignores node_modules", async () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-inproc-nm-"));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "bad.test.ts"),
      "expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);\n",
    );
    const r = await scanRoot(root);
    expect(r.offenders).toHaveLength(0);
  });

  it("scanRoot throws on a non-existent root (caller surfaces as exit 2)", async () => {
    await expect(
      scanRoot(join(tmpdir(), `lwa-missing-${Date.now()}-${Math.random()}`)),
    ).rejects.toThrow();
  });
});

describe("lint-weak-assertions run() (in-process CLI)", () => {
  function captureIo(): {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    out: string[];
    err: string[];
  } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    };
  }

  it("--self-test branch returns 0 + writes PASS to stdout", async () => {
    const io = captureIo();
    const code = await run({
      argv: ["--self-test"],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
    expect(io.out.join("")).toMatch(/self-test: PASS/);
  });

  it("clean directory returns 0 + writes summary to stdout", async () => {
    const io = captureIo();
    const root = mkdtempSync(join(tmpdir(), "lwa-run-clean-"));
    writeFileSync(join(root, "ok.test.ts"), "expect(x).toHaveLength(3);\n");
    const code = await run({
      argv: [root],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
    expect(io.out.join("")).toMatch(/check passed/);
  });

  it("dirty directory returns 1 + writes offender lines to stderr", async () => {
    const io = captureIo();
    const root = mkdtempSync(join(tmpdir(), "lwa-run-bad-"));
    writeFileSync(
      join(root, "bad.test.ts"),
      "expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);\n",
    );
    const code = await run({
      argv: [root],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(1);
    const stderr = io.err.join("");
    expect(stderr).toMatch(/Weak-assertion violation: 1 occurrence/);
    expect(stderr).toMatch(/bad\.test\.ts:1:/);
  });

  it("missing directory returns 2 + writes internal error to stderr", async () => {
    const io = captureIo();
    const code = await run({
      argv: [join(tmpdir(), `lwa-run-missing-${Date.now()}-${Math.random()}`)],
      cwd: process.cwd(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(2);
    expect(io.err.join("")).toMatch(/internal error/);
  });

  it("scanRoot continues past unreadable files (chmod 000)", async () => {
    const root = mkdtempSync(join(tmpdir(), "lwa-unreadable-"));
    const badPath = join(root, "unreadable.test.ts");
    writeFileSync(badPath, "expect(x).toHaveLength(1);\n");
    const { chmodSync } = await import("node:fs");
    try {
      chmodSync(badPath, 0o000);
      // Whether the file is readable or not depends on the OS; the goal is to
      // exercise the readFileSync try/catch arm. On macOS root-as-non-root
      // can still read, so we also write a sibling that's fine.
      writeFileSync(join(root, "ok.test.ts"), "expect(x).toHaveLength(1);\n");
      const r = await scanRoot(root);
      // Either both files counted or one — the test passes either way; what
      // matters is the readFileSync catch arm is reachable.
      expect(r.scanned).toBeGreaterThanOrEqual(1);
    } finally {
      try {
        chmodSync(badPath, 0o644);
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it("defaults to cwd when no path argv provided", async () => {
    const io = captureIo();
    const root = mkdtempSync(join(tmpdir(), "lwa-run-cwd-"));
    writeFileSync(join(root, "ok.test.ts"), "expect(x).toHaveLength(1);\n");
    const code = await run({
      argv: [],
      cwd: root,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
  });
});
