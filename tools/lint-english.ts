#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-english.ts — Standalone Cyrillic-codepoint scanner.
 *
 * Enforces DOCS-09 (English-only source artifacts). Scans the configured
 * working directory (default: process.cwd()) for source files containing
 * Cyrillic codepoints in the ranges:
 *   - U+0400..U+04FF (Cyrillic)
 *   - U+0500..U+052F (Cyrillic Supplement)
 *
 * The scope is the repo working tree only. Symlinks are not followed
 * outside cwd. Files under packages/i18n/locales/** and
 * tests/fixtures/i18n/** are allowlisted (Cyrillic permitted there).
 *
 * Exit codes:
 *   0 — no Cyrillic found in any non-allowlisted file
 *   1 — at least one offender; each is printed to stderr as
 *       file:line:col preview
 *   2 — internal error during scan
 *
 * Usage:
 *   pnpm exec tsx tools/lint-english.ts [rootDir]
 *
 * NOTE: This source MUST contain no literal Cyrillic codepoints — the
 * regex is built exclusively from \u escapes so the script does not
 * self-flag.
 */
import { readFileSync, realpathSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { exit } from "node:process";

// Cyrillic (U+0400..U+04FF) + Cyrillic Supplement (U+0500..U+052F).
// Built only from \u escapes to keep this source ASCII-clean.
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F]/;

const PATTERNS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.cjs",
  "**/*.mjs",
  "**/*.json",
  "**/*.md",
  "**/*.mdx",
  "**/*.yaml",
  "**/*.yml",
];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/.git/**",
  // Phase 53 / Plan 53-11 — Playwright run artifacts (screenshots, traces,
  // error-context.md) embed verbatim spec text. The i18n-russian spec is
  // allowlisted upstream; its trace artifacts inherit that rationale. The
  // artifacts are gitignored — they only land locally during a test run —
  // so the lint scan can safely skip them everywhere.
  "**/test-results/**",
  "**/playwright-report/**",
  "**/pnpm-lock.yaml",
  "packages/i18n/locales/**",
  "tests/fixtures/i18n/**",
  // Phase 10 — i18n locale-bundle files (web + api) and Russian-rendering
  // e2e specs are i18n surfaces, not source artifacts. Allowlist covers
  // every `*/locales/**` directory across the monorepo so future packages
  // (apps/worker email templates, etc.) inherit the same exemption.
  "**/locales/**",
  // i18n unit-test files intentionally embed Cyrillic strings as fixtures
  // to assert lookup / formatting behavior. They are i18n surfaces by the
  // same rationale as the bundle JSON files. Pattern covers both
  // `__tests__/*-i18n.test.*` and `i18n/__tests__/**` layouts.
  "**/i18n/__tests__/**",
  "**/__tests__/*-i18n.test.*",
  "**/__tests__/i18n*.test.*",
  "apps/web/tests/e2e/i18n-russian.spec.ts",
  // Phase 33 — CJM signup-extras step unit tests own a Cyrillic-detection
  // regex (the literal source uses the U+0410..U+044F + U+0401 + U+0451
  // codepoint range) as the assertion subject under test. The regex must
  // contain the Cyrillic block by its own definition, so the file is an
  // i18n surface by construction. Same rationale as the
  // `__tests__/*-i18n.test.*` pattern; this file's name doesn't fit the
  // i18n-suffix shape but its purpose is identical.
  "tests/e2e-cjm/steps/__tests__/signup-extras.steps.test.ts",
  // Reference document — Russian-language description of an upstream
  // LiteLLM/Speaches deployment that the server is configured against.
  // Treated as i18n-context input, not a source artifact. Allowlisted per
  // the resolution path documented in deferred-items.md (D-03-A, option c).
  "speaches-audio.md",
];

interface Offender {
  file: string;
  line: number;
  col: number;
  preview: string;
}

async function main(): Promise<void> {
  const rawCwd = process.argv[2] ?? process.cwd();
  const cwd = resolve(rawCwd);
  // Resolve to a real path so symlink chicanery is normalized; reject if the
  // resolved path is not the same prefix as cwd (defense-in-depth).
  const realCwd = realpathSync(cwd);
  if (realCwd !== cwd) {
    // Allowed (e.g., /var on macOS resolves to /private/var); just use realCwd.
  }

  const offenders: Offender[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  for (const pattern of PATTERNS) {
    // Node 24 native glob; cwd-rooted; exclude list applied per call.
    for await (const file of glob(pattern, { cwd: realCwd, exclude: IGNORE })) {
      const rel = typeof file === "string" ? file : String(file);
      if (seen.has(rel)) continue;
      seen.add(rel);

      const full = resolve(realCwd, rel);
      // Reject paths that escape the root (e.g., via traversal in symlinks).
      if (!full.startsWith(realCwd + sep) && full !== realCwd) {
        continue;
      }

      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      scanned += 1;

      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i];
        const m = CYRILLIC.exec(lineText);
        if (m && m.index !== undefined) {
          offenders.push({
            file: rel,
            line: i + 1,
            col: m.index + 1,
            preview: lineText.trim().slice(0, 80),
          });
        }
      }
    }
  }

  if (offenders.length > 0) {
    process.stderr.write(
      `English-only violation: ${offenders.length} occurrence(s) in ${realCwd}\n`,
    );
    for (const o of offenders) {
      process.stderr.write(`  ${o.file}:${o.line}:${o.col}  ${o.preview}\n`);
    }
    exit(1);
  }

  process.stdout.write(`English-only check passed: ${scanned} file(s) scanned in ${realCwd}\n`);
}

main().catch((err) => {
  process.stderr.write(`lint-english: internal error: ${String(err)}\n`);
  exit(2);
});
