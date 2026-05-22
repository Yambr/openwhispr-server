// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-03 — Node-side backfill migrator (CRIT-FIX-02 step 3).
//
// What this file IS:
//   A programmatic, idempotent backfill that reads existing plaintext from
//   the 8 Better-Auth credential columns added by migration 0019, encrypts
//   each row's value via `envelope.encryptValue`, and writes the 6 bytea
//   sidecars (+ optional SHA-256 fingerprint sidecar for `sessions.token_fp`
//   / `sessions.previous_token_fp`) alongside the row. The plaintext column
//   is left intact — Plan 33-05's migration 0020 drops plaintext columns.
//
// What this file is NOT:
//   - It is NOT auto-invoked by `packages/data/src/migrate.ts`. Per CONTEXT
//     D-Migration-split: a rollback of 0019 must remain a single-SQL-file
//     operation. If backfill ran inline with `migrate()`, the rollback path
//     would need to un-encrypt — operationally fragile. The operator invokes
//     this code via the standalone CLI (cli/backfill-encrypt-credentials.ts)
//     AFTER 0019 lands, BEFORE 33-05's 0020 lands.
//   - It does NOT use the app-pool. RLS fail-closed posture (Phase 32) would
//     mask all rows since `app.tenant_id` is unset for a cross-tenant
//     migrator. Backfill uses the owner-pool (BYPASSRLS) that already powers
//     `packages/data/src/migrate.ts`.
//   - It does NOT call the lens (33-02). The lens is a read/write
//     interceptor on the live Better-Auth path; backfill is a one-shot
//     bulk migrator that bypasses Better-Auth entirely and writes directly
//     to the DB.
//
// Idempotency invariant:
//   The predicate `WHERE <col> IS NOT NULL AND <col>_value_ciphertext IS NULL`
//   captures both (a) fresh post-0019 rows and (b) partially-completed prior
//   runs that crashed mid-batch. A second invocation against a fully
//   backfilled DB processes 0 rows. Pitfall #7 mitigation: deploy lens
//   (33-04) BEFORE running this backfill so new rows are encrypted at write,
//   then backfill mops up legacy plaintext without racing concurrent app writes.

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { encryptValue } from "./envelope.js";
import type { KeyProvider } from "./key-provider.js";

export interface BackfillColumnConfig {
  /**
   * Optional fingerprint sidecar column. When set, a SHA-256 digest of the
   * plaintext is written to the named column in the same UPDATE statement.
   * For `sessions.token` → `token_fp`; for `sessions.previous_token` →
   * `previous_token_fp`. All other credential columns omit this.
   */
  readonly fingerprintColumn?: string;
}

/** `{ [table]: { [column]: BackfillColumnConfig } }` */
export type BackfillColumnMap = Readonly<
  Record<string, Readonly<Record<string, BackfillColumnConfig>>>
>;

export interface BackfillColumnResult {
  scanned: number;
  encrypted: number;
  skipped: number;
  durationMs: number;
}

/** `{ [table]: { [column]: BackfillColumnResult } }` */
export type BackfillReport = Record<string, Record<string, BackfillColumnResult>>;

export interface RunBackfillOpts {
  readonly ownerPool: Pool;
  readonly keyProvider: KeyProvider;
  readonly columnMap: BackfillColumnMap;
  readonly dryRun?: boolean;
  /** Default 500. Caps memory per TX. */
  readonly batchSize?: number;
  /**
   * AUDIT-HARD-03 — safety cap on the per-column batched loop. Default
   * `MAX_BACKFILL_ITERATIONS`. Exceeding it throws rather than spinning
   * forever on a buggy idempotency predicate. Injectable so tests can
   * exercise the cap with a small value.
   */
  readonly maxIterations?: number;
  /** Optional structured logger (pino-shape). Default: silent. */
  readonly logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

// Phase 67 / Plan 67-01 — HI-04: lens-managed-column guard.
//
// Post-Phase-57 Track A, `apps/api/src/auth.ts` ships a POPULATED
// `ENCRYPTED_COLUMNS_MAP` — the envelope-encryption lens now encrypts these
// Better-Auth-owned credential columns on EVERY write. A bulk `runBackfill`
// over them is therefore (a) unnecessary — the lens already encrypts them —
// and (b) data-corrupting: it writes ciphertext into the bytea sidecars while
// leaving the plaintext column populated, so a later lens read decrypts the
// sidecars and silently overwrites Better Auth's live plaintext credential.
//
// This static refuse-list mirrors `ENCRYPTED_COLUMNS_MAP`. NOTE the table-name
// skew: `ENCRYPTED_COLUMNS_MAP` keys the sessions model as `session` (the
// Better-Auth model name) while the SQL table and the backfill column-map use
// `sessions` (plural) — both forms are listed so the guard cannot be bypassed.
// `oauth_state.code_verifier` is NOT here: it is codec-managed (manual codec),
// not lens-managed, so backfilling it is still legitimate.
const LENS_MANAGED_COLUMNS: ReadonlySet<string> = new Set([
  "account.password",
  "account.access_token",
  "account.refresh_token",
  "account.id_token",
  "session.token",
  "sessions.token",
  "session.previous_token",
  "sessions.previous_token",
  "verification.value",
]);

// AUDIT-HARD-03 (HACK-L5) — safety cap on the batched backfill loop.
//
// The loop's only natural exits are `rows.length === 0` and
// `batchProcessed < batchSize` — both rely on the idempotency predicate
// (`<col> IS NOT NULL AND <col>_value_ciphertext IS NULL`) shrinking the
// result set as rows are encrypted. A buggy predicate, a column-map skew,
// or a UPDATE that silently fails to populate the ciphertext sidecar would
// leave a full batch eligible forever → an infinite spin holding an
// owner-pool connection. This cap converts that failure mode into a loud,
// fast error. The bound is generous: at the default batchSize of 500 it
// covers 500M rows, far beyond any credential table in this system.
const MAX_BACKFILL_ITERATIONS = 1_000_000;

const SIDECAR_SUFFIXES = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

/**
 * Backfill the 8 credential columns described by `columnMap`. Returns a
 * per-(table,column) report with scanned/encrypted/skipped row counts and
 * per-column duration. Re-invocation against a fully backfilled DB is a
 * no-op (encrypted=0 across all entries).
 *
 * When `dryRun` is true: SELECT counts only; no UPDATE statements issued.
 */
export async function runBackfill(opts: RunBackfillOpts): Promise<BackfillReport> {
  const {
    ownerPool,
    keyProvider,
    columnMap,
    dryRun = false,
    batchSize = 500,
    maxIterations = MAX_BACKFILL_ITERATIONS,
    logger,
  } = opts;
  const report: BackfillReport = {};

  for (const [table, cols] of Object.entries(columnMap)) {
    report[table] = {};
    for (const [column, cfg] of Object.entries(cols)) {
      // HI-04 guard: refuse any column the encryption lens already manages at
      // write-time. Throws BEFORE the dry-run branch / any SQL — a bulk
      // backfill of these columns would corrupt the row (plaintext +
      // ciphertext coexisting). See LENS_MANAGED_COLUMNS above.
      if (LENS_MANAGED_COLUMNS.has(`${table}.${column}`)) {
        throw new Error(
          `[backfill] ${table}.${column} is a lens-managed credential column: ` +
            `the envelope-encryption lens encrypts it at write-time ` +
            `(apps/api ENCRYPTED_COLUMNS_MAP, Phase 57). A bulk backfill is ` +
            `unnecessary and data-corrupting (plaintext + ciphertext would ` +
            `coexist; a later lens read silently overwrites the live ` +
            `plaintext). Refusing to process this column.`,
        );
      }
      const started = Date.now();
      // Quoted identifiers — table+column names are author-controlled
      // (column-map literal), never user input. No SQL injection surface
      // beyond what the lens column-map already exposes (same threat
      // model as `packages/data/src/encryption/lens.ts`).
      const ciphertextCol = `${column}_value_ciphertext`;
      const idempotencyWhere = `"${column}" IS NOT NULL AND "${ciphertextCol}" IS NULL`;

      // Dry-run: just count.
      if (dryRun) {
        const { rows } = await ownerPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM "${table}" WHERE ${idempotencyWhere}`,
        );
        const scanned = Number(rows[0]!.c);
        report[table]![column] = {
          scanned,
          encrypted: 0,
          skipped: scanned,
          durationMs: Date.now() - started,
        };
        logger?.info(
          { table, column, scanned, mode: "dry-run" },
          "[backfill] dry-run column scan complete",
        );
        continue;
      }

      let scanned = 0;
      let encrypted = 0;
      // Batched loop: each iteration SELECTs up to `batchSize` rows, encrypts
      // them in Node, and UPDATEs them one-by-one within a single transaction
      // per batch. The predicate is the idempotency guard, so processed rows
      // fall out of the result set on the next iteration even without an
      // OFFSET — preventing batch drift.
      let iterations = 0;
      for (;;) {
        // AUDIT-HARD-03 — defensive iteration cap. See MAX_BACKFILL_ITERATIONS.
        iterations += 1;
        if (iterations > maxIterations) {
          throw new Error(
            `[backfill] ${table}.${column}: exceeded ${maxIterations} ` +
              `iterations without draining the work set — aborting to avoid an ` +
              `infinite spin. This indicates a buggy idempotency predicate or an ` +
              `UPDATE that is not populating the "${ciphertextCol}" sidecar.`,
          );
        }
        const client = await ownerPool.connect();
        let batchProcessed = 0;
        try {
          await client.query("BEGIN");
          const { rows } = await client.query<{ id: string; value: string }>(
            `SELECT "id", "${column}" AS value
             FROM "${table}"
             WHERE ${idempotencyWhere}
             ORDER BY "id"
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [batchSize],
          );

          if (rows.length === 0) {
            await client.query("COMMIT");
            break;
          }
          scanned += rows.length;

          // Build the UPDATE statement once per column — same shape for all
          // rows in this batch. Set 6 sidecars + optional fingerprint.
          const setFragments = SIDECAR_SUFFIXES.map((suf, i) => `"${column}_${suf}" = $${i + 1}`);
          let paramOffset = SIDECAR_SUFFIXES.length;
          if (cfg.fingerprintColumn) {
            paramOffset += 1;
            setFragments.push(`"${cfg.fingerprintColumn}" = $${paramOffset}`);
          }
          const updateSql = `UPDATE "${table}" SET ${setFragments.join(", ")} WHERE "id" = $${paramOffset + 1}`;

          for (const r of rows) {
            const enc = await encryptValue(keyProvider, Buffer.from(r.value, "utf8"));
            const params: unknown[] = [
              enc.dek_wrapped,
              enc.dek_iv,
              enc.dek_auth_tag,
              enc.value_iv,
              enc.value_auth_tag,
              enc.value_ciphertext,
            ];
            if (cfg.fingerprintColumn) {
              params.push(createHash("sha256").update(r.value, "utf8").digest());
            }
            params.push(r.id);
            await client.query(updateSql, params);
            batchProcessed += 1;
          }
          await client.query("COMMIT");
          encrypted += batchProcessed;
        } catch (err) {
          // Roll back the in-flight batch. Already-committed batches stay —
          // the idempotency predicate guarantees a re-run only touches the
          // remainder. NEVER log the plaintext value or DEK material.
          try {
            await client.query("ROLLBACK");
          } catch {
            /* swallow — original error is the signal */
          }
          throw new Error(
            `[backfill] ${table}.${column}: aborted after ${encrypted} encrypted rows (in-flight batch rolled back): ${(err as Error).message}`,
          );
        } finally {
          client.release();
        }

        if (batchProcessed < batchSize) break;
      }

      report[table]![column] = {
        scanned,
        encrypted,
        skipped: 0,
        durationMs: Date.now() - started,
      };
      logger?.info(
        { table, column, scanned, encrypted, durationMs: Date.now() - started },
        "[backfill] column complete",
      );
    }
  }

  return report;
}
