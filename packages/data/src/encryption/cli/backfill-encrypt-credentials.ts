// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-03 — Standalone CLI: encrypt-credentials backfill.
//
// Invocation:
//   pnpm --filter @openwhispr/data data:backfill-encrypt [--dry-run] [--batch-size=N]
//
// Why standalone: the backfill MUST NOT be invoked inline by `migrate.ts`
// (D-Migration-split — see backfill.ts header). The operator runs this AFTER
// migration 0019 lands and AFTER Plan 33-04's lens is deployed, BEFORE
// Plan 33-05's plaintext-drop migration 0020.
//
// Env:
//   - DATABASE_URL_OWNER (preferred) or DATABASE_URL — owner-pool URI
//     (must connect as a BYPASSRLS role; this is a cross-tenant migrator).
//   - MASTER_KEK — validated via validateEncryptionBoot() before opening pool.
//   - OPENWHISPR_KEY_PROVIDER — must be "env" (or unset) in v1.
//
// Exit codes:
//   0  — success (also when scanned=0 across all columns).
//   1  — runtime error (DB unreachable, encryption mid-batch failure, etc.).
//   78 — EX_CONFIG (MASTER_KEK missing/malformed, unsupported provider).

import { Pool } from "pg";
import { validateEncryptionBoot } from "../boot.js";
import { selectProvider } from "../key-provider.js";
import {
  type BackfillColumnMap,
  type BackfillReport,
  runBackfill,
} from "../backfill.js";

/**
 * Canonical column-map for the 8 Better-Auth credential columns +
 * 2 fingerprint sidecars on `sessions`. Source of truth for the
 * CLI default invocation; the programmatic API accepts an arbitrary
 * column-map for tests / partial replays.
 */
export const DEFAULT_COLUMN_MAP: BackfillColumnMap = {
  account: {
    access_token: {},
    refresh_token: {},
    id_token: {},
    password: {},
  },
  verification: {
    value: {},
  },
  sessions: {
    token: { fingerprintColumn: "token_fp" },
    previous_token: { fingerprintColumn: "previous_token_fp" },
  },
  oauth_state: {
    code_verifier: {},
  },
};

export interface CliArgs {
  dryRun: boolean;
  batchSize: number;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let dryRun = false;
  let batchSize = 500;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--batch-size=")) {
      const v = Number.parseInt(a.slice("--batch-size=".length), 10);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`[backfill-cli] --batch-size requires a positive integer (got: ${a})`);
      }
      batchSize = v;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      // eslint-disable-next-line no-process-exit -- intentional CLI exit
      process.exit(0);
    } else {
      throw new Error(`[backfill-cli] unknown argument: ${a}`);
    }
  }
  return { dryRun, batchSize };
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: backfill-encrypt-credentials [options]",
      "",
      "Options:",
      "  --dry-run         Scan + count without writing.",
      "  --batch-size=N    Rows per UPDATE batch (default 500).",
      "  -h, --help        Show this message.",
      "",
      "Env: DATABASE_URL_OWNER (or DATABASE_URL), MASTER_KEK, OPENWHISPR_KEY_PROVIDER.",
      "",
    ].join("\n"),
  );
}

export function resolveOwnerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL_OWNER ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[backfill-cli] DATABASE_URL_OWNER (or DATABASE_URL) must be set to an openwhispr_owner connection string",
    );
  }
  return url;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  // 1) Configuration validation — fails fast with EX_CONFIG (78).
  validateEncryptionBoot(process.env);

  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  let ownerUrl: string;
  try {
    ownerUrl = resolveOwnerUrl();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const provider = selectProvider();
  const pool = new Pool({ connectionString: ownerUrl });
  let report: BackfillReport;
  try {
    report = await runBackfill({
      ownerPool: pool,
      keyProvider: provider,
      columnMap: DEFAULT_COLUMN_MAP,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
    });
  } catch (err) {
    // NEVER include row payloads in the log line — runBackfill already
    // strips plaintext from its error messages; we just print verbatim.
    process.stderr.write(`[backfill-cli] FATAL: ${(err as Error).message}\n`);
    /* v8 ignore next 3 -- pool.end() catch is a defensive nop for double-close races */
    await pool.end().catch(() => {
      /* nothing actionable */
    });
    return 1;
  }

  await pool.end();
  process.stdout.write(`${JSON.stringify({ dryRun: args.dryRun, report }, null, 2)}\n`);
  return 0;
}

// CLI bootstrap: only execute when invoked directly, not when imported by
// the unit-test harness (which calls `main()` itself with a controlled argv).
// The thin bootstrap is excluded from coverage — it is exercised by the
// `data:backfill-encrypt` pnpm script, not from vitest.
/* v8 ignore start -- CLI bootstrap; exercised via pnpm script */
const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`[backfill-cli] UNCAUGHT: ${(err as Error).stack ?? err}\n`);
      process.exit(1);
    },
  );
}
/* v8 ignore stop */
