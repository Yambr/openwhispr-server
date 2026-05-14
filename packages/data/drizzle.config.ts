// SPDX-License-Identifier: FSL-1.1-ALv2
// Drizzle Kit configuration for @openwhispr/data.
//
// Per RESEARCH-DB Pitfall 8: the drizzle migrations bookkeeping table lives
// in a dedicated `_meta` schema (not `public`) so the RLS lint script
// (Plan 05) only needs to introspect public-schema tables and so the
// `_app` role — which has no rights on `_meta` — cannot accidentally read
// or write the migrations ledger.
//
// `dialect: 'postgresql'` is the canonical drizzle-kit 0.31.x value.
// `dbCredentials.url` falls back to a local-dev URL only so that running
// `drizzle-kit generate` (which does not actually connect) works without
// `.env`. Real DDL (`migrate`) demands DATABASE_URL_OWNER per src/migrate.ts.
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  migrations: {
    schema: "_meta",
    table: "__drizzle_migrations",
  },
  dbCredentials: {
    url: process.env.DATABASE_URL_OWNER ?? "postgres://openwhispr_owner@localhost:5432/openwhispr",
  },
} satisfies Config;
