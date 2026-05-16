#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-hardcode.ts — Hardcoded-token regression-guard CLI
 * (Phase 31 / Plan 03 — LOCKER-03, DISCIPLINE Rule 13).
 *
 * Scans `apps/**\/src/**` + `packages/**\/src/**` *.ts + *.tsx for
 * hardcoded localhost / 127.0.0.1 / port literals (`:3000|:4000|:8080`) /
 * UUID literals / fake-token shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`,
 * `Bearer ey…`). Out-of-scope trees (`tests/`, `.env.*.example`,
 * `compose/`, `docs/`, `charts/`, `tools/`, `__tests__/`, `*.test.ts`)
 * are IGNORE'd via glob — whole-tree skip.
 *
 * Mirrors `lint-dockerfile-tls.ts` shape (Violation, readAllowlist,
 * findViolations, main; exit codes 0/1/2; SPDX header). One deviation
 * from that template: Violation carries `severity: "BLOCKING" | "WARN"`
 * — allowlist-matched findings are downgraded to WARN (visible in
 * stderr summary but non-blocking), so the 8 canonical
 * `DEFAULT_TENANT_ID = "00000000-..."` sentinels can sit on the
 * allowlist permanently as `# canonical-default-tenant` without being
 * silenced (so a future regression that adds a 9th UUID-zero hit at a
 * NEW file:line will still produce a BLOCKING finding).
 *
 * Allowlist format: one `file:line` per row (POSIX path), optional
 * trailing `# rationale` (stripped on read), `#`-prefixed and blank
 * lines ignored. New entries require a one-line rationale in the
 * commit body that adds them; LOCKER-09's allowlist-diff CI step
 * (lands 31-07) refuses net additions without an
 * `Allowlist-grow-approved:` trailer.
 *
 * Exit codes:
 *   0 — no BLOCKING findings (WARN-only OK)
 *   1 — at least one BLOCKING finding; per-file summary on stderr
 *   2 — internal error (e.g., allowlist path is a directory)
 *
 * Usage:
 *   pnpm exec tsx tools/lint-no-hardcode.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

/** Severity classification for a single hardcoded-token finding. */
export type Severity = "BLOCKING" | "WARN";

/** A single forbidden-token match on a line of a scanned source file. */
export interface Violation {
  /** POSIX path of the offending file, relative to scan rootDir. */
  file: string;
  /** 1-based line number. */
  lineNumber: number;
  /** Full text of the offending line (untrimmed). */
  lineText: string;
  /** Human-readable category label (e.g., "localhost-string"). */
  label: string;
  /** Remediation pointer surfaced to the contributor in the stderr summary. */
  remediation: string;
  /** BLOCKING by default; downgraded to WARN when `file:lineNumber` is on the allowlist. */
  severity: Severity;
}

/**
 * Path (relative to rootDir) of the transitional allowlist file. One
 * `<posix-path>:<line>` per line; lines starting with `#` or blank are
 * ignored. Trailing `# rationale` is stripped on read. Entries fall in
 * two buckets:
 *   (a) PERMANENT — the 8 canonical `DEFAULT_TENANT_ID` UUID-zero
 *       sentinels (`# canonical-default-tenant`), never removed.
 *   (b) MIGRATION DEBT — port/localhost literals slated for env-driven
 *       defaults in a future targeted phase (`# issue-31-debt-...`).
 */
export const ALLOWLIST_FILE = "tools/lint-no-hardcode.allowlist.txt";

/**
 * Glob patterns scanned. Mirrors RESEARCH §LOCKER-03 scope: production
 * source under apps/ + packages/ only; `.tsx` is included because
 * apps/web pages contribute port-literal hits.
 */
const PATTERNS = [
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
];

/**
 * Whole-tree IGNORE list — paths matching any of these globs are
 * skipped before any regex is evaluated. Tests, compose, docs, charts,
 * tooling, and `.env.*.example` fixtures intentionally carry hardcoded
 * shapes (and SHOULD), so we never flag them.
 */
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
  // Out-of-scope trees per plan
  "**/tests/**",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/.env*.example",
  "**/compose/**",
  "**/docs/**",
  "**/charts/**",
  "**/tools/**",
];

/**
 * Forbidden patterns scanned per-line. Each entry is matched anywhere
 * in the line; multiple labels can fire on the same line (e.g., the
 * literal `"http://localhost:3000"` hits BOTH `localhost-string` AND
 * `port-literal`). The `remediation` string is surfaced in the stderr
 * summary so contributors know how to fix the violation without
 * reading the source of this file.
 */
const FORBIDDEN: {
  readonly regex: RegExp;
  readonly label: string;
  readonly remediation: string;
}[] = [
  {
    regex: /\blocalhost\b/,
    label: "localhost-string",
    remediation: "use env-driven `APP_BASE_URL` / `INTERNAL_API_URL`; never hardcode hostnames",
  },
  {
    regex: /\b127\.0\.0\.1\b/,
    label: "loopback-ip",
    remediation: "use env-driven URLs; loopback is environment-dependent",
  },
  {
    regex: /:(?:3000|4000|8080)\b/,
    label: "port-literal",
    remediation: "ports come from env (PORT, INTERNAL_API_PORT, LITELLM_PORT); never inline",
  },
  {
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    label: "uuid-literal",
    remediation:
      "UUIDs come from DB / env / fixtures; if this is a canonical sentinel (e.g., DEFAULT_TENANT_ID), allowlist with rationale",
  },
  {
    regex: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/,
    label: "secret-shape-openai-anthropic",
    remediation: "never inline OpenAI / Anthropic API-key shapes in source",
  },
  {
    regex: /\bAIza[A-Za-z0-9_-]{20,}\b/,
    label: "secret-shape-google",
    remediation: "never inline Google API-key shapes",
  },
  {
    regex: /\bAKIA[A-Z0-9]{16,}\b/,
    label: "secret-shape-aws",
    remediation: "never inline AWS access-key shapes",
  },
  {
    regex: /\bBearer\s+ey[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=.-]+/,
    label: "secret-shape-jwt-bearer",
    remediation: "never inline Bearer-JWT shapes",
  },
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`.
 * Returns an empty Set when the file does not exist. Lines beginning
 * with `#` (after trimming) and blank lines are skipped; each remaining
 * line has any trailing `# rationale` stripped, is trimmed, and is
 * added to the Set as a `file:line` POSIX key.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Strip trailing `# rationale` (if any), then re-trim.
    const hashIdx = trimmed.indexOf("#");
    const key = (hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx)).trim();
    if (key) out.add(key);
  }
  return out;
}

/**
 * Scan `rootDir` for in-scope source files and return the sorted list
 * of forbidden-token findings. Findings whose `file:lineNumber` key is
 * in the allowlist are downgraded to `severity: "WARN"`; all others are
 * `severity: "BLOCKING"`.
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
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        /* c8 ignore next 2 — glob yielded the path; read failure is a race we tolerate. */
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        /* c8 ignore next — split() yields strings; `?? ""` is defensive. */
        const line = lines[i] ?? "";
        for (const { regex, label, remediation } of FORBIDDEN) {
          if (regex.test(line)) {
            const key = `${posixRel}:${i + 1}`;
            out.push({
              file: posixRel,
              lineNumber: i + 1,
              lineText: line,
              label,
              remediation,
              severity: allowlist.has(key) ? "WARN" : "BLOCKING",
            });
          }
        }
      }
    }
  }
  out.sort((a, b) => {
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
    process.stderr.write(
      `lint-no-hardcode: ${err instanceof Error ? err.message : /* c8 ignore next */ String(err)}\n`,
    );
    return 2;
  }
  const blocking = violations.filter((v) => v.severity === "BLOCKING");
  const warns = violations.filter((v) => v.severity === "WARN");
  if (blocking.length === 0) {
    if (warns.length > 0) {
      process.stderr.write(
        `lint-no-hardcode: ${warns.length} allowlisted finding(s) (WARN, non-blocking)\n`,
      );
    }
    process.stdout.write(`lint-no-hardcode: clean (${rootDir})\n`);
    return 0;
  }
  const byFile = new Map<string, number>();
  for (const v of blocking) {
    byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  }
  process.stderr.write(
    `lint-no-hardcode: ${blocking.length} hardcoded-token violation(s) across ${byFile.size} file(s):\n`,
  );
  for (const [file, count] of [...byFile.entries()].sort()) {
    process.stderr.write(`  ${file}: ${count}\n`);
  }
  // Surface up to 8 remediation lines (one per FORBIDDEN class) so the
  // contributor learns the fix without re-reading the source.
  const seenLabels = new Set<string>();
  for (const v of blocking) {
    if (seenLabels.has(v.label)) continue;
    seenLabels.add(v.label);
    process.stderr.write(`  [${v.label}] ${v.remediation}\n`);
  }
  process.stderr.write(
    `Remove the offending literal, switch to an env-driven default, or add the ` +
      `\`file:line\` to ${ALLOWLIST_FILE} with a one-line rationale in the commit body.\n`,
  );
  return 1;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-no-hardcode.ts") || arg1.endsWith("lint-no-hardcode.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-no-hardcode: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
