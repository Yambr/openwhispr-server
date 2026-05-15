#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-dockerfile-tls.ts — Dev-CA / mkcert leakage regression-guard CLI
 * (Phase 17 / Plan 02 — TLS-05).
 *
 * Scans `**\/Dockerfile` (NARROW glob — does NOT match `Dockerfile.bak`,
 * `.dockerignore`, or any non-Dockerfile sibling) for COPY/ADD/RUN lines
 * that reference known dev-CA / mkcert artefacts that must NEVER ship in
 * a production image. Mirrors `tools/lint-phase-tag-comments.ts` shape:
 * bare `[rootDir]` positional argv, exit codes 0/1/2.
 *
 * Allowlist: `tools/lint-dockerfile-tls.allowlist.txt` holds POSIX paths
 * whose forbidden tokens are intentionally retained. Entries require a
 * one-line rationale in the commit body that adds them.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; per-file summary printed to stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-dockerfile-tls.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

/** A single forbidden-token match on a line of a Dockerfile. */
export interface Violation {
  /** POSIX path of the offending Dockerfile, relative to scan rootDir. */
  file: string;
  /** 1-based line number. */
  lineNumber: number;
  /** The full text of the offending line (untrimmed). */
  lineText: string;
  /** Human-readable category label (e.g., "rootCA*.pem"). */
  label: string;
}

/**
 * Path (relative to rootDir) of the transitional allowlist file. One
 * POSIX path per line; lines starting with `#` or blank are ignored.
 * Add a path here ONLY if a forbidden token in that Dockerfile is
 * intentional (extremely rare).
 */
export const ALLOWLIST_FILE = "tools/lint-dockerfile-tls.allowlist.txt";

/**
 * Glob narrowed to `**\/Dockerfile` ONLY per 17-PATTERNS risk callout
 * line 226. NOT `**\/Dockerfile*` — that would match `Dockerfile.bak`
 * and other siblings; we intentionally only audit the canonical names.
 */
const PATTERNS = ["**/Dockerfile"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/build/**",
  "**/__generated__/**",
  "**/.git/**",
  // Phase 17 / Plan 02 — test fixtures live under tools/__tests__/fixtures/
  // and intentionally contain forbidden tokens; they are scoped IN by the
  // unit test which scans a tmpdir, not the real tree.
  "**/__tests__/fixtures/**",
];

/**
 * Forbidden patterns scanned per-line. Each entry is matched anywhere in
 * the line (token granularity is encoded in the regex). The label is
 * surfaced to callers + the human-readable stderr summary.
 *
 * The set mirrors `.dockerignore` Phase 17 TLS-05 block byte-for-byte:
 * `rootCA*.pem`, `root-ca.{crt,key}`, `mkcert`, `compose/traefik/certs/`,
 * `*.localhost.{pem,key}`, `local.{crt,key}`.
 */
const FORBIDDEN: { readonly regex: RegExp; readonly label: string }[] = [
  { regex: /rootCA[A-Za-z0-9._-]*\.pem/i, label: "rootCA*.pem" },
  { regex: /\broot-ca\.crt\b/i, label: "root-ca.crt" },
  { regex: /\broot-ca\.key\b/i, label: "root-ca.key" },
  { regex: /\bmkcert\b/i, label: "mkcert" },
  { regex: /compose\/traefik\/certs\//, label: "compose/traefik/certs/" },
  { regex: /[A-Za-z0-9_-]+\.localhost\.pem/i, label: "*.localhost.pem" },
  { regex: /[A-Za-z0-9_-]+\.localhost\.key/i, label: "*.localhost.key" },
  { regex: /\blocal\.crt\b/, label: "local.crt" },
  { regex: /\blocal\.key\b/, label: "local.key" },
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`. Returns
 * an empty Set when the file does not exist. Lines beginning with `#`
 * (after trimming) and blank lines are skipped; remaining lines are
 * trimmed and returned as POSIX paths.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

/**
 * Scan `rootDir` for `Dockerfile` files and return the sorted list of
 * forbidden-token violations whose POSIX path is NOT in the allowlist.
 * Each line may produce multiple violations (one per matched label).
 */
export async function findViolations(rootDir: string): Promise<Violation[]> {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const pattern of PATTERNS) {
    for await (const f of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      /* c8 ignore next — node:fs/promises glob yields strings here. */
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      /* c8 ignore next — PATTERNS has a single entry, dedup is defensive. */
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      if (allowlist.has(posixRel)) continue;
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        /* c8 ignore next 2 */
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        /* c8 ignore next — split() yields strings; `?? ""` is defensive. */
        const line = lines[i] ?? "";
        for (const { regex, label } of FORBIDDEN) {
          if (regex.test(line)) {
            out.push({ file: posixRel, lineNumber: i + 1, lineText: line, label });
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    /* c8 ignore next 3 — sort comparator: v8 coverage only exercises whichever
       branch the glob iteration order happens to produce; the descending
       direction is structurally unreachable in deterministic test runs. */
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
    /* c8 ignore next — same file + same line → label-order tiebreak. */
    return a.label < b.label ? -1 : 1;
  });
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const rootDir = argv[0] ?? process.cwd();
  let violations: Violation[];
  try {
    violations = await findViolations(rootDir);
  } catch (err) {
    /* c8 ignore next 3 — `String(err)` branch only fires for non-Error throws;
       the test path uses a real EISDIR which is always an Error instance. */
    process.stderr.write(
      `lint-dockerfile-tls: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    process.stdout.write(`lint-dockerfile-tls: clean (${rootDir})\n`);
    return 0;
  }
  const byFile = new Map<string, number>();
  for (const v of violations) {
    byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  }
  process.stderr.write(
    `lint-dockerfile-tls: ${violations.length} dev-CA / mkcert reference(s) across ${byFile.size} Dockerfile(s):\n`,
  );
  for (const [file, count] of [...byFile.entries()].sort()) {
    process.stderr.write(`  ${file}: ${count}\n`);
  }
  process.stderr.write(
    "Remove the offending COPY/ADD/RUN line, or add the path to " +
      `${ALLOWLIST_FILE} with a one-line rationale in the commit body.\n`,
  );
  return 1;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-dockerfile-tls.ts") || arg1.endsWith("lint-dockerfile-tls.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-dockerfile-tls: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
