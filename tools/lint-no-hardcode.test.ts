// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-hardcode.test.ts — RED→GREEN coverage for the hardcoded-token
 * regression-guard CLI (Phase 31 / Plan 03 — LOCKER-03, DISCIPLINE Rule 13).
 *
 * The guard scans `apps/**\/src/**` + `packages/**\/src/**` *.ts + *.tsx
 * for hardcoded `localhost`, `127.0.0.1`, port literals (`:3000|:4000|:8080`),
 * UUID literals, and fake-token shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`,
 * `Bearer ey…`). Out-of-scope trees (`tests/`, `.env.*.example`, `compose/`,
 * `docs/`, `charts/`, `tools/`) are IGNORE'd. Allowlist downgrades known
 * findings (e.g., the 8 canonical `DEFAULT_TENANT_ID = "00000000-..."`
 * sentinels) to WARN — visible but non-blocking.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOWLIST_FILE, findViolations, main, readAllowlist } from "./lint-no-hardcode.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-no-hardcode-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

// Mirror the three plan fixtures inside tmpdir under apps/api/src/<x>.ts so
// findViolations actually picks them up (the IGNORE glob excludes
// `**/tools/**` so we cannot reference the real fixture files from here).

const VIOLATES = [
  "// fixture",
  'const URL = "http://localhost:3000";',
  'const IP = "127.0.0.1";',
  'const A = "sk-abcdefghijklmnopqrstuvwxyz0123456789";',
  'const B = "AIzaSyTestKeyAaaaaaaaaaaaaaaaaaaaaaaa";',
  'const C = "AKIAIOSFODNN7EXAMPLE";',
  'const D = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturepart_value";',
  'const PORT = "myhost:8080";',
  "",
].join("\n");

const UUID_ZERO = [
  "// fixture",
  'const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";',
  "",
].join("\n");

const CLEAN = [
  "// fixture",
  'const URL = process.env.APP_BASE_URL ?? "";',
  "const TIMEOUT_MS = 5_000;",
  "",
].join("\n");

describe("findViolations — fixture coverage (one finding per FORBIDDEN class)", () => {
  it("F1: violates.ts hits each FORBIDDEN class (>= 7 BLOCKING findings)", async () => {
    touch("apps/api/src/violates.ts", VIOLATES);
    const violations = await findViolations(root);
    const labels = new Set(violations.map((v) => v.label));
    expect(labels.has("localhost-string")).toBe(true);
    expect(labels.has("loopback-ip")).toBe(true);
    expect(labels.has("port-literal")).toBe(true);
    expect(labels.has("secret-shape-openai-anthropic")).toBe(true);
    expect(labels.has("secret-shape-google")).toBe(true);
    expect(labels.has("secret-shape-aws")).toBe(true);
    expect(labels.has("secret-shape-jwt-bearer")).toBe(true);
    // line-2 (`http://localhost:3000`) produces TWO labels — localhost AND port
    const line2 = violations.filter((v) => v.lineNumber === 2);
    expect(line2.length).toBeGreaterThanOrEqual(2);
    // No UUID hit in violates.ts (UUID lives in uuid-zero fixture)
    expect(labels.has("uuid-literal")).toBe(false);
    // All findings are BLOCKING (not allowlisted)
    expect(violations.every((v) => v.severity === "BLOCKING")).toBe(true);
  });

  it("F2: clean.ts → zero findings", async () => {
    touch("apps/api/src/clean.ts", CLEAN);
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F3: uuid-zero.ts → 1 finding, downgraded to WARN via allowlist", async () => {
    touch("apps/api/src/uuid-zero.ts", UUID_ZERO);
    touch(ALLOWLIST_FILE, "apps/api/src/uuid-zero.ts:2  # canonical-default-tenant\n");
    const violations = await findViolations(root);
    expect(violations.length).toBe(1);
    expect(violations[0]?.label).toBe("uuid-literal");
    expect(violations[0]?.severity).toBe("WARN");
  });

  it("F4: uuid-zero.ts → 1 BLOCKING when NOT allowlisted", async () => {
    touch("apps/api/src/uuid-zero.ts", UUID_ZERO);
    const violations = await findViolations(root);
    expect(violations.length).toBe(1);
    expect(violations[0]?.severity).toBe("BLOCKING");
  });

  it("F5: IGNORE skips tests/, compose/, docs/, charts/, tools/, .env.*.example", async () => {
    const dirty = 'const X = "http://localhost:3000";\n';
    touch("apps/api/tests/violates.ts", dirty);
    touch("compose/something.ts", dirty);
    touch("docs/example.ts", dirty);
    touch("charts/whisper/values.ts", dirty);
    touch("tools/scratch.ts", dirty);
    touch("apps/api/.env.local.example", dirty);
    touch("apps/api/src/__tests__/violates.ts", dirty);
    touch("apps/api/src/feature.test.ts", dirty);
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F6: scans packages/**/src/**, not only apps/**/src/**", async () => {
    touch("packages/data/src/seed.ts", VIOLATES);
    const violations = await findViolations(root);
    expect(violations.length).toBeGreaterThanOrEqual(7);
  });

  it("F7: violations sorted by file then lineNumber", async () => {
    touch("apps/api/src/b.ts", 'const X = "http://localhost:3000";\nconst Y = "127.0.0.1";\n');
    touch("apps/api/src/a.ts", 'const Z = "myhost:8080";\n');
    const violations = await findViolations(root);
    expect(violations[0]?.file).toBe("apps/api/src/a.ts");
    expect(violations[1]?.file).toBe("apps/api/src/b.ts");
    expect(violations.every((v) => typeof v.lineNumber === "number")).toBe(true);
  });

  it("F8: .tsx files in apps/web/src are scanned", async () => {
    touch(
      "apps/web/src/app/(auth)/app/page.tsx",
      'const DEFAULT_INTERNAL_API_URL = "http://api:3000";\n',
    );
    const violations = await findViolations(root);
    // Should flag port-literal for ":3000"
    expect(violations.some((v) => v.label === "port-literal")).toBe(true);
  });
});

describe("readAllowlist", () => {
  it("R1: returns empty Set when file missing", () => {
    expect(readAllowlist(root).size).toBe(0);
  });

  it("R2: parses `file:line` entries, strips trailing `# rationale`", () => {
    touch(
      ALLOWLIST_FILE,
      [
        "# header",
        "",
        "apps/api/src/foo.ts:42  # canonical-default-tenant",
        "  apps/api/src/bar.ts:7  ",
        "# trailing comment",
        "",
      ].join("\n"),
    );
    const set = readAllowlist(root);
    expect(set.has("apps/api/src/foo.ts:42")).toBe(true);
    expect(set.has("apps/api/src/bar.ts:7")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("R3: returns fresh Set per call", () => {
    const a = readAllowlist(root);
    const b = readAllowlist(root);
    expect(a).not.toBe(b);
  });
});

describe("main — CLI dispatch + exit codes", () => {
  it("C1: dirty tree → exit 1, stderr summary written", async () => {
    touch("apps/api/src/x.ts", 'const URL = "http://localhost:3000";\n');
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(1);
  });

  it("C2: clean tree → exit 0", async () => {
    touch("apps/api/src/x.ts", CLEAN);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main([root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("C3: WARN-only tree (allowlisted) → exit 0", async () => {
    touch("apps/api/src/uuid-zero.ts", UUID_ZERO);
    touch(ALLOWLIST_FILE, "apps/api/src/uuid-zero.ts:2  # canonical-default-tenant\n");
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([root]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("C4: main([]) defaults rootDir to process.cwd()", async () => {
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    expect([0, 1]).toContain(code);
  });

  it("C5: setup error (allowlist path is a directory) → exit 2", async () => {
    mkdirSync(join(root, ALLOWLIST_FILE), { recursive: true });
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(2);
    expect(errChunks.join("")).toMatch(/lint-no-hardcode:/);
  });
});
