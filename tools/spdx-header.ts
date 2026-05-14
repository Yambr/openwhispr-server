// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * spdx-header.ts — SPDX short-form license-header codemod.
 *
 * Inserts `// SPDX-License-Identifier: FSL-1.1-ALv2` on the first non-shebang
 * line of every TypeScript / JavaScript source file under the working tree,
 * and (Phase 15 / Plan 03) rewrites any pre-existing stale Apache-2.0 SPDX
 * header in-place to the FSL identifier. Used both for ongoing audit (CI
 * gate via `pnpm spdx:check`) and as the one-shot relicense sweep tool.
 *
 * Scope:
 *   - Extensions: .ts, .tsx, .js, .jsx, .mjs, .cjs
 *   - Excluded paths: node_modules, dist, coverage, .next, .stryker-tmp,
 *     reports, build, **\/migrations/*.generated.*, **\/locales/** (i18n
 *     bundles), **\/__generated__/**, and *.json (handled at the extension
 *     filter, not the path filter).
 *
 * Exit codes (CLI):
 *   audit:
 *     0 — every in-scope file has the header
 *     1 — at least one in-scope file is missing the header (printed to stderr)
 *   fix:
 *     0 — codemod completed (count of modified files printed to stdout)
 *
 * Usage:
 *   pnpm exec tsx tools/spdx-header.ts audit [rootDir]
 *   pnpm exec tsx tools/spdx-header.ts fix   [rootDir]
 *
 * Idempotent: running `fix` twice in succession leaves the working tree
 * byte-identical. Shebang lines (`#!/...`) are preserved at line 1; the
 * header lands on line 2 in that case.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { exit } from "node:process";

export const HEADER = "// SPDX-License-Identifier: FSL-1.1-ALv2";

/**
 * Stale SPDX header lines that this codemod will recognise and REWRITE to
 * `HEADER` (Phase 15 / Plan 03 relicense sweep). When the project later
 * relicenses again, add the prior identifier to this list so a single
 * `pnpm spdx:fix` flips every file in-place without needing a separate
 * migration tool. The match is exact on the full line; comment style is
 * fixed to `// SPDX-License-Identifier: ...` (the only shape we have ever
 * written).
 */
export const STALE_HEADERS: readonly string[] = ["// SPDX-License-Identifier: Apache-2.0"];

function isStaleHeader(line: string | undefined): boolean {
  if (line === undefined) return false;
  return STALE_HEADERS.includes(line);
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const SKIP_DIRS = [
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".stryker-tmp",
  "reports",
  "build",
  "__generated__",
];

const PATTERNS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/build/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/locales/**",
  "**/.git/**",
];

export function shouldSkip(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.endsWith(".json")) return true;
  if (/\.generated\.[a-z]+$/i.test(norm)) return true;
  if (norm.includes("/locales/") || norm.startsWith("locales/")) return true;
  for (const dir of SKIP_DIRS) {
    if (norm.includes(`/${dir}/`) || norm.startsWith(`${dir}/`)) return true;
  }
  // Only honour the extension allow-list for source files.
  const dot = norm.lastIndexOf(".");
  if (dot === -1) return true;
  const ext = norm.slice(dot);
  if (!EXTENSIONS.includes(ext)) return true;
  return false;
}

export function isBinary(buf: Buffer): boolean {
  // A NUL byte within the first 8 KiB is the canonical binary-content
  // heuristic used by git, grep, file(1).
  const window = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < window.length; i += 1) {
    if (window[i] === 0) return true;
  }
  return false;
}

export function hasHeader(text: string): boolean {
  const lines = text.split("\n");
  if (lines.length === 0) return false;
  if (lines[0]?.startsWith("#!")) {
    return lines[1] === HEADER;
  }
  return lines[0] === HEADER;
}

export function applyHeader(text: string): string {
  if (hasHeader(text)) return text;
  // Stale-header rewrite path (Phase 15 / Plan 03 relicense sweep). When
  // the first non-shebang line is a known stale SPDX identifier, REPLACE
  // it in-place rather than prepending a fresh header (which would leave
  // the file with two SPDX lines and trip `reuse lint`).
  if (text.startsWith("#!")) {
    const nlIdx = text.indexOf("\n");
    if (nlIdx === -1) {
      // Shebang with no trailing newline — append one then header.
      return `${text}\n${HEADER}\n`;
    }
    const shebang = text.slice(0, nlIdx);
    const afterShebang = text.slice(nlIdx + 1);
    const secondLineEnd = afterShebang.indexOf("\n");
    const secondLine = secondLineEnd === -1 ? afterShebang : afterShebang.slice(0, secondLineEnd);
    if (isStaleHeader(secondLine)) {
      const rest = secondLineEnd === -1 ? "" : afterShebang.slice(secondLineEnd + 1);
      return `${shebang}\n${HEADER}\n${rest}`;
    }
    return `${shebang}\n${HEADER}\n${afterShebang}`;
  }
  const firstLineEnd = text.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  if (isStaleHeader(firstLine)) {
    const rest = firstLineEnd === -1 ? "" : text.slice(firstLineEnd + 1);
    return `${HEADER}\n${rest}`;
  }
  return `${HEADER}\n${text}`;
}

async function* iterateFiles(rootDir: string): AsyncGenerator<string> {
  const realRoot = resolve(rootDir);
  const seen = new Set<string>();
  for (const pattern of PATTERNS) {
    for await (const file of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      const rel = typeof file === "string" ? file : String(file);
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (shouldSkip(rel)) continue;
      yield rel;
    }
  }
}

export async function auditDir(rootDir: string): Promise<string[]> {
  const missing: string[] = [];
  const realRoot = resolve(rootDir);
  for await (const rel of iterateFiles(realRoot)) {
    const full = resolve(realRoot, rel);
    let buf: Buffer;
    try {
      buf = readFileSync(full);
    } catch {
      /* c8 ignore next */
      continue;
    }
    if (isBinary(buf)) continue;
    const text = buf.toString("utf8");
    if (!hasHeader(text)) missing.push(rel);
  }
  return missing;
}

export async function fixDir(rootDir: string): Promise<number> {
  let changed = 0;
  const realRoot = resolve(rootDir);
  for await (const rel of iterateFiles(realRoot)) {
    const full = resolve(realRoot, rel);
    let buf: Buffer;
    try {
      buf = readFileSync(full);
    } catch {
      /* c8 ignore next */
      continue;
    }
    if (isBinary(buf)) {
      // Source files that legitimately embed NUL bytes in string literals
      // (e.g. test fixtures asserting redactor behavior on binary garbage)
      // get flagged by the NUL-byte heuristic but are still valid UTF-8
      // source. If the file already opens with the correct SPDX header
      // (or a stale header we know how to rewrite via the binary-safe
      // path below), we proceed; otherwise we refuse to write.
      const headerBytes = Buffer.from(`${HEADER}\n`, "utf8");
      if (buf.subarray(0, headerBytes.length).equals(headerBytes)) {
        // Already correctly headed — nothing to do.
        continue;
      }
      // Binary-safe stale-header rewrite: scan for any known stale header
      // followed by a newline at byte 0; if found, splice in FSL header.
      let rewritten = false;
      for (const stale of STALE_HEADERS) {
        const staleBytes = Buffer.from(`${stale}\n`, "utf8");
        if (buf.subarray(0, staleBytes.length).equals(staleBytes)) {
          const tail = buf.subarray(staleBytes.length);
          const newBuf = Buffer.concat([headerBytes, tail]);
          writeFileSync(full, newBuf);
          changed += 1;
          rewritten = true;
          break;
        }
      }
      if (rewritten) continue;
      throw new Error(`spdx-header: refusing to write to binary file ${rel}`);
    }
    const before = buf.toString("utf8");
    const after = applyHeader(before);
    if (after !== before) {
      writeFileSync(full, after, "utf8");
      changed += 1;
    }
  }
  return changed;
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  const rootDir = argv[3] ?? process.cwd();
  if (cmd === "audit") {
    const missing = await auditDir(rootDir);
    if (missing.length === 0) {
      process.stdout.write(`spdx-header: audit clean (${rootDir})\n`);
      return 0;
    }
    process.stderr.write(`spdx-header: ${missing.length} file(s) missing header in ${rootDir}\n`);
    for (const m of missing) process.stderr.write(`  ${m}\n`);
    return 1;
  }
  if (cmd === "fix") {
    const n = await fixDir(rootDir);
    process.stdout.write(`spdx-header: inserted header into ${n} file(s) under ${rootDir}\n`);
    return 0;
  }
  process.stderr.write("usage: spdx-header.ts <audit|fix> [rootDir]\n");
  return 2;
}

// Run as CLI when invoked directly via tsx / node. Vitest runs this module
// through its own entry point, so `process.argv[1]` does not match the file.
/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("spdx-header.ts") || arg1.endsWith("spdx-header.js");
})();
if (invokedDirect) {
  main(process.argv).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(`spdx-header: ${err instanceof Error ? err.message : String(err)}\n`);
      exit(2);
    },
  );
}
/* c8 ignore stop */
