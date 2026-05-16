// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 31 / Plan 05 — lint-secret-shape-in-error.test.ts (LOCKER-05).
// Refuses `class X extends *Error { public/readonly <bodyText|responseBody|
// upstreamPayload|response|body>: string }` UNLESS the constructor truncates
// the field assignment (`.slice|.substring|.substr|truncate(...)`).
//
// Tests:
//   1. leaks-bodyText.ts        → flagged (1 finding)
//   2. leaks-responseBody.ts    → flagged (1 finding)
//   3. truncates-ok.ts          → NOT flagged (constructor calls .slice)
//   4. private-field-ok.ts      → NOT flagged (private modifier exempts)
//   5. non-error-class-ignored.ts → NOT flagged (no `extends *Error`)
//   6. --warn-only flag         → exit 0 even when findings present
//   7. Allowlist entries (file:line) → not counted as fail-the-build hits
//   8. runMain success / failure / internal-error path
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findViolations, readAllowlist, runMain, scanFile } from "./lint-secret-shape-in-error.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCRIPT = join(REPO_ROOT, "tools", "lint-secret-shape-in-error.ts");

const FIXTURES = join(__dirname, "lint-secret-shape-in-error", "fixtures");

interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

function runCli(args: string[], rootDir: string): RunResult {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, ...args, rootDir], {
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

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "lint-secret-shape-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, contents: string): string {
  const full = join(tmpRoot, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
  return full;
}

// ──────────────────────────────────────────────────────────────────────
// Direct-API: scanFile per fixture
// ──────────────────────────────────────────────────────────────────────

describe("scanFile — per-fixture detection", () => {
  it("flags `public readonly bodyText: string` stored un-truncated", () => {
    const path = join(FIXTURES, "leaks-bodyText.ts");
    const findings = scanFile(path);
    expect(findings.length).toBe(1);
    expect(findings[0]?.label).toBe("LOCKER-05-LEAK");
    expect(findings[0]?.field).toBe("bodyText");
  });

  it("flags `public responseBody: string` stored un-truncated", () => {
    const path = join(FIXTURES, "leaks-responseBody.ts");
    const findings = scanFile(path);
    expect(findings.length).toBe(1);
    expect(findings[0]?.field).toBe("responseBody");
  });

  it("does NOT flag a class whose constructor truncates via .slice", () => {
    const path = join(FIXTURES, "truncates-ok.ts");
    const findings = scanFile(path);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a `private readonly bodyText` field (private exempt)", () => {
    const path = join(FIXTURES, "private-field-ok.ts");
    const findings = scanFile(path);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a non-Error DTO class with `bodyText`", () => {
    const path = join(FIXTURES, "non-error-class-ignored.ts");
    const findings = scanFile(path);
    expect(findings).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// scanFile — additional structural shapes
// ──────────────────────────────────────────────────────────────────────

describe("scanFile — additional shapes", () => {
  it("flags all five dangerous field names", () => {
    for (const field of ["bodyText", "responseBody", "upstreamPayload", "response", "body"]) {
      const file = writeFile(
        `${field}.ts`,
        `export class XError extends Error {\n  public ${field}: string;\n  constructor(b: string) {\n    super("");\n    this.${field} = b;\n  }\n}\n`,
      );
      const findings = scanFile(file);
      expect(findings.length).toBe(1);
      expect(findings[0]?.field).toBe(field);
    }
  });

  it("flags an unannotated (default-public) field", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const findings = scanFile(file);
    expect(findings.length).toBe(1);
  });

  it("does NOT flag when constructor calls .substring(...)", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b.substring(0, 200);\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag when constructor calls .substr(...)", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b.substr(0, 200);\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag when constructor calls a truncate(...) helper", () => {
    const file = writeFile(
      "x.ts",
      `declare function truncate(s: string, n: number): string;\nexport class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = truncate(b, 200);\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag a field whose type is not `string`", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: number;\n  constructor(b: number) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag a non-dangerous field name", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public partition: string;\n  constructor(b: string) {\n    super("");\n    this.partition = b;\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("flags `string | undefined` typed bodyText with no ctor truncation", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string | undefined;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    expect(scanFile(file).length).toBe(1);
  });

  it("returns [] gracefully on a non-existent file", () => {
    expect(scanFile(join(tmpRoot, "does-not-exist.ts"))).toEqual([]);
  });

  it("returns [] for a class extending a non-Error parent", () => {
    const file = writeFile(
      "x.ts",
      `class Foo {}\nexport class XError extends Foo {\n  public bodyText: string;\n  constructor(b: string) {\n    super();\n    this.bodyText = b;\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag when class has `implements` clause but no extends Error", () => {
    const file = writeFile(
      "x.ts",
      `interface IFoo {}\nexport class XError implements IFoo {\n  public bodyText: string;\n  constructor(b: string) {\n    this.bodyText = b;\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag when the dangerous field has no explicit type annotation", () => {
    // Field with initializer but no `: string` annotation: the cheap
    // type-node check declines to flag (avoids false positives on inferred
    // non-string types).
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText = "init";\n  constructor() { super(""); }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("does NOT flag a union type `string | number` (only string and string|undefined accepted)", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string | number;\n  constructor(b: string | number) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("flags when class has NO explicit constructor (field can never be truncated)", () => {
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string = "x";\n}\n`,
    );
    // Field is declared with the dangerous name + string type, no ctor to
    // truncate → flagged.
    expect(scanFile(file).length).toBe(1);
  });

  it("does NOT flag when constructor truncates via a non-truncating method (e.g. .toUpperCase)", () => {
    // The locker recognises only slice/substring/substr/truncate; a
    // .toUpperCase() call does not satisfy the truncation rule.
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b.toUpperCase();\n  }\n}\n`,
    );
    expect(scanFile(file).length).toBe(1);
  });

  it("does NOT flag when constructor RHS is a non-call expression (`this.bodyText = b`)", () => {
    // Bare identifier RHS is the canonical leak — covered above. This
    // sub-case asserts the negative on a non-call template literal.
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = \`prefix-\${b}\`;\n  }\n}\n`,
    );
    expect(scanFile(file).length).toBe(1);
  });

  it("does NOT flag a class with a non-dangerous field assigned via .slice(...)", () => {
    // Negative control: ensures the truncation walker only fires on the
    // dangerous-named field, not arbitrary fields that happen to be sliced.
    const file = writeFile(
      "x.ts",
      `export class XError extends Error {\n  public partition: string;\n  constructor(b: string) {\n    super("");\n    this.partition = b.slice(0, 10);\n  }\n}\n`,
    );
    expect(scanFile(file)).toEqual([]);
  });

  it("flags a class extending an aliased `*Error` parent (e.g. BaseError)", () => {
    const file = writeFile(
      "x.ts",
      `class BaseError extends Error {}\nexport class XError extends BaseError {\n  public bodyText: string;\n  constructor(b: string) {\n    super();\n    this.bodyText = b;\n  }\n}\n`,
    );
    // The locker recognises any parent identifier ending in `Error`.
    expect(scanFile(file).length).toBe(1);
  });

  it("real-repo seed: flags packages/litellm-client/src/errors.ts (CR-9)", () => {
    const realFile = join(REPO_ROOT, "packages", "litellm-client", "src", "errors.ts");
    const findings = scanFile(realFile);
    expect(findings.length).toBe(1);
    expect(findings[0]?.field).toBe("bodyText");
  });
});

// ──────────────────────────────────────────────────────────────────────
// findViolations + allowlist
// ──────────────────────────────────────────────────────────────────────

describe("findViolations — allowlist behavior", () => {
  it("returns violations from a synthetic root with offending files", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const { violations, allowlisted } = findViolations(tmpRoot);
    expect(violations.length).toBe(1);
    expect(allowlisted.length).toBe(0);
  });

  it("moves allowlisted file:line entries from violations into allowlisted bucket", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    // bodyText sits on line 2 of the file.
    writeFile(
      "tools/lint-secret-shape-in-error.allowlist.txt",
      "# header\nsrc/bad.ts:2  # tracking issue\n",
    );
    const { violations, allowlisted } = findViolations(tmpRoot);
    expect(violations.length).toBe(0);
    expect(allowlisted.length).toBe(1);
  });

  it("readAllowlist skips comments and blanks", () => {
    writeFile(
      "tools/lint-secret-shape-in-error.allowlist.txt",
      "# comment\n\nfoo.ts:1\nbar.ts:2  # trailing comment\n",
    );
    const set = readAllowlist(tmpRoot);
    expect(set.has("foo.ts:1")).toBe(true);
    expect(set.has("bar.ts:2")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("readAllowlist returns empty set when allowlist file is missing", () => {
    expect(readAllowlist(tmpRoot).size).toBe(0);
  });

  it("ignores node_modules / dist / coverage paths", () => {
    writeFile(
      "node_modules/x/y.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    writeFile("src/good.ts", `export const x = 1;\n`);
    const { violations } = findViolations(tmpRoot);
    expect(violations).toEqual([]);
  });

  it("sorts violations by line number within a file", () => {
    writeFile(
      "src/twohits.ts",
      [
        `export class FirstError extends Error {`,
        `  public bodyText: string;`,
        `  constructor(b: string) { super(""); this.bodyText = b; }`,
        `}`,
        `export class SecondError extends Error {`,
        `  public responseBody: string;`,
        `  constructor(b: string) { super(""); this.responseBody = b; }`,
        `}`,
        ``,
      ].join("\n"),
    );
    const { violations } = findViolations(tmpRoot);
    expect(violations.length).toBe(2);
    expect((violations[0]?.lineNumber ?? 0) < (violations[1]?.lineNumber ?? 0)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// runMain — CLI entry
// ──────────────────────────────────────────────────────────────────────

describe("runMain — CLI entry + --warn-only", () => {
  it("returns 0 when no violations", () => {
    writeFile("src/ok.ts", `export const x = 1;\n`);
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    expect(stdoutBuf.join("")).toMatch(/clean/);
  });

  it("returns 1 + stderr summary when violations exist (no --warn-only)", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(1);
    const err = stderrBuf.join("");
    expect(err).toMatch(/secret-shape-in-error|LOCKER-05/);
    expect(err).toMatch(/src\/bad\.ts/);
  });

  it("returns 0 with --warn-only even when violations exist", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: ["--warn-only", tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    expect(stderrBuf.join("")).toMatch(/WARN/);
  });

  it("reports allowlisted-only findings as WARN (non-failing)", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    writeFile("tools/lint-secret-shape-in-error.allowlist.txt", "src/bad.ts:2\n");
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    const combined = stdoutBuf.join("") + stderrBuf.join("");
    expect(combined).toMatch(/allowlisted|WARN|src\/bad\.ts/);
  });

  it("returns 2 on internal error (root is invalid type)", () => {
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong type
      argv: [42 as any],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(2);
    expect(stderrBuf.join("")).toMatch(/internal error/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// CLI subprocess smoke
// ──────────────────────────────────────────────────────────────────────

describe("CLI subprocess", () => {
  it("exits 0 on a clean tree", () => {
    writeFile("src/ok.ts", `export const x = 1;\n`);
    const r = runCli([], tmpRoot);
    expect(r.code).toBe(0);
  });

  it("exits 1 on a dirty tree", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const r = runCli([], tmpRoot);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/secret-shape-in-error|LOCKER-05/);
  });

  it("exits 0 with --warn-only on a dirty tree", () => {
    writeFile(
      "src/bad.ts",
      `export class XError extends Error {\n  public bodyText: string;\n  constructor(b: string) {\n    super("");\n    this.bodyText = b;\n  }\n}\n`,
    );
    const r = runCli(["--warn-only"], tmpRoot);
    expect(r.code).toBe(0);
  });
});
