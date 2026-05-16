// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 31 / Plan 04 — lint-prod-readiness.test.ts.
// LOCKER-04 (DISCIPLINE Rule 14): every Fastify route declares `schema:` +
// `config: { rateLimit: ... }`, and every exported symbol has ≥ 1 non-test
// importer. WARN-only on initial landing (Phase 31 → flips to BLOCKING in
// the final commit of 31-08).
//
// Covers:
//   1. Route-shape pass — schema absent / rateLimit absent / health-probe
//      allowed / good route clean / app.get(url, opts, handler) shape.
//   2. Dead-export pass — `unusedHelper` flagged, `usedHelper` clean.
//   3. Workspace `@openwhispr/*` import resolution (and the unresolved
//      fallback tagged `LOCKER-04-UNRESOLVED-IMPORT`).
//   4. Allowlist behaviour — file:line entries downgraded to WARN.
//   5. `--warn-only` flag — exit 0 even with findings.
//   6. runMain success path / failure path / internal-error path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findViolations, readAllowlist, runMain, scanRouteFile } from "./lint-prod-readiness.js";

const FIXTURES = join(__dirname, "lint-prod-readiness", "fixtures");

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "lint-prod-readiness-"));
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
// scanRouteFile — direct per-fixture detection
// ──────────────────────────────────────────────────────────────────────

describe("scanRouteFile — route-shape detection", () => {
  it("flags app.route without schema (LOCKER-04-NO-SCHEMA)", () => {
    const findings = scanRouteFile(join(FIXTURES, "route-no-schema.ts"));
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-NO-SCHEMA");
  });

  it("flags app.route without config.rateLimit (LOCKER-04-NO-RATELIMIT)", () => {
    const findings = scanRouteFile(join(FIXTURES, "route-no-ratelimit.ts"));
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-NO-RATELIMIT");
  });

  it("accepts rateLimit:false ONLY for /api/health-class URLs", () => {
    const findings = scanRouteFile(join(FIXTURES, "route-health-ok.ts"));
    expect(findings).toEqual([]);
  });

  it("accepts a fully compliant route", () => {
    const findings = scanRouteFile(join(FIXTURES, "route-good.ts"));
    expect(findings).toEqual([]);
  });

  it("handles app.get(url, opts, handler) shape and flags rateLimit:false on non-health URLs", () => {
    const findings = scanRouteFile(join(FIXTURES, "route-get-shape.ts"));
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-INVALID-RATELIMIT-FALSE");
  });

  it("flags app.get(url, handler) — no options object means no schema/rateLimit", () => {
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.get("/api/z", async () => ({})); };\n`,
    );
    const findings = scanRouteFile(file);
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-NO-CONFIG");
  });

  it("matches fastify.route receiver (plugin-rebound shape)", () => {
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (fastify: FastifyInstance) => { fastify.route({ method: "POST", url: "/api/x", handler: async () => ({}) }); };\n`,
    );
    const findings = scanRouteFile(file);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it("emits LOCKER-04-UNRESOLVED when arg is a non-literal identifier", () => {
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\ndeclare const routeOpts: { method: "POST"; url: string };\nexport const f = (app: FastifyInstance) => { app.route(routeOpts); };\n`,
    );
    const findings = scanRouteFile(file);
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-UNRESOLVED");
  });

  it("returns [] for files with no route calls", () => {
    const file = writeFile("x.ts", `export const VALUE = 42;\n`);
    expect(scanRouteFile(file)).toEqual([]);
  });

  it("returns [] gracefully on a non-existent file", () => {
    expect(scanRouteFile(join(tmpRoot, "missing.ts"))).toEqual([]);
  });

  it("handles url as non-string-literal (template / variable) — no isHealth shortcut", () => {
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\nconst PREFIX = "/api";\nexport const f = (app: FastifyInstance) => { app.route({ method: "POST", url: \`\${PREFIX}/x\`, handler: async () => ({}) }); };\n`,
    );
    const findings = scanRouteFile(file);
    // Non-string URL → schema/rateLimit are checked normally (and missing).
    const labels = findings.map((f) => f.label);
    expect(labels).toContain("LOCKER-04-NO-SCHEMA");
    expect(labels).toContain("LOCKER-04-NO-RATELIMIT");
  });

  it("handles `app.get(url, handler-arrow-fn)` — arg[1] is not an object literal", () => {
    // Same as the no-config case but ensures the !ts.isObjectLiteralExpression
    // branch (arg1 is FunctionExpression, not undefined) is exercised.
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.get("/api/q", function handler() { return {}; }); };\n`,
    );
    const findings = scanRouteFile(file);
    expect(findings.map((f) => f.label)).toContain("LOCKER-04-NO-CONFIG");
  });

  it("handles route(...) with no arguments — silently skipped", () => {
    const file = writeFile(
      "x.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { (app as any).route(); };\n`,
    );
    expect(scanRouteFile(file)).toEqual([]);
  });

  it("ignores method calls on receivers other than app/fastify", () => {
    const file = writeFile(
      "x.ts",
      `const other = { route: (_: unknown) => 0 };\nother.route({});\n`,
    );
    expect(scanRouteFile(file)).toEqual([]);
  });

  it("ignores property-access calls whose receiver is not a plain identifier (e.g. obj.x.route)", () => {
    const file = writeFile(
      "x.ts",
      `declare const wrap: { app: { route: (o: unknown) => void } };\nwrap.app.route({ method: "POST", url: "/api/x", handler: async () => ({}) });\n`,
    );
    // receiver of `.route` is `wrap.app` (PropertyAccessExpression), not an Identifier — should be ignored.
    expect(scanRouteFile(file)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// findViolations — combined route + dead-export over a synthetic tree
// ──────────────────────────────────────────────────────────────────────

describe("findViolations — dead-export pass", () => {
  it("flags an export with zero non-test importers", () => {
    writeFile(
      "packages/lib/src/exporter.ts",
      `export function usedHelper(): number { return 1; }\nexport function unusedHelper(): number { return 2; }\n`,
    );
    writeFile(
      "packages/lib/src/importer.ts",
      `import { usedHelper } from "./exporter.js";\nexport const v = usedHelper();\n`,
    );
    const { violations } = findViolations(tmpRoot);
    const labels = violations.map((v) => v.label);
    expect(labels).toContain("LOCKER-04-DEAD-EXPORT");
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    expect(dead.some((v) => v.binding === "unusedHelper")).toBe(true);
    expect(dead.some((v) => v.binding === "usedHelper")).toBe(false);
  });

  it("does NOT count importers under tests/** as live importers", () => {
    writeFile(
      "packages/lib/src/exporter.ts",
      `export function onlyTestImports(): number { return 7; }\n`,
    );
    writeFile(
      "tests/unit/use.test.ts",
      `import { onlyTestImports } from "../../packages/lib/src/exporter.js";\nonlyTestImports();\n`,
    );
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    expect(dead.some((v) => v.binding === "onlyTestImports")).toBe(true);
  });

  it("resolves workspace @openwhispr/<name> imports to packages/<name>/src/index.ts", () => {
    writeFile("packages/widget/src/index.ts", `export function wired(): number { return 1; }\n`);
    writeFile(
      "apps/api/src/caller.ts",
      `import { wired } from "@openwhispr/widget";\nexport const v = wired();\n`,
    );
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    expect(dead.some((v) => v.binding === "wired")).toBe(false);
  });

  it("tags non-resolvable workspace imports as LOCKER-04-UNRESOLVED-IMPORT", () => {
    writeFile(
      "packages/widget/src/index.ts",
      `export function maybeLive(): number { return 1; }\n`,
    );
    writeFile(
      "apps/api/src/caller.ts",
      `import { maybeLive } from "@openwhispr/somewhere-unmapped";\nexport const v = 1;\n`,
    );
    const { violations } = findViolations(tmpRoot);
    const labels = violations.map((v) => v.label);
    // The dead-export pass should also surface an unresolved-import diagnostic
    // for the caller line so allowlist can downgrade it without manual whitelisting.
    expect(labels).toContain("LOCKER-04-UNRESOLVED-IMPORT");
  });

  it("tracks interface/type/enum/class exports", () => {
    writeFile(
      "packages/lib/src/types.ts",
      [
        `export interface I1 { a: number }`,
        `export type T1 = string;`,
        `export enum E1 { A, B }`,
        `export class C1 { ok = true }`,
        ``,
      ].join("\n"),
    );
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    const names = new Set(dead.map((v) => v.binding));
    expect(names.has("I1")).toBe(true);
    expect(names.has("T1")).toBe(true);
    expect(names.has("E1")).toBe(true);
    expect(names.has("C1")).toBe(true);
  });

  it("counts default-import / namespace-import / side-effect-import as live importers via wildcard", () => {
    writeFile(
      "packages/lib/src/m.ts",
      `export default function foo() { return 1; }\nexport function alsoLive(): number { return 2; }\n`,
    );
    writeFile(
      "packages/lib/src/import-default.ts",
      `import foo from "./m.js";\nexport const v = foo();\n`,
    );
    writeFile(
      "packages/lib/src/import-namespace.ts",
      `import * as M from "./m.js";\nexport const v2 = M;\n`,
    );
    writeFile("packages/lib/src/import-sideeffect.ts", `import "./m.js";\nexport const v3 = 1;\n`);
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter(
      (v) => v.label === "LOCKER-04-DEAD-EXPORT" && v.binding === "alsoLive",
    );
    // alsoLive should be considered live (wildcard via namespace / side-effect import).
    expect(dead.length).toBe(0);
  });

  it("treats export * from './m' as a wildcard live importer of m", () => {
    writeFile("packages/lib/src/inner.ts", `export function wildHelper(): number { return 9; }\n`);
    writeFile("packages/lib/src/index.ts", `export * from "./inner.js";\n`);
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    expect(dead.some((v) => v.binding === "wildHelper" && v.file.includes("inner.ts"))).toBe(false);
  });

  it("ignores bare npm specifiers (not a workspace package) — no UNRESOLVED-IMPORT emitted", () => {
    writeFile("apps/api/src/caller.ts", `import { foo } from "react";\nexport const v = 1;\n`);
    const { violations } = findViolations(tmpRoot);
    expect(violations.some((v) => v.label === "LOCKER-04-UNRESOLVED-IMPORT")).toBe(false);
  });

  it("resolves .tsx index-file candidates for relative imports", () => {
    writeFile(
      "packages/lib/src/widget/index.tsx",
      `export function tsxHelper(): number { return 1; }\n`,
    );
    writeFile(
      "packages/lib/src/main.ts",
      `import { tsxHelper } from "./widget/index.js";\nexport const v = tsxHelper();\n`,
    );
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    expect(dead.some((v) => v.binding === "tsxHelper")).toBe(false);
  });

  it("treats export { X } from './m' re-exports as importers of X", () => {
    writeFile("packages/lib/src/inner.ts", `export function deepHelper(): number { return 3; }\n`);
    writeFile("packages/lib/src/index.ts", `export { deepHelper } from "./inner.js";\n`);
    const { violations } = findViolations(tmpRoot);
    const dead = violations.filter((v) => v.label === "LOCKER-04-DEAD-EXPORT");
    // `deepHelper` is re-exported → counts as imported. `index.ts` exports
    // are still emitted (since nothing imports the index), but `deepHelper`
    // in `inner.ts` is NOT dead.
    expect(dead.some((v) => v.binding === "deepHelper" && v.file.includes("inner.ts"))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Allowlist + --warn-only
// ──────────────────────────────────────────────────────────────────────

describe("allowlist + readAllowlist", () => {
  it("downgrades file:line entries to WARN bucket", () => {
    writeFile(
      "apps/api/src/r.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.route({ method: "POST", url: "/api/x", handler: async () => ({}) }); };\n`,
    );
    const { violations: before } = findViolations(tmpRoot);
    expect(before.length).toBeGreaterThan(0);
    // Allowlist the route's line (line 2 of the file above).
    const firstLine = before[0]?.lineNumber ?? 2;
    writeFile(
      "tools/lint-prod-readiness.allowlist.txt",
      `# seed\napps/api/src/r.ts:${firstLine}  # issue-31-04-debt-LOCKER-04-route-bulkfix-31-08\n`,
    );
    const { violations: after, allowlisted } = findViolations(tmpRoot);
    // The same file:line is now in the allowlisted bucket.
    expect(allowlisted.some((v) => v.file === "apps/api/src/r.ts")).toBe(true);
    expect(after.length).toBeLessThan(before.length);
  });

  it("readAllowlist skips comments and blanks; strips trailing `# rationale`", () => {
    writeFile(
      "tools/lint-prod-readiness.allowlist.txt",
      "# comment\n\nfoo.ts:1\nbar.ts:2  # tracking\n",
    );
    const set = readAllowlist(tmpRoot);
    expect(set.has("foo.ts:1")).toBe(true);
    expect(set.has("bar.ts:2")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("readAllowlist returns empty set when allowlist file missing", () => {
    expect(readAllowlist(tmpRoot).size).toBe(0);
  });
});

describe("runMain — CLI entry + --warn-only", () => {
  it("returns 0 when no violations", () => {
    writeFile("apps/api/src/ok.ts", `export const VALUE = 42;\n`);
    writeFile("apps/api/src/use-ok.ts", `import { VALUE } from "./ok.js";\nconsole.log(VALUE);\n`);
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

  it("returns 1 with stderr summary when violations exist (no --warn-only)", () => {
    writeFile(
      "apps/api/src/bad.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.route({ method: "POST", url: "/api/x", handler: async () => ({}) }); };\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toMatch(/LOCKER-04/);
  });

  it("returns 0 with --warn-only even when violations exist", () => {
    writeFile(
      "apps/api/src/bad.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.route({ method: "POST", url: "/api/x", handler: async () => ({}) }); };\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: ["--warn-only", tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(0);
    expect(stderrBuf.join("")).toMatch(/warn-only/i);
  });

  it("returns 2 on internal error (rootDir does not exist)", () => {
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [join(tmpRoot, "nope-does-not-exist-xyz")],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    expect(code).toBe(2);
    expect(stderrBuf.join("")).toMatch(/internal error/i);
  });

  it("prints WARN summary when only allowlisted findings exist", () => {
    writeFile(
      "apps/api/src/bad.ts",
      `import type { FastifyInstance } from "fastify";\nexport const f = (app: FastifyInstance) => { app.route({ method: "POST", url: "/api/x", handler: async () => ({}) }); };\n`,
    );
    // Cover line 2 of bad.ts (where the route lives).
    writeFile(
      "tools/lint-prod-readiness.allowlist.txt",
      `apps/api/src/bad.ts:2  # issue-31-04-debt-LOCKER-04-route-bulkfix-31-08\n`,
    );
    const stderrBuf: string[] = [];
    const stdoutBuf: string[] = [];
    const code = runMain({
      argv: [tmpRoot],
      stdout: { write: (s) => stdoutBuf.push(s) },
      stderr: { write: (s) => stderrBuf.push(s) },
    });
    // With ALL findings allowlisted we should exit clean.
    expect(code).toBe(0);
    const allOut = stdoutBuf.join("") + stderrBuf.join("");
    expect(allOut).toMatch(/allowlisted|WARN|clean/);
  });
});
