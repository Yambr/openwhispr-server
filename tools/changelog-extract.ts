#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * changelog-extract.ts — CHANGELOG section extractor CLI
 * (Quick 260605-ikx — version→changelog release bind).
 *
 * Prints to stdout the body lines BETWEEN a `## [VERSION]` header (exclusive)
 * and the next `## [` header (exclusive), trimmed of leading/trailing blank
 * lines. Used by `.github/workflows/release.yml` to inject a "What's changed"
 * block into the GitHub Release body — and, because a missing section returns
 * a NON-ZERO exit code, to FAIL a tag that lacks a matching CHANGELOG entry.
 *
 * Args (file-path / version only — LOCKER-01: no process.env reads):
 *   argv[0] — path to CHANGELOG.md
 *   argv[1] — SemVer version to extract (e.g. "1.2.3")
 *
 * Exit codes:
 *   0 — section found; body printed to stdout
 *   1 — section missing; gate message on stderr
 *   2 — bad args (fewer than 2 argv) or internal error
 *
 * Usage:
 *   pnpm exec tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3
 */
import { readFileSync } from "node:fs";

const HEADER_PREFIX = "## [";

/**
 * Extract the trimmed body of the `## [version]` section from changelog text.
 * Returns null when no section header matches the requested version.
 */
export function extractSection(text: string, version: string): string | null {
  const lines = text.split("\n");
  const wantHeader = `${HEADER_PREFIX}${version}]`;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] as string).startsWith(wantHeader)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] as string;
    // Stop at the next section header OR the link-reference footer
    // (`[x.y.z]:` lines) that closes the oldest section.
    if (line.startsWith(HEADER_PREFIX) || /^\[[^\]]+\]:\s/.test(line)) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start, end);
  // Trim leading/trailing blank lines.
  while (body.length > 0 && (body[0] as string).trim() === "") {
    body.shift();
  }
  while (body.length > 0 && (body[body.length - 1] as string).trim() === "") {
    body.pop();
  }
  return body.join("\n");
}

/** CLI entrypoint — returns the process exit code (never calls process.exit). */
export async function main(argv: string[]): Promise<number> {
  if (argv.length < 2) {
    process.stderr.write("usage: changelog-extract.ts <changelogPath> <version>\n");
    return 2;
  }
  const [changelogPath, version] = argv;
  const text = readFileSync(changelogPath as string, "utf8");
  const body = extractSection(text, version as string);
  if (body === null) {
    process.stderr.write(`CHANGELOG.md has no section for ${version} — add it before tagging\n`);
    return 1;
  }
  process.stdout.write(`${body}\n`);
  return 0;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("changelog-extract.ts") || arg1.endsWith("changelog-extract.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(
        `changelog-extract: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(2);
    },
  );
}
/* c8 ignore stop */
