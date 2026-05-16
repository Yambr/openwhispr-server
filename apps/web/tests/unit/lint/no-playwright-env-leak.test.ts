// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41 / Plan 41-c — HI-2 regression guard.
//
// Asserts that NO production source file under apps/web/src/** reads a
// PLAYWRIGHT_* environment variable. This closes web.md HI-2 (the
// `PLAYWRIGHT_DISABLE_SSR_PREFETCH` runtime branch shipped in five
// production RSC entries) and prevents future test-only env-var leaks
// from reaching the production bundle.
//
// Scope:
//   - apps/web/src/**/*.{ts,tsx} (production source)
//   - excludes apps/web/tests/** (this file and any future test-side
//     reads are legitimate)
//
// Allowed: any reference inside a comment line describing the policy.
// The regex matches code-expression form; comments are stripped before
// scanning.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(WEB_ROOT, "src");

const FORBIDDEN_PATTERN = /process\.env\.PLAYWRIGHT[A-Z_]+/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

function collectViolations(): Array<{ file: string; line: number; match: string }> {
  const out: Array<{ file: string; line: number; match: string }> = [];
  for (const abs of walk(SRC_ROOT)) {
    const content = readFileSync(abs, "utf8");
    const rel = path.relative(SRC_ROOT, abs);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const trimmed = line.trim();
      // Skip single-line comments to allow documentation references.
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const matches = line.matchAll(FORBIDDEN_PATTERN);
      for (const m of matches) {
        out.push({ file: rel, line: i + 1, match: m[0] });
      }
    }
  }
  return out;
}

describe("no PLAYWRIGHT_* env reads in apps/web/src/** (Phase 41.c HI-2)", () => {
  it("scan finds zero process.env.PLAYWRIGHT_* references in production source", () => {
    const violations = collectViolations();
    expect(
      violations,
      `Found ${violations.length} PLAYWRIGHT_* env read(s) in production source:\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.match}`).join("\n"),
    ).toEqual([]);
  });
});
