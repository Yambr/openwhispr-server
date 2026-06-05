#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-changelog.ts — CHANGELOG well-formedness + appVersion-parity lint CLI
 * (Quick 260605-ikx — version→changelog release bind).
 *
 * Validates that the repo-root CHANGELOG.md is Keep-a-Changelog-shaped and that
 * its newest released section matches the chart appVersion, so that the version
 * a release ships always carries human-authored notes:
 *   - has an `## [Unreleased]` section,
 *   - has ≥1 released `## [SemVer] - YYYY-MM-DD` section,
 *   - every released version has a matching `[ver]:` footer link line,
 *   - the TOP released section version == Chart.yaml appVersion.
 *
 * Args (file-path only — LOCKER-01: no process.env reads):
 *   argv[0] — path to CHANGELOG.md
 *   argv[1] — path to Chart.yaml (for the appVersion-parity check)
 *
 * Exit codes:
 *   0 — well-formed and parity holds
 *   1 — one or more validation failures; per-failure summary on stderr
 *   2 — bad args (fewer than 2 argv) or internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-changelog.ts CHANGELOG.md charts/openwhispr-server/Chart.yaml
 */
import { readFileSync } from "node:fs";

const RELEASED_HEADER = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/;
const ANY_RELEASED_HEADER = /^## \[(\d+\.\d+\.\d+)\]/;
const APP_VERSION_LINE = /^appVersion:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?\s*$/m;

/** Parse the chart appVersion from Chart.yaml text (line-regex, no yaml dep). */
export function parseAppVersion(text: string): string | null {
  const m = text.match(APP_VERSION_LINE);
  return m ? (m[1] as string) : null;
}

/** Return every released version in file order, ignoring `## [Unreleased]`. */
export function parseReleasedVersions(text: string): string[] {
  const versions: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(ANY_RELEASED_HEADER);
    if (m) {
      versions.push(m[1] as string);
    }
  }
  return versions;
}

/** CLI entrypoint — returns the process exit code (never calls process.exit). */
export async function main(argv: string[]): Promise<number> {
  if (argv.length < 2) {
    process.stderr.write("usage: lint-changelog.ts <changelogPath> <chartYamlPath>\n");
    return 2;
  }
  const [changelogPath, chartYamlPath] = argv;
  const changelog = readFileSync(changelogPath as string, "utf8");
  const chart = readFileSync(chartYamlPath as string, "utf8");
  const lines = changelog.split("\n");
  const failures: string[] = [];

  // 1. Unreleased section present.
  if (!lines.some((l) => l.startsWith("## [Unreleased]"))) {
    failures.push("missing `## [Unreleased]` section");
  }

  // 2. ≥1 released section, and every released header is well-formed.
  const releasedHeaderLines = lines.filter((l) => ANY_RELEASED_HEADER.test(l));
  if (releasedHeaderLines.length === 0) {
    failures.push("no released `## [X.Y.Z] - YYYY-MM-DD` section found");
  }
  for (const line of releasedHeaderLines) {
    if (!RELEASED_HEADER.test(line)) {
      failures.push(`malformed released header: "${line}" (want "## [X.Y.Z] - YYYY-MM-DD")`);
    }
  }

  // 3. Every released version has a matching footer link line.
  const released = parseReleasedVersions(changelog);
  for (const version of released) {
    const footer = new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]:\\s`, "m");
    if (!footer.test(changelog)) {
      failures.push(`released version ${version} has no \`[${version}]:\` footer link`);
    }
  }

  // 4. Parity: top released section == Chart.yaml appVersion.
  const appVersion = parseAppVersion(chart);
  if (appVersion === null) {
    failures.push("Chart.yaml has no `appVersion:` line");
  } else if (released.length > 0 && released[0] !== appVersion) {
    failures.push(
      `top released section ${released[0]} != Chart.yaml appVersion ${appVersion} — ` +
        "align the CHANGELOG top section with the chart appVersion before tagging",
    );
  }

  if (failures.length > 0) {
    process.stderr.write(`lint-changelog: ${failures.length} failure(s):\n`);
    for (const f of failures) {
      process.stderr.write(`  - ${f}\n`);
    }
    return 1;
  }
  return 0;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-changelog.ts") || arg1.endsWith("lint-changelog.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`lint-changelog: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}
/* c8 ignore stop */
