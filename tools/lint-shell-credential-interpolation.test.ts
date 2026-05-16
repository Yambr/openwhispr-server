// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 31 / Plan 06 — lint-shell-credential-interpolation.test.ts.
// LOCKER-06: refuses template-literal strings passed to child_process
// `spawn('bash', ['-c', ...])` / `execSync` / `execFileSync` / `exec`
// where the template interpolates identifiers/env reads matching
// /(_URL|_KEY|_PASSWORD|_SECRET|_TOKEN)$/i.
//
// Tests:
//   1. spawn('bash', ['-c', `...${CRED}...`])     → flagged
//   2. execSync(`...${CRED}...`)                  → flagged
//   3. /.../i.exec(value)                         → NOT flagged (regex method)
//   4. spawn('cmd', ['--flag', CRED])             → NOT flagged (argv form)
//   5. --warn-only flag → exit 0 even when findings present
//   6. Allowlist entries (file:line) → not counted as fail-the-build hits
//   7. runMain success path / failure path / internal-error path
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findViolations,
  readAllowlist,
  runMain,
  scanFile,
} from "./lint-shell-credential-interpolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCRIPT = join(REPO_ROOT, "tools", "lint-shell-credential-interpolation.ts");

const FIXTURES = join(__dirname, "lint-shell-credential-interpolation", "fixtures");

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
  tmpRoot = mkdtempSync(join(tmpdir(), "lint-shell-cred-"));
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
// Direct-API: scanFile on each fixture
// ──────────────────────────────────────────────────────────────────────

describe("scanFile — per-fixture detection", () => {
  it("flags spawn('bash', ['-c', `...${DATABASE_URL}...`])", () => {
    const path = join(FIXTURES, "violates-spawn-bash.ts");
    const findings = scanFile(path);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.label).toBe("shell-credential-interpolation");
    expect(findings[0]?.remediation).toMatch(/argv-array/);
  });

  it("flags execSync(`...${API_KEY}...`)", () => {
    const path = join(FIXTURES, "violates-exec-sync.ts");
    const findings = scanFile(path);
    expect(findings.length).toBe(1);
    expect(findings[0]?.label).toBe("shell-credential-interpolation");
  });

  it("does NOT flag regex `.exec(value)` method calls", () => {
    const path = join(FIXTURES, "clean-regex-exec.ts");
    const findings = scanFile(path);
    expect(findings).toEqual([]);
  });

  it("does NOT flag argv-array spawn form (safe pattern)", () => {
    const path = join(FIXTURES, "clean-argv-array.ts");
    const findings = scanFile(path);
    expect(findings).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// scanFile additional shapes
// ──────────────────────────────────────────────────────────────────────

describe("scanFile — additional shapes", () => {
  it("flags execFileSync(`...${SECRET}...`)", () => {
    const file = writeFile(
      "x.ts",
      `import { execFileSync } from "node:child_process";\nconst MY_SECRET = "";\nexecFileSync(\`echo \${MY_SECRET}\`);\n`,
    );
    const findings = scanFile(file);
    expect(findings.length).toBe(1);
  });

  it("flags exec(`...${TOKEN}...`) (child_process bare exec)", () => {
    const file = writeFile(
      "x.ts",
      `import { exec } from "node:child_process";\nconst AUTH_TOKEN = "";\nexec(\`curl -H "X: \${AUTH_TOKEN}"\`);\n`,
    );
    const findings = scanFile(file);
    expect(findings.length).toBe(1);
  });

  it("flags process.env.X_PASSWORD interpolation", () => {
    const file = writeFile(
      "x.ts",
      `import { execSync } from "node:child_process";\nexecSync(\`echo \${process.env.DB_PASSWORD}\`);\n`,
    );
    const findings = scanFile(file);
    expect(findings.length).toBe(1);
  });

  it("flags template literal inside an args: ['-c', ...] array even without inline spawn", () => {
    // Mirrors the audit-archive.ts pattern: buildExportPlan returns
    // { cmd, args: ['-c', `...${dbUrl}...`] } and the spawn happens
    // elsewhere. The shell-cred-interp risk is identical.
    const file = writeFile(
      "x.ts",
      `export function plan() {\n  const dbUrl = process.env.DATABASE_URL ?? "";\n  return { cmd: "bash", args: ["-c", \`pg_dump "\${dbUrl}"\`] };\n}\n`,
    );
    const findings = scanFile(file);
    expect(findings.length).toBe(1);
  });

  it("does NOT flag template literal interpolating a non-credential name", () => {
    const file = writeFile(
      "x.ts",
      `import { execSync } from "node:child_process";\nconst partition = "p1";\nexecSync(\`echo \${partition}\`);\n`,
    );
    const findings = scanFile(file);
    expect(findings).toEqual([]);
  });

  it("does NOT flag plain string (no template-literal interpolation)", () => {
    const file = writeFile(
      "x.ts",
      `import { execSync } from "node:child_process";\nexecSync("echo hello");\n`,
    );
    const findings = scanFile(file);
    expect(findings).toEqual([]);
  });

  it("does NOT flag .exec on a regex variable", () => {
    const file = writeFile(
      "x.ts",
      `const re = /^Bearer\\s+(.+)$/;\nconst MY_TOKEN = "z";\nre.exec(\`\${MY_TOKEN}\`);\n`,
    );
    const findings = scanFile(file);
    expect(findings).toEqual([]);
  });

  it("returns [] gracefully on a non-existent file", () => {
    const findings = scanFile(join(tmpRoot, "does-not-exist.ts"));
    expect(findings).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// findViolations + allowlist
// ──────────────────────────────────────────────────────────────────────

describe("findViolations — allowlist behavior", () => {
  it("returns violations from a synthetic root with offending files", () => {
    writeFile(
      "src/bad.ts",
      `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`echo \${MY_URL}\`);\n`,
    );
    const { violations, allowlisted } = findViolations(tmpRoot);
    expect(violations.length).toBe(1);
    expect(allowlisted.length).toBe(0);
  });

  it("moves allowlisted file:line entries from violations into allowlisted bucket", () => {
    const violatingSrc = `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`echo \${MY_URL}\`);\n`;
    writeFile("src/bad.ts", violatingSrc);
    writeFile(
      "tools/lint-shell-credential-interpolation.allowlist.txt",
      "# header\nsrc/bad.ts:3  # tracking issue\n",
    );
    const { violations, allowlisted } = findViolations(tmpRoot);
    expect(violations.length).toBe(0);
    expect(allowlisted.length).toBe(1);
  });

  it("readAllowlist skips comments and blanks", () => {
    writeFile(
      "tools/lint-shell-credential-interpolation.allowlist.txt",
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
      `import { execSync } from "node:child_process";\nconst X_URL = "";\nexecSync(\`\${X_URL}\`);\n`,
    );
    writeFile("src/good.ts", `import { execSync } from "node:child_process";\nexecSync("echo");\n`);
    const { violations } = findViolations(tmpRoot);
    expect(violations).toEqual([]);
  });

  it("sorts violations by line number within a file (forces comparator branch)", () => {
    writeFile(
      "src/twohits.ts",
      [
        `import { execSync } from "node:child_process";`,
        `const FIRST_URL = "";`,
        `const SECOND_URL = "";`,
        `execSync(\`\${SECOND_URL}\`);`,
        `execSync(\`\${FIRST_URL}\`);`,
        "",
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
    writeFile("src/ok.ts", `import { execSync } from "node:child_process";\nexecSync("echo");\n`);
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
      `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`\${MY_URL}\`);\n`,
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
    expect(err).toMatch(/shell-credential-interpolation/);
    expect(err).toMatch(/src\/bad\.ts/);
  });

  it("returns 0 with --warn-only even when violations exist", () => {
    writeFile(
      "src/bad.ts",
      `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`\${MY_URL}\`);\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: ["--warn-only", tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    const err = stderrBuf.join("");
    expect(err).toMatch(/WARN/);
  });

  it("reports allowlisted-only findings as WARN (non-failing)", () => {
    const src = `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`\${MY_URL}\`);\n`;
    writeFile("src/bad.ts", src);
    writeFile("tools/lint-shell-credential-interpolation.allowlist.txt", "src/bad.ts:3\n");
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    // Either stdout (clean summary) or stderr (allowlist WARN block) names
    // the allowlisted file — the linter announces visible debt.
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
// CLI subprocess smoke (proves shebang + script entry boots)
// ──────────────────────────────────────────────────────────────────────

describe("CLI subprocess", () => {
  it("exits 0 on a clean tree", () => {
    writeFile(
      "src/ok.ts",
      `import { execSync } from "node:child_process";\nexecSync("echo hi");\n`,
    );
    const r = runCli([], tmpRoot);
    expect(r.code).toBe(0);
  });

  it("exits 1 on a dirty tree", () => {
    writeFile(
      "src/bad.ts",
      `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`\${MY_URL}\`);\n`,
    );
    const r = runCli([], tmpRoot);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/shell-credential-interpolation/);
  });

  it("exits 0 with --warn-only on a dirty tree", () => {
    writeFile(
      "src/bad.ts",
      `import { execSync } from "node:child_process";\nconst MY_URL = "";\nexecSync(\`\${MY_URL}\`);\n`,
    );
    const r = runCli(["--warn-only"], tmpRoot);
    expect(r.code).toBe(0);
  });
});
