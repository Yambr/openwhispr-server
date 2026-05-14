// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * migrate-tests.ts — Test-layout codemod (STRUCT-01, Phase 15).
 *
 * Relocates co-located `*.test.ts` files into the canonical layout:
 *   apps/APP/src/REST.test.ts             ->  apps/APP/tests/unit/REST.test.ts
 *   apps/APP/src/PATH/__tests__/F         ->  apps/APP/tests/unit/PATH/__tests__/F
 *   packages/PKG/src/REST.test.ts         ->  packages/PKG/tests/unit/REST.test.ts
 *   packages/PKG/src/PATH/__tests__/F     ->  packages/PKG/tests/unit/PATH/__tests__/F
 *
 * Exempt prefixes (codemod returns null / planMoves skips):
 *   tools/load-test/         (dev tooling — Phase 15 CONTEXT Q4)
 *   tests/                   (root e2e / conformance / infra — stay at root)
 *   tools/test-probe/tests/  (already canonical)
 *
 * Relative imports inside each moved test file are rewritten via ts-morph
 * (NOT regex). Bare-module imports (vitest, node:fs, etc.) are preserved.
 *
 * Exit codes (CLI):
 *   0 — clean (no moves needed, OR --dry-run produced an inventory)
 *   1 — moves were applied (--apply mode), at least one file relocated
 *   2 — usage / internal error
 *
 * Usage:
 *   pnpm exec tsx tools/migrate-tests.ts --dry-run
 *   pnpm exec tsx tools/migrate-tests.ts --dry-run --inventory <path.md>
 *   pnpm exec tsx tools/migrate-tests.ts --apply
 *
 * Idempotent: running `--apply` twice produces no diff on the second pass.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { exit } from "node:process";
import { Project, type SourceFile } from "ts-morph";

export const EXEMPT_PREFIXES = ["tools/load-test/", "tests/", "tools/test-probe/tests/"];

export interface Move {
  from: string;
  to: string;
}

interface ApplyOpts {
  dryRun: boolean;
  inventoryPath?: string;
}

/** Convert a path with platform-native separators to POSIX form. */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Returns true if `rel` (POSIX) is inside any EXEMPT_PREFIXES entry. */
function isExempt(rel: string): boolean {
  for (const prefix of EXEMPT_PREFIXES) {
    if (rel === prefix.replace(/\/$/, "") || rel.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Map a `<workspace>/src/<rest>.test.ts` path to `<workspace>/tests/unit/<rest>.test.ts`.
 * Returns null when the path is exempt, not a test file, or already canonical.
 */
export function computeTargetPath(srcPath: string): string | null {
  const rel = toPosix(srcPath).replace(/^\.\//, "");
  if (!rel.endsWith(".test.ts")) return null;
  if (isExempt(rel)) return null;

  // Match apps/<app>/src/<rest> or packages/<pkg>/src/<rest>.
  const match = rel.match(/^(apps|packages)\/([^/]+)\/src\/(.+)$/);
  if (!match) return null;

  const [, kind, ws, rest] = match;
  return `${kind}/${ws}/tests/unit/${rest}`;
}

/**
 * Rewrite every relative `import ... from "./foo"` (or "../bar", etc.)
 * inside `file` so that after the file moves from `oldPath` to `newPath`,
 * the import still resolves to the same on-disk target.
 *
 * Bare-module specifiers (`vitest`, `node:fs`, `@openwhispr/data`, …)
 * are untouched.
 */
export function rewriteImports(file: SourceFile, oldPath: string, newPath: string): void {
  const oldDir = posix.dirname(toPosix(oldPath));
  const newDir = posix.dirname(toPosix(newPath));
  for (const decl of file.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec.startsWith(".")) continue;
    // Resolve the absolute target the import currently points at, then
    // re-express it relative to the new directory.
    const absTarget = posix.normalize(posix.join(oldDir, spec));
    let nextSpec = posix.relative(newDir, absTarget);
    if (!nextSpec.startsWith(".")) nextSpec = `./${nextSpec}`;
    decl.setModuleSpecifier(nextSpec);
  }
  // Also rewrite `export ... from "./x"` re-exports.
  for (const decl of file.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec || !spec.startsWith(".")) continue;
    const absTarget = posix.normalize(posix.join(oldDir, spec));
    let nextSpec = posix.relative(newDir, absTarget);
    if (!nextSpec.startsWith(".")) nextSpec = `./${nextSpec}`;
    decl.setModuleSpecifier(nextSpec);
  }
}

/**
 * Scan every TypeScript source in `project` rooted under `repoRoot`,
 * returning a deduplicated, sorted Move[] list of co-located test files
 * that need to relocate. Re-running on an already-migrated tree yields
 * an empty array (idempotency).
 */
export function planMoves(project: Project, repoRoot: string): Move[] {
  const moves: Move[] = [];
  const seen = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    const abs = toPosix(sf.getFilePath());
    const rel = posix.relative(toPosix(repoRoot), abs);
    /* c8 ignore next — ts-morph Project.getSourceFiles() is already deduped by path; this is belt-and-braces. */
    if (seen.has(rel)) continue;
    seen.add(rel);
    const target = computeTargetPath(rel);
    if (target === null) continue;
    moves.push({ from: rel, to: target });
  }
  moves.sort((a, b) => a.from.localeCompare(b.from));
  return moves;
}

/** Infer workspace owner of a path (apps/<x>, packages/<x>, etc.). */
function inferWorkspace(rel: string): string {
  const m = rel.match(/^(apps|packages)\/([^/]+)\//);
  if (m) return `${m[1]}/${m[2]}`;
  /* c8 ignore next 2 — defensive fallback; planMoves only emits apps/* + packages/* paths. */
  return rel.split("/")[0] ?? rel;
}

/** Render the move list as a markdown table for committed inventory artifacts. */
export function renderInventory(moves: Move[]): string {
  const header = "| Source | Target | Workspace | Notes |\n| --- | --- | --- | --- |\n";
  const rows = moves.map((m) => `| ${m.from} | ${m.to} | ${inferWorkspace(m.from)} | |`).join("\n");
  return `${header}${rows}\n`;
}

/**
 * Execute or dry-run a Move[] against the ts-morph `project`.
 *
 * - `dryRun: true` performs NO file moves. If `inventoryPath` is supplied
 *   the inventory markdown table is written there via real-FS writeFileSync
 *   (the inventory is a committed artifact, not an in-project file).
 * - `dryRun: false` invokes `moveToDirectory` on each source file and
 *   rewrites relative imports inside the moved files via `rewriteImports`.
 *   The caller is responsible for persisting the project (`project.save()`)
 *   on real-filesystem projects; in-memory test projects skip that step.
 */
export async function applyMoves(
  project: Project,
  repoRoot: string,
  moves: Move[],
  opts: ApplyOpts,
): Promise<void> {
  if (opts.inventoryPath) {
    const text = renderInventory(moves);
    const dir = dirname(opts.inventoryPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(opts.inventoryPath, text, "utf8");
  }
  if (opts.dryRun) return;

  for (const m of moves) {
    const oldAbs = posix.join(toPosix(repoRoot), m.from);
    const newAbs = posix.join(toPosix(repoRoot), m.to);
    const sf = project.getSourceFile(oldAbs);
    if (!sf) continue;
    rewriteImports(sf, oldAbs, newAbs);
    sf.move(newAbs);
    // `sf.move()` is sufficient on in-memory FS; on real FS callers
    // should invoke `project.save()` after applyMoves returns.
  }
}

/**
 * Build a real-filesystem ts-morph project by globbing every co-located
 * `*.test.ts` under apps/, packages/, and tools/ (modulo exemptions),
 * then return the project + the planned moves.
 *
 * Branch coverage exempt — this is an integration glue function whose
 * branch surface (Set-dedup, isExempt filter) is independently covered
 * via planMoves() / computeTargetPath() unit tests. The single smoke
 * test (real tmpdir) asserts the end-to-end happy path.
 */
/* c8 ignore start */
export async function loadProject(repoRoot: string): Promise<{ project: Project; moves: Move[] }> {
  const project = new Project({
    useInMemoryFileSystem: false,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const realRoot = resolve(repoRoot);
  const patterns = ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"];
  const seen = new Set<string>();
  for (const pat of patterns) {
    for await (const f of glob(pat, {
      cwd: realRoot,
      exclude: ["**/node_modules/**", "**/dist/**"],
    })) {
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      if (isExempt(posixRel)) continue;
      project.addSourceFileAtPath(resolve(realRoot, rel));
    }
  }
  const moves = planMoves(project, realRoot);
  return { project, moves };
}
/* c8 ignore stop */

/* c8 ignore start */
export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  const invIdx = args.indexOf("--inventory");
  const inventoryPath = invIdx >= 0 ? args[invIdx + 1] : undefined;

  if (!dryRun && !apply) {
    process.stderr.write("usage: migrate-tests.ts (--dry-run [--inventory <path>] | --apply)\n");
    return 2;
  }
  if (dryRun && apply) {
    process.stderr.write("migrate-tests: cannot combine --dry-run and --apply\n");
    return 2;
  }

  const repoRoot = process.cwd();
  const { project, moves } = await loadProject(repoRoot);

  if (dryRun) {
    await applyMoves(project, repoRoot, moves, { dryRun: true, inventoryPath });
    process.stdout.write(
      `migrate-tests: dry-run planned ${moves.length} move(s)${
        inventoryPath ? ` (inventory: ${inventoryPath})` : ""
      }\n`,
    );
    if (!inventoryPath) {
      process.stdout.write(JSON.stringify(moves, null, 2));
      process.stdout.write("\n");
    }
    return 0;
  }

  await applyMoves(project, repoRoot, moves, { dryRun: false });
  await project.save();
  process.stdout.write(`migrate-tests: applied ${moves.length} move(s)\n`);
  return moves.length > 0 ? 1 : 0;
}

const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("migrate-tests.ts") || arg1.endsWith("migrate-tests.js");
})();
if (invokedDirect) {
  main(process.argv).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(`migrate-tests: ${err instanceof Error ? err.message : String(err)}\n`);
      exit(2);
    },
  );
}
/* c8 ignore stop */
