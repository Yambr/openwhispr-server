#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: Apache-2.0
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

// Phase 03 / Plan 09 — operator-facing docs (LITELLM-05 + LITELLM-06).
// docs/litellm-target-spec.md: bundled-default + corporate-override topology.
// docs/litellm-mock-mode.md: hermetic contract-test architecture.
const REQUIRED_TARGET_SPEC_H2S = [
  "Topologies",
  "Bundled-Default Configuration",
  "Corporate-Override Configuration",
  "Request ID Propagation",
  "Env Override Path",
  "Diarization (Sync-Wrapper Pattern)",
  "Realtime WSS Topology",
  "Spend Log Ingestion",
] as const;

// D-07 REVISED grep-asserted phrases in docs/litellm-target-spec.md.
const REQUIRED_TARGET_SPEC_PHRASES = [
  "sync-wrapper",
  "4-step",
  "Idempotency-Key",
  "1500",
  "PYANNOTE_API_KEY",
  "NOT via LiteLLM",
  "speaches-audio.md",
] as const;

const REQUIRED_MOCK_MODE_H2S = [
  "What This Solves",
  "How It Works",
  "Per-Model mock_response",
  "Diarization Mock",
  "Running Locally",
] as const;

const REQUIRED_MOCK_MODE_PHRASES = ["MOCK_DIARIZATION"] as const;

interface Issue {
  rule: string;
  detail: string;
}

interface DocSpec {
  basename: string;
  requiredH2s: readonly string[];
  requiredPhrases: readonly string[];
  /** When true, this doc is the wire-contracts file with extra structural rules. */
  isWireContracts: boolean;
}

const DOC_SPECS: readonly DocSpec[] = [
  {
    basename: "wire-contracts-phase-3.md",
    requiredH2s: REQUIRED_PHASE_3_H2S,
    requiredPhrases: [],
    isWireContracts: true,
  },
  {
    basename: "litellm-target-spec.md",
    requiredH2s: REQUIRED_TARGET_SPEC_H2S,
    requiredPhrases: REQUIRED_TARGET_SPEC_PHRASES,
    isWireContracts: false,
  },
  {
    basename: "litellm-mock-mode.md",
    requiredH2s: REQUIRED_MOCK_MODE_H2S,
    requiredPhrases: REQUIRED_MOCK_MODE_PHRASES,
    isWireContracts: false,
  },
];

function specFor(target: string): DocSpec {
  for (const spec of DOC_SPECS) {
    if (target.endsWith(spec.basename)) return spec;
  }
  // Default to the legacy wire-contracts ruleset for backward compatibility.
  return DOC_SPECS[0]!;
}

function lintFile(target: string): Issue[] {
  const issues: Issue[] = [];
  let body: string;
  try {
    body = readFileSync(resolve(target), "utf8");
  } catch (err) {
    issues.push({
      rule: "io-error",
      detail: `cannot read ${target}: ${(err as Error).message}`,
    });
    return issues;
  }

  const spec = specFor(target);

  // 1. Required H2 sections.
  for (const heading of spec.requiredH2s) {
    const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m");
    if (!re.test(body)) {
      issues.push({ rule: "missing-h2", detail: `## ${heading}` });
    }
  }

  // 2. Wire-contracts file has extra structural rules.
  if (spec.isWireContracts) {
    // 2a. Each required H2 has at least one fenced code block before the next H2 / EOF.
    for (const heading of spec.requiredH2s) {
      const slice = sliceSection(body, heading);
      if (slice && !/```[\s\S]+?```/.test(slice)) {
        issues.push({
          rule: "no-fenced-quote",
          detail: `## ${heading} contains no fenced code block (verbatim quote required)`,
        });
      }
    }
    // 2b. At least one BACKEND_SPEC.md:L citation anywhere in the doc.
    if (!/BACKEND_SPEC\.md:L\d+/.test(body)) {
      issues.push({
        rule: "no-source-citation",
        detail: "Document contains zero BACKEND_SPEC.md:L<line> source citations",
      });
    }
    // 2c. Decision subsections.
    for (const decision of REQUIRED_DECISIONS) {
      const re = new RegExp(`Decision:\\s*${escapeRegex(decision)}`, "i");
      if (!re.test(body)) {
        issues.push({
          rule: "missing-decision",
          detail: `Decision subsection not found: "${decision}"`,
        });
      }
    }
  }

  // 3. Required literal phrases (case-sensitive substring match).
  for (const phrase of spec.requiredPhrases) {
    if (!body.includes(phrase)) {
      issues.push({
        rule: "missing-phrase",
        detail: `Required phrase not found: "${phrase}"`,
      });
    }
  }

  return issues;
}

function main(): number {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    process.stderr.write("lint-docs-headings: usage: lint-docs-headings.ts <markdown-file> [<markdown-file>...]\n");
    return 2;
  }

  let totalIssues = 0;
  let ioFailed = false;
  for (const target of targets) {
    const issues = lintFile(target);
    if (issues.length === 0) {
      process.stdout.write(`lint-docs-headings: ${target} ok\n`);
      continue;
    }
    totalIssues += issues.length;
    process.stderr.write(`lint-docs-headings: ${issues.length} violation(s) in ${target}:\n`);
    for (const issue of issues) {
      if (issue.rule === "io-error") ioFailed = true;
      process.stderr.write(`  [${issue.rule}] ${issue.detail}\n`);
    }
  }

  if (ioFailed) return 2;
  return totalIssues === 0 ? 0 : 1;
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
