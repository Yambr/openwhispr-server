#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-docs-headings.ts — Phase 03 / Plan 01 / Task 1 (D-09).
 *
 * Asserts a target markdown file contains every H2 section listed in its
 * required-sections argv (default: the four Phase 3 wire-contract sections
 * `POST /api/transcribe`, `POST /api/reason`, `Diarization`, `WSS /v1/realtime`).
 *
 * Also enforces shape rules for `docs/wire-contracts-phase-3.md`:
 *   - At least one fenced code block per required H2 section (verbatim quote).
 *   - At least one `BACKEND_SPEC.md:L` source-line citation in the document.
 *   - The "Decision: wordsUsed semantics" subsection is present (resolves A5/A6).
 *   - The "Decision: diarization mount" subsection is present (resolves D-09 mount).
 *
 * Exit codes:
 *   0 — all required sections + shape rules satisfied
 *   1 — at least one violation, printed to stderr
 *   2 — internal error (file unreadable, etc.)
 *
 * Usage:
 *   pnpm exec tsx tools/lint-docs-headings.ts docs/wire-contracts-phase-3.md
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

const REQUIRED_PHASE_3_H2S = [
  "POST /api/transcribe",
  "POST /api/reason",
  "Diarization",
  "WSS /v1/realtime",
] as const;

const REQUIRED_DECISIONS = ["wordsUsed semantics", "diarization mount"] as const;

interface Issue {
  rule: string;
  detail: string;
}

function main(): number {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write("lint-docs-headings: usage: lint-docs-headings.ts <markdown-file>\n");
    return 2;
  }

  let body: string;
  try {
    body = readFileSync(resolve(target), "utf8");
  } catch (err) {
    process.stderr.write(`lint-docs-headings: cannot read ${target}: ${(err as Error).message}\n`);
    return 2;
  }

  const issues: Issue[] = [];

  // 1. Required H2 sections.
  for (const heading of REQUIRED_PHASE_3_H2S) {
    const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m");
    if (!re.test(body)) {
      issues.push({
        rule: "missing-h2",
        detail: `## ${heading}`,
      });
    }
  }

  // 2. Each required H2 has at least one fenced code block before the next H2 / EOF.
  for (const heading of REQUIRED_PHASE_3_H2S) {
    const slice = sliceSection(body, heading);
    if (slice && !/```[\s\S]+?```/.test(slice)) {
      issues.push({
        rule: "no-fenced-quote",
        detail: `## ${heading} contains no fenced code block (verbatim quote required)`,
      });
    }
  }

  // 3. At least one BACKEND_SPEC.md:L citation anywhere in the doc.
  if (!/BACKEND_SPEC\.md:L\d+/.test(body)) {
    issues.push({
      rule: "no-source-citation",
      detail: "Document contains zero BACKEND_SPEC.md:L<line> source citations",
    });
  }

  // 4. Decision subsections.
  for (const decision of REQUIRED_DECISIONS) {
    const re = new RegExp(`Decision:\\s*${escapeRegex(decision)}`, "i");
    if (!re.test(body)) {
      issues.push({
        rule: "missing-decision",
        detail: `Decision subsection not found: "${decision}"`,
      });
    }
  }

  if (issues.length === 0) {
    process.stdout.write(`lint-docs-headings: ${target} ok (${REQUIRED_PHASE_3_H2S.length} required H2 sections, ${REQUIRED_DECISIONS.length} decisions)\n`);
    return 0;
  }

  process.stderr.write(`lint-docs-headings: ${issues.length} violation(s) in ${target}:\n`);
  for (const issue of issues) {
    process.stderr.write(`  [${issue.rule}] ${issue.detail}\n`);
  }
  return 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceSection(body: string, heading: string): string | null {
  const start = body.search(new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m"));
  if (start < 0) return null;
  const after = body.slice(start + 1);
  const next = after.search(/^##\s+/m);
  return next < 0 ? after : after.slice(0, next);
}

exit(main());
