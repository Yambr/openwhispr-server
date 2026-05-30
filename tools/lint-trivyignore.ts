// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-trivyignore.ts — guard for the scoped trivy-fs suppression file.
 *
 * The `trivy-fs` required gate (severity CRITICAL,HIGH, exit-code 1) is allowed
 * to suppress SPECIFIC, justified advisory IDs via `.trivyignore`. This lint
 * enforces that the suppression stays scoped so it can never silently mask a
 * future, unrelated CRITICAL/HIGH:
 *
 *   1. Every non-comment, non-blank line is a single advisory ID matching
 *      CVE-YYYY-NNNN(+) or GHSA-xxxx-xxxx-xxxx (optionally `<id> exp:YYYY-MM-DD`).
 *   2. No wildcard / severity-class suppression (`*`, `CRITICAL`, `HIGH`, …).
 *   3. Every advisory ID has at least one justification comment line in the
 *      block immediately preceding it (no bare, unexplained suppression).
 *
 * The companion test feeds fixtures through these pure functions and also
 * asserts the live repo `.trivyignore` passes (and still contains the #33 IDs).
 *
 * fix 260530-rqk.
 */

const ID_RE = /^(CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/;
const SEVERITY_WORDS = new Set(["*", "CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

export interface TrivyignoreFinding {
  line: number;
  value: string;
  reason: string;
}

/**
 * Parse a `.trivyignore` body and return structural violations. Empty array
 * means the file is well-formed and fully scoped.
 */
export function lintTrivyignore(content: string): TrivyignoreFinding[] {
  const findings: TrivyignoreFinding[] = [];
  const lines = content.split("\n");
  let sawCommentSinceLastId = false;
  // A justification "block" is the run of comment lines directly above a GROUP
  // of one or more consecutive advisory IDs. `justified` stays true across a
  // contiguous run of ID lines (siblings share the comment block above them);
  // a blank line ends the group and requires a fresh justification.
  let justified = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "") {
      justified = false; // a blank line breaks the justification block
      continue;
    }
    if (trimmed.startsWith("#")) {
      justified = true;
      sawCommentSinceLastId = true;
      continue;
    }
    // Non-comment, non-blank → must be a scoped advisory ID (with optional exp:).
    const token = trimmed.split(/\s+/)[0];
    const expPart = trimmed.split(/\s+/)[1];

    if (SEVERITY_WORDS.has(token.toUpperCase()) || token === "*") {
      findings.push({
        line: i + 1,
        value: token,
        reason:
          "severity-class / wildcard suppression is forbidden — suppress specific advisory IDs only",
      });
      justified = false;
      continue;
    }
    if (!ID_RE.test(token)) {
      findings.push({
        line: i + 1,
        value: token,
        reason: "not a recognized advisory ID (expected CVE-YYYY-NNNN or GHSA-xxxx-xxxx-xxxx)",
      });
      justified = false;
      continue;
    }
    if (expPart !== undefined && !/^exp:\d{4}-\d{2}-\d{2}$/.test(expPart)) {
      findings.push({
        line: i + 1,
        value: trimmed,
        reason: "trailing token must be `exp:YYYY-MM-DD` if present",
      });
    }
    if (!justified) {
      findings.push({
        line: i + 1,
        value: token,
        reason: "suppression has no justification — add a comment block immediately above it",
      });
    }
    // `justified` stays true so sibling IDs in the same group inherit it.
  }

  // Defence: a non-empty file with zero comments at all is unjustified.
  if (!sawCommentSinceLastId && lines.some((l) => l.trim() !== "" && !l.trim().startsWith("#"))) {
    findings.push({
      line: 0,
      value: "(file)",
      reason: "no justification comments anywhere in .trivyignore",
    });
  }

  return findings;
}

/** Extract just the advisory IDs (CVE/GHSA) from a `.trivyignore` body. */
export function extractIds(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0])
    .filter((t) => ID_RE.test(t));
}
