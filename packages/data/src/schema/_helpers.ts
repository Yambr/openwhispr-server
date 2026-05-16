// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 5 / Plan 01 — shared schema helpers.
//
// `tsvector` customType for Postgres full-text search columns. The
// underlying tsvector data is materialized via SQL `GENERATED ALWAYS AS
// (...) STORED` clauses on the owning table — Drizzle's TS layer treats
// the column as opaque text since we never read or write it directly.
// Application code reads the search column via `to_tsquery(...)` joins
// or websearch_to_tsquery() expressions; the TS type is purely for
// schema awareness in joins and Studio introspection.
import { customType } from "drizzle-orm/pg-core";

export const tsvector = customType<{ data: string; notNull: true }>({
  dataType() {
    return "tsvector";
  },
});

// Phase 33 / Plan 33-05 — envelope-encryption sidecar columns.
//
// Postgres `bytea` columns hold AES-256-GCM ciphertext / IVs / GCM tags /
// wrapped DEKs (the 6-sidecar shape declared in
// `packages/data/src/encryption/envelope.ts`) plus the SHA-256
// fingerprint helper columns (`token_fp` / `previous_token_fp`) used
// for O(log N) lookup against ciphertext. The Drizzle pg-core dialect
// does not ship a built-in `bytea` builder, so this customType wraps
// it once and the four credential schemas import it from here.
//
// `data: Uint8Array` keeps the Node-side type narrow — pg's BYTEA codec
// hands back `Buffer` (a Uint8Array subclass) and accepts both
// `Buffer.from(...)` and any Uint8Array on the write side.
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
