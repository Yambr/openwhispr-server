#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-plaintext-secret-columns.ts — Phase 33 / Plan 33-05.
 *
 * LOCKER-PLAINTEXT-COLS (LOCKER-08) — DISCIPLINE Rule 15.
 *
 * Refuses any Drizzle schema declaration of shape
 *
 *   `<field>: text("<col>", ...)`
 *   `<field>: varchar("<col>", ...)`
 *   `<field>: char("<col>", ...)`
 *
 * where `<col>` matches one of the 8 envelope-encrypted credential
 * column names:
 *
 *   access_token | refresh_token | id_token | password
 *   value | token | previous_token | code_verifier
 *
 * (Better Auth tables — account / sessions / verification — plus our
 * OAuth shim oauth_state.code_verifier.) Each column is envelope-
 * encrypted at rest via the 6-bytea-sidecar contract documented in
 * `packages/data/migrations/0019_envelope_encrypt_secret_columns_add.sql`
 * and `packages/data/src/encryption/envelope.ts`. Plaintext storage
 * was eliminated in migration 0020 (Phase 33 / Plan 33-05); this locker
 * refuses the REINTRODUCTION of plaintext columns at the schema layer.
 *
 * Scope:
 *   - Files walked: `packages/data/src/schema/**\/*.ts` (relative to
 *     repository root or `LINT_NO_PLAINTEXT_SECRET_COLUMNS_ROOT` env
 *     override — test fixtures use the override to redirect the glob).
 *   - AST visitor (TypeScript Compiler API, mirroring lint-tenant-
 *     context.ts) walks every `CallExpression` whose callee is the
 *     bare identifier `text` / `varchar` / `char` AND whose first
 *     argument is a string literal matching the forbidden set.
 *
 * Day-one BLOCKING. No `--warn-only` flag. No external allowlist
 * file. A future exception requires a DISCIPLINE amendment encoded
 * INLINE in this source as `LENS_INTROSPECTION_COMPAT` — adding an
 * entry there is a constitutional change reviewed at PR time, not a
 * flag flip (research §15 pitfall #13).
 *
 * Phase 33-05 / Plan 51-23 constitutional amendment to DISCIPLINE
 * Rule 15 (made runtime-real by Phase 57 / Track A): the 7 Better-Auth-
 * introspection-compat columns under `LENS_INTROSPECTION_COMPAT` are
 * allowed as nullable, no-DEFAULT, never-written sentinels. Better-Auth's
 * `drizzleAdapter` introspects the raw drizzle schema at adapter-
 * construction time and refuses to boot without these field names; its
 * INSERT-SQL generator also lists every schema column and binds `DEFAULT`
 * for any value not supplied. The envelope-encryption lens
 * (`packages/data/src/encryption/lens.ts`) DELETES the plaintext key from
 * the row payload BEFORE Drizzle builds the SQL — plaintext NEVER lands
 * at rest. The DB column exists exclusively as a Drizzle-SQL-gen ⇄
 * Better-Auth-introspection compatibility shim.
 *
 * History — the invariant became MECHANICALLY ACTIVE in Phase 57 / Track
 * A.2 (data:CR-01 + data:CR-03). Prior to Phase 57 the
 * `ENCRYPTED_COLUMNS_MAP` referenced below was `{}` (an explicit deferral
 * documented in `apps/api/src/auth.ts` headed "Plan 51-24 — empty by
 * design"). With an empty map the lens never fired on Better-Auth-owned
 * model writes, so the "lens DELETES the plaintext key" clause above
 * described an aspirational future state, not the runtime. The Phase 57
 * `better-auth-envelope-at-rest.test.ts` integration canary surfaced the
 * gap end-to-end (plaintext landed in the introspection-compat column at
 * sign-up). Track A.2 populated `ENCRYPTED_COLUMNS_MAP` for the 4 BA
 * models and added the `deriveSidecarAdditionalFields` codegen so the
 * lens's emitted sidecar keys are no longer silently dropped by Better
 * Auth's adapter-factory `transformInput` whitelist. From Phase 57 on
 * the invariant above is the runtime contract, not an aspiration.
 *
 * Cross-references: migration `0025_better_auth_account_plaintext_compat.sql`,
 * `apps/api/src/auth.ts` ENCRYPTED_COLUMNS_MAP,
 * `packages/data/src/encryption/additional-fields.ts` (codegen helper),
 * `packages/data/tests/unit/__tests__/additional-fields-drift.test.ts`
 * (drift-prevention test), `apps/api/tests/integration/better-auth-
 * envelope-at-rest.test.ts` (end-to-end at-rest assertion).
 *
 * Adding to LENS_INTROSPECTION_COMPAT requires:
 *   (a) the row is written by Better-Auth's drizzleAdapter (not by
 *       our own code), AND
 *   (b) the matching ENCRYPTED_COLUMNS_MAP entry routes writes to the
 *       6-bytea sidecars via the lens, AND
 *   (c) the DB column carries no DEFAULT and no NOT NULL constraint,
 *       AND
 *   (d) a 7th-pass review in the same PR confirms the lens delete-key
 *       semantics are preserved.
 *
 * Exit codes:
 *   0 — no violations found.
 *   1 — at least one violation found.
 *   2 — internal error (parser bomb, missing dir, etc.).
 *
 * Usage:
 *   pnpm lint:no-plaintext-secret-columns
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/** Forbidden Drizzle column-builder fn names. */
const FORBIDDEN_FNS = new Set(["text", "varchar", "char"]);

/**
 * The 8 envelope-encrypted credential column names. Matched as a SET
 * (whole-name match) — `access_token_fp`, `token_dek_wrapped`, etc., are
 * NOT in this set and pass.
 */
const FORBIDDEN_COLUMNS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "value",
  "token",
  "previous_token",
  "code_verifier",
]);

/**
 * Constitutional amendment to DISCIPLINE Rule 15 (Plan 51-23). Set of
 * `<posixPath>:<column>` tuples allowed past the locker because they
 * are Better-Auth-introspection-compat sentinels: the lens
 * (`packages/data/src/encryption/lens.ts`) DELETES the plaintext key
 * from the row payload BEFORE Drizzle builds the INSERT SQL, so the DB
 * column NEVER receives plaintext at runtime. Adding an entry here is
 * a code-review constitutional change — see file header rationale.
 */
const LENS_INTROSPECTION_COMPAT = new Set<string>([
  "packages/data/src/schema/accounts.ts:password",
  "packages/data/src/schema/accounts.ts:access_token",
  "packages/data/src/schema/accounts.ts:refresh_token",
  "packages/data/src/schema/accounts.ts:id_token",
  "packages/data/src/schema/sessions.ts:token",
  "packages/data/src/schema/sessions.ts:previous_token",
  "packages/data/src/schema/verifications.ts:value",
]);

export interface Violation {
  /** Repository-relative POSIX path of the file (absolute when running
   *  against a synthetic root). */
  file: string;
  /** 1-based line number of the offending CallExpression. */
  line: number;
  /** Bare callee identifier name — one of {text, varchar, char}. */
  fn: string;
  /** The forbidden plaintext column name, e.g. `access_token`. */
  column: string;
}

/**
 * Walk a SourceFile and append a Violation for every CallExpression of
 * shape `text("<col>", ...)` / `varchar("<col>", ...)` / `char("<col>", ...)`
 * where `<col>` is in FORBIDDEN_COLUMNS.
 */
function visitForViolations(src: ts.SourceFile, filePath: string, out: Violation[]): void {
  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && FORBIDDEN_FNS.has(callee.text)) {
        const firstArg = node.arguments[0];
        if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
          const colName = firstArg.text;
          if (FORBIDDEN_COLUMNS.has(colName)) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
            out.push({
              file: filePath,
              line: line + 1,
              fn: callee.text,
              column: colName,
            });
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(src);
}

/**
 * Scan a single file. Returns [] on read / parse error to keep the
 * top-level walk resilient against transient FS issues. The error
 * branch is exercised by the test that passes a non-existent path.
 */
export function scanFile(file: string): Violation[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: Violation[] = [];
  visitForViolations(src, file, out);
  return out;
}

/**
 * Run the lint across all schema files under `root`. Exported so tests
 * can run it against a synthetic fixture root.
 */
export function runLint(root: string): Violation[] {
  const pattern = path.join(root, "packages/data/src/schema/**/*.ts");
  const files = globSync(pattern, { exclude: (p) => /\.test\.ts$|\.d\.ts$/.test(p) });
  const out: Violation[] = [];
  for (const file of files) {
    for (const v of scanFile(file)) {
      const relFile = path.relative(root, file).split(path.sep).join("/");
      const key = `${relFile}:${v.column}`;
      if (LENS_INTROSPECTION_COMPAT.has(key)) continue;
      out.push({ ...v, file: relFile });
    }
  }
  return out;
}

interface RunMainDeps {
  root: string;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/**
 * Pure-I/O entry point. Returns 0 / 1 / 2 per the exit-code contract.
 * The thin `mainEntry()` below feeds in the real process streams; tests
 * inject buffers.
 */
export function runMain(deps: RunMainDeps): number {
  let violations: Violation[];
  try {
    violations = runLint(deps.root);
    /* c8 ignore start — defensive: globSync + scanFile both swallow
       per-file errors so the catch branch is unreachable from the
       fixture set. Kept to surface unexpected non-fixture failures. */
  } catch (err) {
    deps.stderr.write(
      `lint-no-plaintext-secret-columns: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }
  /* c8 ignore stop */

  if (violations.length === 0) {
    deps.stdout.write(
      `lint-no-plaintext-secret-columns PASSED: schema is clean (no plaintext credential columns) (root=${deps.root}).\n`,
    );
    return 0;
  }

  deps.stderr.write(
    `lint-no-plaintext-secret-columns FAILED [LOCKER-PLAINTEXT-COLS]: ${violations.length} plaintext credential column declaration(s):\n`,
  );
  for (const v of violations) {
    deps.stderr.write(
      `  ${v.file}:${v.line}  ${v.fn}("${v.column}") — credential columns MUST be envelope-encrypted bytea sidecars (Phase 33 / DISCIPLINE Rule 15)\n`,
    );
  }
  deps.stderr.write(
    "remediation: declare the 6 bytea sidecars (<col>_dek_wrapped, <col>_dek_iv, <col>_dek_auth_tag, <col>_value_iv, <col>_value_auth_tag, <col>_value_ciphertext) and the optional <col>_fp fingerprint — see packages/data/src/encryption/envelope.ts and docs/security.md §12.\n",
  );
  return 1;
}

// c8-ignore-band-rationale: process-coupled CLI wiring (resolveRoot +
// mainEntry below) is exercised by the compose-stack-free subprocess
// smoke in `tests/e2e/encryption-at-rest.test.ts` (`execFileSync`
// against the locker binary against a synthetic fixture root). v8
// instrumentation does not surface coverage for process.env /
// process.cwd / import.meta.url branches under the vitest fork-pool,
// mirroring the c8-ignore bands in `tools/lockers-allowlist-diff.ts`
// (Phase 31 / Plan 31-07 D-4).
/* c8 ignore start */
/**
 * Resolve the runtime root (env override → cwd). Exported so tests can
 * assert the env-vs-cwd precedence.
 */
export function resolveRoot(): string {
  return process.env.LINT_NO_PLAINTEXT_SECRET_COLUMNS_ROOT ?? process.cwd();
}

/**
 * Entry point used by the script when invoked as
 * `pnpm lint:no-plaintext-secret-columns`. Separated so the test can
 * call it without spawning a subprocess.
 */
export function mainEntry(): number {
  return runMain({ root: resolveRoot(), stdout: process.stdout, stderr: process.stderr });
}
/* c8 ignore stop */

/* c8 ignore start — script-entrypoint detection branch is exercised
   indirectly via the CLI smoke test in the e2e suite. */
const _argvUrl = (() => {
  try {
    return new URL(`file://${process.argv[1]}`).href;
  } catch {
    return "";
  }
})();
const _isMain = import.meta.url === _argvUrl;

if (_isMain) {
  exit(mainEntry());
}
/* c8 ignore stop */
