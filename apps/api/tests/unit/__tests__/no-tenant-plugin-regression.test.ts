// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Phase 34 regression guard against tenantPlugin re-introduction.
//
// CR-1 (`.planning/review/api-core.md`) flagged the original tenantPlugin
// as a tenant-isolation hole: a client-controlled `x-tenant-id` header was
// read into `req.tenantId` on every request. Phase 34 deleted the plugin
// (with audit-confirmed zero production readers); this test ensures no
// future commit re-introduces the same shape — file, module-augmentation,
// or `req.tenantId` reader — without first deleting THIS test (which
// would surface in code review).
//
// Complements `tools/lint-prod-readiness` (catches re-exported symbols
// without consumers) and `tools/lint-no-hardcode` (catches re-introduced
// UUID literals). Those lockers do NOT detect "the file exists again with
// a `req.tenantId` writer" — that's this test's job.
//
// Runtime: pure filesystem + string scan. No testcontainers, no Fastify.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
// apps/api/tests/unit/__tests__ -> repo root (../../../../..)
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const PLUGIN_PATH = resolve(REPO_ROOT, "apps", "api", "src", "middleware", "tenant.ts");
const TYPES_DIR = resolve(REPO_ROOT, "apps", "api", "src", "types");
const APPS_SRC_DIRS = [
  resolve(REPO_ROOT, "apps", "api", "src"),
  resolve(REPO_ROOT, "apps", "worker", "src"),
];

/**
 * Walk a directory recursively and yield every `.ts` file path. Skips
 * `node_modules`, `dist`, `coverage`, and any nested `__tests__` /
 * `tests` directory — we only want PRODUCTION source.
 */
function* walkProdTs(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    if (entry === "__tests__" || entry === "tests") continue;
    const p = join(root, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      yield* walkProdTs(p);
    } else if (
      st.isFile() &&
      p.endsWith(".ts") &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".spec.ts") &&
      !p.endsWith(".d.ts.bak")
    ) {
      yield p;
    }
  }
}

describe("Phase 34 — tenantPlugin retirement regression guard (CR-1)", () => {
  it("apps/api/src/middleware/tenant.ts does NOT exist", () => {
    expect(
      existsSync(PLUGIN_PATH),
      `Phase 34 deleted ${PLUGIN_PATH}. If you need a tenant-related Fastify decorator, populate \`req.tenant\` from the authoritative dual-auth session (see apps/api/src/middleware/dual-auth.ts), NOT from a client-controlled header.`,
    ).toBe(false);
  });

  it("apps/api/src/types/** does NOT augment FastifyRequest with a top-level `tenantId` field", () => {
    if (!existsSync(TYPES_DIR)) {
      throw new Error(`types directory missing: ${TYPES_DIR}`);
    }
    const offenders: Array<{ file: string; lineNo: number; line: string }> = [];
    for (const entry of readdirSync(TYPES_DIR)) {
      const p = join(TYPES_DIR, entry);
      if (!statSync(p).isFile()) continue;
      const src = readFileSync(p, "utf8");

      // Find every `interface FastifyRequest` block and scan ONLY the
      // immediate body (top-level properties) for a `tenantId` field.
      // Nested shapes like `user?: { tenantId?: string | null }` are
      // SESSION-derived and NOT the CR-1 hole — only a TOP-LEVEL
      // `req.tenantId` re-introduces the client-header escalation.
      const interfaceRe = /interface\s+FastifyRequest\s*\{/g;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
      while ((m = interfaceRe.exec(src)) !== null) {
        // Walk braces to find the matching close.
        let depth = 1;
        let i = m.index + m[0].length;
        const bodyStart = i;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
        const body = src.slice(bodyStart, i - 1);
        // Top-level property scan: ignore properties inside nested
        // braces (`user?: { tenantId?: ... }`). Track brace depth.
        let nested = 0;
        const bodyLines = body.split("\n");
        // Offset of `bodyStart` in lines for accurate line numbering.
        const lineOffset = src.slice(0, bodyStart).split("\n").length - 1;
        for (let li = 0; li < bodyLines.length; li++) {
          const line = bodyLines[li];
          // Strip line comment.
          const codeOnly = line.replace(/\/\/.*$/, "");
          if (nested === 0 && /^\s*tenantId\??\s*:/.test(codeOnly)) {
            offenders.push({ file: p, lineNo: lineOffset + li + 1, line: line.trim() });
          }
          // Update nested-brace depth from this line's net brace count.
          for (const ch of codeOnly) {
            if (ch === "{") nested++;
            else if (ch === "}") nested--;
          }
        }
      }
    }
    expect(
      offenders,
      `Re-introducing \`tenantId\` on FastifyRequest re-opens CR-1 (client-controlled header → tenant escalation). Use \`req.tenant\` (set by dualAuthHook). Offenders:\n${offenders
        .map((o) => `  ${o.file}:${o.lineNo}  ${o.line}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("no production source file under apps/**/src reads `req.tenantId` / `request.tenantId` (executable code only)", () => {
    const re = /\b(?:req|request)\.tenantId\b/;
    const offenders: Array<{ file: string; lineNo: number; line: string }> = [];
    for (const root of APPS_SRC_DIRS) {
      for (const file of walkProdTs(root)) {
        // Skip the regression test's own location safety net — the
        // walker already excludes __tests__, but be defensive in case
        // a future contributor moves this file.
        if (file.endsWith("no-tenant-plugin-regression.test.ts")) continue;
        const src = readFileSync(file, "utf8");
        // Strip `/* … */` block comments AND `// …` line comments before
        // scanning. The Phase 34 closure comment in apps/api/src/index.ts
        // legitimately documents the retired `req.tenantId` shape in
        // prose; only EXECUTABLE references count as offenders.
        const codeOnly = src
          .replace(/\/\*[\s\S]*?\*\//g, (chunk) => chunk.replace(/[^\n]/g, " "))
          .replace(/\/\/[^\n]*/g, (chunk) => " ".repeat(chunk.length));
        const lines = codeOnly.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            offenders.push({ file, lineNo: i + 1, line: lines[i].trim() });
          }
        }
      }
    }
    expect(
      offenders,
      `req.tenantId / request.tenantId is forbidden in production code (CR-1). Use req.tenant from dualAuthHook. Offenders:\n${offenders
        .map((o) => `  ${o.file}:${o.lineNo}  ${o.line}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
