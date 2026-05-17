// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 1 — Client-id upsert helper (D-24, Pattern 1).
//
// Centralizes the "INSERT OR RETURN EXISTING" semantics for every CRUD
// resource family that carries a partial-UNIQUE `client_<resource>_id`
// column (notes, folders, conversations, messages, transcriptions).
//
// Behavior (Pattern 1 from RESEARCH § Architecture Patterns):
//   1. INSERT … ON CONFLICT (tenant_id, user_id, <client_id_column>)
//      WHERE <client_id_column> IS NOT NULL DO NOTHING RETURNING *.
//   2. If RETURNING yielded a row → {row, created: true}.
//   3. Else (conflict path) → SELECT WHERE (tenant_id, user_id, client_id)
//      and return {row, created: false}.
//
// Why explicit SELECT fallback rather than `ON CONFLICT … DO UPDATE
// SET id=id RETURNING *`:
//   * The DO UPDATE trick writes a new row version (bloat, WAL noise,
//     trigger fire) just to coerce RETURNING. The SELECT path is
//     idempotent and observably read-only on conflict — which matches
//     the desktop client's mental model of "I retried with the same
//     client_note_id; the server can tell me NOTHING changed".
//   * Tests assert created=false on the conflict path; UPDATE-trick
//     callers would have to inspect xmax to make the same distinction.
//
// Null-clientId case:
//   When the caller does NOT provide a clientId (NoteInput.client_note_id
//   is optional per upstream interface), we MUST always INSERT. Per
//   Pitfall #2: a NULL client_note_id is NEVER considered a conflict by
//   the partial UNIQUE index (`WHERE client_note_id IS NOT NULL`) — so
//   two notes with no client id legitimately coexist. The helper detects
//   the null path and skips the ON CONFLICT clause entirely.
//
// Tenant binding:
//   Caller MUST invoke this inside `withTenant(deps.db, tenantId, …)`
//   so the FORCE-RLS policy `tenant_id = current_setting('app.tenant_id')`
//   gates both the INSERT and the fallback SELECT. The helper does
//   NOT set the GUC itself — that would double-set it inside a nested
//   transaction and silently misbehave under PgBouncer transaction-mode.

import type { ExecutableTx } from "@openwhispr/data";
import { type SQL, sql } from "drizzle-orm";

export interface UpsertParams {
  /** Postgres table name (untrusted-input-free; caller passes a literal). */
  table: string;
  /** Column that carries the desktop's stable client identifier. */
  clientIdColumn: string;
  /** Tenant UUID — used in the SELECT fallback's WHERE clause. */
  tenantId: string;
  /** Owning user UUID — used in the SELECT fallback's WHERE clause. */
  userId: string;
  /** Stable client id from the request body (may be null/undefined). */
  clientIdValue: string | null | undefined;
  /**
   * Column-name → SQL/value map for the INSERT. Caller is responsible
   * for ensuring every key matches a real column. Keys are emitted
   * verbatim so they MUST come from a static allowlist on the caller
   * side (no untrusted column names).
   */
  insertValues: Record<string, unknown>;
}

export interface UpsertResult<T> {
  row: T;
  created: boolean;
}

/**
 * Validate a table or column identifier against a strict allow-pattern.
 * `[a-z_][a-z0-9_]*` matches every column name used by Phase 5 schemas
 * (notes / folders / conversations / messages / transcriptions). Defends
 * against ever-so-slightly-untrusted callers shipping `; DROP TABLE`.
 * Callers passing literal strings ALWAYS pass; this is belt-and-braces.
 */
const SAFE_IDENT_RE = /^[a-z_][a-z0-9_]*$/;
function quoteIdent(name: string): string {
  if (!SAFE_IDENT_RE.test(name)) {
    throw new Error(`client-id-upsert: unsafe identifier "${name}"`);
  }
  return `"${name}"`;
}

/**
 * Pattern 1 — INSERT … ON CONFLICT DO NOTHING + SELECT fallback.
 *
 * Returns `{row, created}` where created=true iff the INSERT produced
 * a RETURNING row.
 */
// Phase 52 / Plan 52-04b — `T extends Record<string, unknown>` was
// purely cosmetic (the function never indexes T; T only flows through
// as the RETURNING row type). The constraint refused
// `CloudConversationRow` / `CloudNoteRow` / etc. because their
// typed-property-bag shape doesn't auto-satisfy `Record<string,
// unknown>` (TS index-signature rule). Relax to `object` — still
// rejects `string | number | boolean`, still types the return row.
export async function createOrReturnExisting<T extends object>(
  tx: ExecutableTx,
  params: UpsertParams,
): Promise<UpsertResult<T>> {
  const tbl = quoteIdent(params.table);
  const cidCol = quoteIdent(params.clientIdColumn);

  const columns = Object.keys(params.insertValues);
  for (const c of columns) quoteIdent(c);
  const colList = columns.map((c) => quoteIdent(c)).join(", ");

  // Build values list via Drizzle's sql template tag — params bind at
  // the protocol level (no string interpolation of untrusted scalars).
  const valueFragments = columns.map((c) => sql`${params.insertValues[c]}`);
  const valuesSql = sqlJoin(valueFragments, sql`, `);

  if (params.clientIdValue === null || params.clientIdValue === undefined) {
    // Null clientId path — ALWAYS insert (Pitfall #2). The partial
    // UNIQUE index (WHERE client_<resource>_id IS NOT NULL) never
    // considers NULL a conflict, so retries with no client id would
    // legitimately produce duplicate rows. Caller's responsibility to
    // avoid that (e.g. desktop client always sends a client id today).
    const insert = sql.raw(`INSERT INTO ${tbl} (${colList}) VALUES `);
    const tail = sql.raw(` RETURNING *`);
    const result = (await tx.execute(sql`${insert}(${valuesSql})${tail}`)) as { rows?: T[] };
    const row = result.rows?.[0];
    if (!row) {
      throw new Error("client-id-upsert: INSERT RETURNING produced no row");
    }
    return { row, created: true };
  }

  // ON CONFLICT path — D-24 partial UNIQUE on
  // (tenant_id, user_id, <client_id_column>) WHERE <client_id_column>
  // IS NOT NULL DO NOTHING. The constraint name is derived per-table
  // by Plan 01's CREATE UNIQUE INDEX statements — we rely on the
  // column tuple match rather than naming the constraint explicitly.
  const insertHead = sql.raw(`INSERT INTO ${tbl} (${colList}) VALUES `);
  const conflictTail = sql.raw(
    ` ON CONFLICT ("tenant_id", "user_id", ${cidCol}) WHERE ${cidCol} IS NOT NULL DO NOTHING RETURNING *`,
  );
  const insertResult = (await tx.execute(sql`${insertHead}(${valuesSql})${conflictTail}`)) as {
    rows?: T[];
  };
  const insertedRow = insertResult.rows?.[0];
  if (insertedRow) {
    return { row: insertedRow, created: true };
  }

  // Conflict path — SELECT existing row.
  const selectHead = sql.raw(`SELECT * FROM ${tbl} WHERE "tenant_id" = `);
  const selectMid = sql.raw(`::uuid AND "user_id" = `);
  const selectMid2 = sql.raw(`::uuid AND ${cidCol} = `);
  const selectTail = sql.raw(` LIMIT 1`);
  const selectResult = (await tx.execute(
    sql`${selectHead}${params.tenantId}${selectMid}${params.userId}${selectMid2}${params.clientIdValue}${selectTail}`,
  )) as { rows?: T[] };
  const existingRow = selectResult.rows?.[0];
  if (!existingRow) {
    // Race: INSERT lost the conflict AND the row vanished. Either the
    // conflicting row got deleted between INSERT and SELECT (rare), or
    // the partial UNIQUE constraint doesn't match what we think it does.
    throw new Error(
      "client-id-upsert: ON CONFLICT path but no existing row found (race or constraint mismatch)",
    );
  }
  return { row: existingRow, created: false };
}

function sqlJoin(parts: SQL[], glue: SQL): SQL {
  if (parts.length === 0) return sql``;
  let out: SQL = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    out = sql`${out}${glue}${parts[i]!}`;
  }
  return out;
}
