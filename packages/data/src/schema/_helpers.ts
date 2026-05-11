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
