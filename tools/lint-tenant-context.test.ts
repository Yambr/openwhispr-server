// Phase 6 / Plan 06-09 — lint-tenant-context.test.ts — D-W4 layer 1.
//
// Flips the Wave 0 RED stub GREEN. Spawns the lint script via execFile
// against a temp-dir fixture tree of synthetic job files, asserting:
//
//   1. EXIT 1 when a job handler file has no wrapper call.
//   2. EXIT 0 when handler is wrapped in withTenantContext(...).
//   3. EXIT 0 when handler is wrapped in withSystemContext(...).
//   4. stderr names the offending file + the missing wrapper.
//   5. Lint walks the jobs glob recursively (subdirectories).
//   6. Ignores *.test.ts files (only scans production handler files).
//
// The lint accepts a LINT_TENANT_CONTEXT_ROOT env override so the test
// can redirect the glob root without mutating the real repo.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mainEntry,
  resolveRoot,
  runLint as runLintApi,
  runMain,
  scanFile,
} from "./lint-tenant-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCRIPT = join(REPO_ROOT, "tools", "lint-tenant-context.ts");

interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

function runLint(root: string): RunResult {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LINT_TENANT_CONTEXT_ROOT: root },
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
  tmpRoot = mkdtempSync(join(tmpdir(), "lint-tenant-ctx-"));
  mkdirSync(join(tmpRoot, "apps/worker/src/jobs"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeJob(filename: string, contents: string): void {
  const full = join(tmpRoot, "apps/worker/src/jobs", filename);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

const UNWRAPPED_JOB = `
import { Worker } from "bullmq";
export default new Worker("bad", async () => {
  // un-wrapped — no withTenantContext / withSystemContext
});
`;

const TENANT_WRAPPED_JOB = `
import { Worker } from "bullmq";
import { withTenantContext } from "../lib/with-tenant-context.js";
import { z } from "zod";
const schema = z.object({ tenant_id: z.string() });
export default new Worker("good", withTenantContext(schema, {} as never, async () => {}));
`;

const SYSTEM_WRAPPED_JOB = `
import { Worker } from "bullmq";
import { withSystemContext } from "../lib/with-system-context.js";
export default new Worker("good-sys", withSystemContext(null, async () => {}));
`;

describe("lint-tenant-context (D-W4 layer 1)", () => {
  it("EXITS 1 when a job handler default-export is NOT wrapped", () => {
    writeJob("bad.ts", UNWRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(1);
  });

  it("EXITS 0 when handler is wrapped in withTenantContext(schema, handler)", () => {
    writeJob("good-tenant.ts", TENANT_WRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/PASSED/);
  });

  it("EXITS 0 when handler is wrapped in withSystemContext(handler)", () => {
    writeJob("good-system.ts", SYSTEM_WRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/PASSED/);
  });

  it("stderr names the offending file and the missing wrapper", () => {
    writeJob("missing-wrapper.ts", UNWRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/missing-wrapper\.ts/);
    expect(r.stderr).toMatch(/withTenantContext/);
    expect(r.stderr).toMatch(/withSystemContext/);
  });

  it("scans apps/worker/src/jobs glob recursively", () => {
    writeJob("nested/deep-good.ts", TENANT_WRAPPED_JOB);
    writeJob("flat-bad.ts", UNWRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/flat-bad\.ts/);
    // 2 files scanned, 1 offender.
    expect(r.stderr).toMatch(/of 2 scanned/);
  });

  it("ignores *.test.ts files (only scans production handler files)", () => {
    writeJob("real-job.ts", TENANT_WRAPPED_JOB);
    // An unwrapped *.test.ts file MUST be skipped (the lint scope is
    // production handler files only).
    writeJob("real-job.test.ts", UNWRAPPED_JOB);
    const r = runLint(tmpRoot);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/1 job file/);
  });

  it("EXITS 2 when no job files are found (layout drift detector)", () => {
    // Tmp root has the jobs directory but no files.
    const r = runLint(tmpRoot);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/no job files found/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Direct-API tests — exercise runLint + scanFile in-process so v8 coverage
// instruments the lint module body. The execFileSync tests above prove
// the subprocess wiring (exit codes, stderr) but coverage of a child
// process does not flow back to the parent run. (Imports for runLint /
// scanFile are at the top of the file.)
// ──────────────────────────────────────────────────────────────────────

describe("lint-tenant-context direct API (coverage)", () => {
  it("runLintApi returns empty errors when all files are wrapped", () => {
    writeJob("good.ts", TENANT_WRAPPED_JOB);
    const r = runLintApi(tmpRoot);
    expect(r.scanned).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("runLintApi reports the file and reason for unwrapped jobs", () => {
    writeJob("bad.ts", UNWRAPPED_JOB);
    const r = runLintApi(tmpRoot);
    expect(r.scanned).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.file).toMatch(/bad\.ts$/);
    expect(r.errors[0]?.reason).toMatch(/withTenantContext/);
  });

  it("runLintApi returns scanned=0 when the jobs directory has no files", () => {
    const r = runLintApi(tmpRoot);
    expect(r.scanned).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("scanFile identifies withTenantContext wrappers", () => {
    const path = join(tmpRoot, "apps/worker/src/jobs/good.ts");
    writeJob("good.ts", TENANT_WRAPPED_JOB);
    const { wrapper } = scanFile(path);
    expect(wrapper).toBe("withTenantContext");
  });

  it("scanFile identifies withSystemContext wrappers", () => {
    const path = join(tmpRoot, "apps/worker/src/jobs/sys.ts");
    writeJob("sys.ts", SYSTEM_WRAPPED_JOB);
    const { wrapper } = scanFile(path);
    expect(wrapper).toBe("withSystemContext");
  });

  it("scanFile returns null on unwrapped files", () => {
    const path = join(tmpRoot, "apps/worker/src/jobs/bare.ts");
    writeJob("bare.ts", UNWRAPPED_JOB);
    const { wrapper } = scanFile(path);
    expect(wrapper).toBeNull();
  });

  it("runMain returns 0 + writes PASSED on a clean tree", () => {
    writeJob("ok.ts", TENANT_WRAPPED_JOB);
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    const code = runMain({
      root: tmpRoot,
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    expect(stdoutBuf.join("")).toMatch(/PASSED/);
    expect(stderrBuf.join("")).toBe("");
  });

  it("runMain returns 1 + writes FAILED listing offender file+line+reason", () => {
    writeJob("bad.ts", UNWRAPPED_JOB);
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    const code = runMain({
      root: tmpRoot,
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(1);
    const err = stderrBuf.join("");
    expect(err).toMatch(/FAILED/);
    expect(err).toMatch(/bad\.ts:1/);
    expect(err).toMatch(/withTenantContext/);
  });

  it("runMain returns 2 + layout-drift message when no files found", () => {
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    const code = runMain({
      root: tmpRoot,
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(2);
    expect(stderrBuf.join("")).toMatch(/no job files found/);
  });

  it("runMain returns 2 when runLint throws (internal error path)", () => {
    // Force runLint to throw by pointing root at a path whose `path.join`
    // result feeds globSync a value it rejects. globSync on a deeply
    // nested but unmounted path simply yields []; to trigger a throw we
    // mock readFileSync by writing an unreadable fixture, OR by spying.
    // Simpler: import runLint and overwrite globSync's behavior is
    // module-internal. We instead exercise the catch via a non-string
    // root (which path.join rejects with a TypeError).
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    const code = runMain({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong type
      root: 42 as any,
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(2);
    expect(stderrBuf.join("")).toMatch(/internal error/);
  });

  it("resolveRoot prefers LINT_TENANT_CONTEXT_ROOT env over cwd", () => {
    process.env.LINT_TENANT_CONTEXT_ROOT = tmpRoot;
    expect(resolveRoot()).toBe(tmpRoot);
    delete process.env.LINT_TENANT_CONTEXT_ROOT;
    expect(resolveRoot()).toBe(process.cwd());
  });

  it("mainEntry delegates to runMain against the resolved root", () => {
    // Stand up a tmpRoot with one wrapped job + point the env at it.
    writeJob("ok.ts", TENANT_WRAPPED_JOB);
    process.env.LINT_TENANT_CONTEXT_ROOT = tmpRoot;
    try {
      // The real process.stdout/stderr swallow the writes; the exit code
      // is what we assert.
      const code = mainEntry();
      expect(code).toBe(0);
    } finally {
      delete process.env.LINT_TENANT_CONTEXT_ROOT;
    }
  });

  it("scanFile traverses nested expressions (wrapper inside a Worker constructor)", () => {
    const nested = `
      import { Worker } from "bullmq";
      import { withTenantContext } from "./lib";
      const w = new Worker("q", withTenantContext({} as never, {} as never, async () => {}));
      export default w;
    `;
    const path = join(tmpRoot, "apps/worker/src/jobs/nested.ts");
    writeJob("nested.ts", nested);
    const { wrapper } = scanFile(path);
    expect(wrapper).toBe("withTenantContext");
  });
});
