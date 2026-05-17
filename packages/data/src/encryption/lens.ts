// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 02 — Better-Auth Adapter encryption lens (wrap-adapter).
//
// Research §Q6 architecture (c): wrap Better-Auth's `DBAdapter` and
// intercept every CRUD method. On write paths (`create`, `update`,
// `updateMany`), each configured plaintext credential column is
// encrypted via envelope.ts and expanded into 6 bytea sidecar fields
// (`<col>_dek_wrapped`, `<col>_dek_iv`, `<col>_dek_auth_tag`,
// `<col>_value_iv`, `<col>_value_auth_tag`, `<col>_value_ciphertext`)
// alongside the plaintext key (set to `null`). When `fingerprint` is
// configured, a SHA-256 of the plaintext is also written to the
// fingerprint column.
//
// On read paths (`findOne`, `findMany`), the lens detects the 6
// sidecar fields, calls `decryptValue` to recover the plaintext, binds
// it back to the original column name, and strips the sidecars from
// the returned row. Rows missing all sidecars (legacy plaintext window
// during the 33-03 backfill) pass through unchanged — the lens NEVER
// guesses ciphertext from an absent sidecar set.
//
// `where`-clause rewrite: any clause whose `field` ends in
// `_fp_lookup` is converted before delegation: the plaintext `value`
// is SHA-256 hashed, the field is rewritten to the fingerprint column
// (declared in the column-map), and the value becomes the bytea(32)
// digest. This lets routes search by token plaintext without ever
// querying the encrypted ciphertext.
//
// KEK rotation: callers may pass an array of `KeyProvider`s. Index 0
// is the *active* provider used for all writes (wrapDek). Reads try
// each provider in order until `decryptValue` succeeds — the GCM
// auth-tag mismatch on the dek_wrapped layer for the wrong provider
// is the canonical "this row was written under a different KEK" signal.
// Once the value layer is reached, any tamper there propagates without
// fallback (no provider can recover from value-layer corruption).
//
// Why the lens does NOT cache the KEK locally: KeyProvider impls cache
// internally (EnvKeyProvider caches per-instance; Vault/KMS will use
// their own TTL strategies). Lens treats KeyProvider as a black box.
//
// Pitfall #4 (DEK leak via thrown error stack): the lens NEVER
// includes row payload or column values in error messages — only the
// model + column name. envelope.ts already zeroizes DEKs in `finally`;
// the lens does not re-introduce them anywhere.
import { createHash } from "node:crypto";
import type { CleanedWhere } from "@better-auth/core/db/adapter";
// Phase 52 / Plan 52-02 — better-auth@1.6.9 re-exports `Where` and
// `DBAdapter` but NOT `CleanedWhere`; the latter lives in
// `@better-auth/core/db/adapter` (peer of better-auth) as
// `Required<Where>`. Import each from its actual public surface to
// keep the lens typecheck-green and preserve nominal identity with the
// upstream Better Auth adapter contract.
import type { DBAdapter, Where } from "better-auth";
import { decryptValue, type EncryptedRow, encryptValue } from "./envelope.js";
import type { KeyProvider } from "./key-provider.js";

/**
 * Per-column encryption configuration. The `sidecarPrefix` controls
 * the bytea-field naming (`<prefix>_dek_wrapped`, etc.); for the
 * 8 Better-Auth credential columns this matches the plaintext column
 * name 1:1 (e.g. `access_token` → `access_token_value_ciphertext`).
 *
 * `fingerprint`, when set, makes the lens also write a SHA-256 of the
 * plaintext to the named column. The fingerprint enables `*_fp_lookup`
 * where-clauses (see file header) for indexed lookup-by-plaintext
 * (e.g. session-token-resolution) without re-encrypting.
 */
export interface FingerprintColumn {
  readonly column: string;
  readonly algorithm: "sha256";
}

export interface EncryptedColumnConfig {
  readonly sidecarPrefix: string;
  readonly fingerprint?: FingerprintColumn;
  /**
   * Phase 41.e / HI-03 — opt-in TTL enforcement at the lens layer.
   *
   * When set, after the lens successfully decrypts the column, it reads
   * `row[expiresColumn]` and — if the value is a `Date` (or ISO string)
   * in the past — throws `AccountTokenExpiredError`. `null` / `undefined`
   * is treated as "no expiry" and passes through.
   *
   * Defense-in-depth against route handlers that consume a decrypted
   * OAuth bearer without explicit `expires_at > now()` filtering. See
   * .planning/review/data.md HI-03 + 41-e-DECISIONS §D-3.
   */
  readonly expiresColumn?: string;
}

/**
 * Phase 41.e / HI-03 — thrown by the lens on read paths when an
 * `expiresColumn`-configured column is past its expiry. Carries
 * (model, column, expiresAt) diagnostic context. Per Pitfall #4 the
 * message NEVER includes plaintext payload — only model + column names
 * and the expiry timestamp.
 */
export class AccountTokenExpiredError extends Error {
  override readonly name = "AccountTokenExpiredError";
  readonly model: string;
  readonly column: string;
  readonly expiresAt: Date;

  constructor(model: string, column: string, expiresAt: Date) {
    super(
      `lens: ${model}.${column} expired at ${expiresAt.toISOString()} — refusing to surface plaintext`,
    );
    this.model = model;
    this.column = column;
    this.expiresAt = expiresAt;
  }
}

/** `{ [model]: { [column]: EncryptedColumnConfig } }` */
export type EncryptedColumnMap = Readonly<
  Record<string, Readonly<Record<string, EncryptedColumnConfig>>>
>;

const SIDECAR_KEYS = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const satisfies readonly (keyof EncryptedRow)[];

function sidecarFieldName(prefix: string, key: (typeof SIDECAR_KEYS)[number]): string {
  return `${prefix}_${key}`;
}

function fingerprintBytes(plaintext: string, algorithm: "sha256"): Buffer {
  return createHash(algorithm).update(plaintext).digest();
}

/**
 * Encrypt one plaintext value and merge the 6 sidecars (+ optional
 * fingerprint) into `target`. The plaintext key is set to `null` —
 * Phase 33-05 drops the plaintext columns, after which this no-op'd
 * null assignment becomes a column the schema doesn't have (Drizzle
 * silently ignores unknown columns on insert).
 */
async function encryptInto(
  target: Record<string, unknown>,
  column: string,
  plaintext: string,
  config: EncryptedColumnConfig,
  provider: KeyProvider,
): Promise<void> {
  const row = await encryptValue(provider, Buffer.from(plaintext, "utf8"));
  for (const key of SIDECAR_KEYS) {
    target[sidecarFieldName(config.sidecarPrefix, key)] = row[key];
  }
  if (config.fingerprint) {
    target[config.fingerprint.column] = fingerprintBytes(plaintext, config.fingerprint.algorithm);
  }
  target[column] = null;
}

/**
 * If the row carries the full 6-sidecar set for `column`, decrypt the
 * value, bind it back to the column name, and strip the sidecars +
 * fingerprint from `target`. If sidecars are absent or partial, leave
 * the row alone — supports the 33-03 backfill mid-window where legacy
 * rows still serve plaintext from the original column.
 */
/**
 * Phase 41.e / HI-03 — coerce a raw `expires_at` cell into a `Date`,
 * accepting Date instances and ISO-8601 strings (the two shapes pg
 * drivers and JSON-deserialised payloads produce). Returns `null` on
 * `null` / `undefined` / unparseable input.
 */
function coerceExpiresAt(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function decryptFrom(
  target: Record<string, unknown>,
  column: string,
  config: EncryptedColumnConfig,
  providers: readonly KeyProvider[],
  model: string,
): Promise<void> {
  const sidecarPresent = SIDECAR_KEYS.every((k) => {
    const v = target[sidecarFieldName(config.sidecarPrefix, k)];
    return Buffer.isBuffer(v);
  });
  if (!sidecarPresent) return;

  const encryptedRow: EncryptedRow = {
    dek_wrapped: target[sidecarFieldName(config.sidecarPrefix, "dek_wrapped")] as Buffer,
    dek_iv: target[sidecarFieldName(config.sidecarPrefix, "dek_iv")] as Buffer,
    dek_auth_tag: target[sidecarFieldName(config.sidecarPrefix, "dek_auth_tag")] as Buffer,
    value_iv: target[sidecarFieldName(config.sidecarPrefix, "value_iv")] as Buffer,
    value_auth_tag: target[sidecarFieldName(config.sidecarPrefix, "value_auth_tag")] as Buffer,
    value_ciphertext: target[sidecarFieldName(config.sidecarPrefix, "value_ciphertext")] as Buffer,
  };

  // Provider chain: try each in order. On the FIRST successful
  // decrypt, bind plaintext + strip sidecars. If every provider fails,
  // rethrow the LAST error so the caller sees the canonical GCM
  // auth-tag mismatch (or whatever the last provider produced).
  let lastErr: unknown;
  let plaintext: Buffer | undefined;
  for (const p of providers) {
    try {
      plaintext = await decryptValue(p, encryptedRow);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (plaintext === undefined) {
    // No payload data in the error path — just rethrow the underlying
    // crypto error (already opaque per node:crypto).
    throw lastErr ?? new Error(`lens: failed to decrypt column ${column}`);
  }

  target[column] = plaintext.toString("utf8");
  for (const k of SIDECAR_KEYS) {
    delete target[sidecarFieldName(config.sidecarPrefix, k)];
  }
  if (config.fingerprint) {
    delete target[config.fingerprint.column];
  }

  // Phase 41.e / HI-03 — TTL enforcement at the lens layer. The check
  // runs AFTER successful decrypt so an expired-token error always
  // implies the underlying ciphertext was valid (no leaking of GCM
  // mismatch diagnostics through TTL semantics). The error carries
  // ONLY (model, column, expiresAt) — never the plaintext value.
  if (config.expiresColumn !== undefined) {
    const expiresAt = coerceExpiresAt(target[config.expiresColumn]);
    if (expiresAt !== null && expiresAt.getTime() < Date.now()) {
      throw new AccountTokenExpiredError(model, column, expiresAt);
    }
  }
}

/**
 * Rewrite where-clauses ending in `_fp_lookup`. The model's column-map
 * is consulted to find the matching `fingerprint.column`. If the model
 * has no map entry or no fingerprint is configured for the column, the
 * clause is left alone (pass-through).
 */
function rewriteWhere(
  model: string,
  where: readonly Where[] | undefined,
  columnMap: EncryptedColumnMap,
): Where[] | undefined {
  if (!where) return undefined;
  const modelCols = columnMap[model];
  if (!modelCols) return [...where];
  return where.map((clause) => {
    if (typeof clause.field !== "string" || !clause.field.endsWith("_fp_lookup")) {
      return clause;
    }
    const colName = clause.field.slice(0, -"_fp_lookup".length);
    const cfg = modelCols[colName];
    if (!cfg?.fingerprint) return clause;
    if (typeof clause.value !== "string") return clause;
    const digest = fingerprintBytes(clause.value, cfg.fingerprint.algorithm);
    // Where["value"] does not advertise Buffer in its public types,
    // but Better-Auth's drizzle layer accepts bytea-compatible values
    // transparently for the `eq` operator (this is the primary path
    // for fingerprint lookup). One narrow runtime assignment keeps
    // the contract intact without a double-cast suppression-style
    // pattern flagged by LOCKER-no-suppressions.
    const next: Where = { ...clause, field: cfg.fingerprint.column };
    (next as { value: unknown }).value = digest;
    return next;
  });
}

/**
 * Wrap a Better-Auth `DBAdapter` with transparent envelope-encryption
 * for the columns declared in `columnMap`. The returned adapter is a
 * drop-in replacement: every method delegates to `inner` after
 * encrypt/decrypt transformations.
 *
 * @param keyProvider Either a single `KeyProvider` (writes + reads
 *   use the same key material) or an array `[active, ...fallbacks]`.
 *   Writes always use `keyProvider[0]`; reads try each provider in
 *   order until one decrypts successfully (KEK-rotation overlap window).
 */
export function wrapAdapter(
  inner: DBAdapter,
  keyProvider: KeyProvider | readonly KeyProvider[],
  columnMap: EncryptedColumnMap,
): DBAdapter {
  const providers: readonly KeyProvider[] = Array.isArray(keyProvider)
    ? keyProvider
    : [keyProvider as KeyProvider];
  if (providers.length === 0) {
    throw new Error("wrapAdapter: at least one KeyProvider required");
  }
  const activeProvider = providers[0]!;

  async function encryptColumns(model: string, data: Record<string, unknown>): Promise<void> {
    const modelCols = columnMap[model];
    if (!modelCols) return;
    for (const [col, cfg] of Object.entries(modelCols)) {
      const raw = data[col];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== "string") {
        throw new TypeError(`lens: ${model}.${col} must be a string for encryption`);
      }
      await encryptInto(data, col, raw, cfg, activeProvider);
    }
  }

  async function decryptRow(model: string, row: Record<string, unknown>): Promise<void> {
    const modelCols = columnMap[model];
    if (!modelCols) return;
    for (const [col, cfg] of Object.entries(modelCols)) {
      await decryptFrom(row, col, cfg, providers, model);
    }
  }

  return {
    id: inner.id,

    create: async (args) => {
      const data = { ...(args.data as Record<string, unknown>) };
      await encryptColumns(args.model, data);
      const created = await inner.create<Record<string, unknown>>({
        ...args,
        data: data as Record<string, unknown>,
      });
      if (created && typeof created === "object") {
        const cloned = { ...(created as Record<string, unknown>) };
        await decryptRow(args.model, cloned);
        return cloned as never;
      }
      return created as never;
    },

    update: async (args) => {
      const update = { ...(args.update as Record<string, unknown>) };
      await encryptColumns(args.model, update);
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[];
      const updated = (await inner.update({ ...args, where, update })) as Record<
        string,
        unknown
      > | null;
      if (updated && typeof updated === "object") {
        await decryptRow(args.model, updated);
      }
      return updated as never;
    },

    updateMany: async (args) => {
      const update = { ...(args.update as Record<string, unknown>) };
      await encryptColumns(args.model, update);
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[];
      return inner.updateMany({ ...args, where, update });
    },

    findOne: async (args) => {
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[];
      const row = (await inner.findOne({ ...args, where })) as Record<string, unknown> | null;
      if (row && typeof row === "object") {
        await decryptRow(args.model, row);
      }
      return row as never;
    },

    findMany: async (args) => {
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[] | undefined;
      const rows = (await inner.findMany({ ...args, where })) as Record<string, unknown>[];
      for (const r of rows) {
        await decryptRow(args.model, r);
      }
      return rows as never;
    },

    count: async (args) => {
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[] | undefined;
      return inner.count({ ...args, where });
    },

    delete: async (args) => {
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[];
      return inner.delete({ ...args, where });
    },

    deleteMany: async (args) => {
      const where = rewriteWhere(args.model, args.where, columnMap) as CleanedWhere[];
      return inner.deleteMany({ ...args, where });
    },

    transaction: inner.transaction.bind(inner),
    createSchema: inner.createSchema?.bind(inner),
    options: inner.options,
  };
}
