// SPDX-License-Identifier: FSL-1.1-ALv2
// Two-pool Drizzle client factory.
//
// Per RESEARCH-DB §"Pattern 1: Two-Pool Client Factory" and CONTEXT D-15:
// the data layer hosts TWO independent connection pools that share zero
// state. They exist to keep the BYPASSRLS owner role away from any code
// path that flows tenant data.
//
// makeAppDb()  -> openwhispr_app via PgBouncer (transaction mode, RLS-subject)
// makeOwnerDb() -> openwhispr_owner DIRECT to Postgres:5432 (BYPASSRLS, DDL only)
//
// Sharing a single pool would defeat tenant isolation: under PgBouncer
// transaction-pool reuse, a BYPASSRLS-capable connection could be handed
// to RLS-subject app code, and any `SET LOCAL app.tenant_id` that leaks
// across pooled physical connections would silently breach tenant boundaries.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema/index.js";

export type AppDb = NodePgDatabase<typeof schema>;
export type OwnerDb = NodePgDatabase<typeof schema>;

/**
 * Phase 51 / Plan 51-14 (REVIEW-INDEX HI-03 / data) — build a pg
 * `PoolConfig` with TLS enabled by default. The operator opts OUT by
 * adding `?sslmode=disable` to the DATABASE_URL (the canonical pg
 * libpq escape hatch). Anything else — `sslmode=require`, missing
 * `sslmode=*`, or any other value — turns on TLS. `rejectUnauthorized`
 * stays `false` so self-signed certs (the OSS quickstart's traefik
 * mkcert chain) keep working; production operators flip
 * `PGSSL_REJECT_UNAUTHORIZED=1` to enforce verification end-to-end.
 *
 * Pre-fix, every `new Pool({ connectionString })` deferred entirely
 * to libpq's default, which is `prefer` — server speaks plaintext if
 * TLS handshake fails. Credentials + tenant rows therefore traveled
 * unencrypted whenever the server was misconfigured.
 */
export function buildPoolConfig(
  connectionString: string,
  overrides: Partial<PoolConfig> = {},
): PoolConfig {
  const hasDisable = /[?&]sslmode=disable\b/i.test(connectionString);
  const rejectUnauth = process.env.PGSSL_REJECT_UNAUTHORIZED === "1";
  const tls = hasDisable ? false : { rejectUnauthorized: rejectUnauth };
  return { connectionString, ssl: tls, ...overrides };
}

/**
 * Application database client.
 *
 * Connects as `openwhispr_app` via PgBouncer transaction-pool. Subject to
 * RLS — every query MUST run inside `withTenant()` so `app.tenant_id` is
 * set via `SET LOCAL`. Outside a tenant context, the canonical RLS policy
 * fails closed (returns zero rows / rejects writes).
 *
 * Connection string: DATABASE_URL (e.g. postgres://openwhispr_app:...@pgbouncer:5432/openwhispr).
 */
export function makeAppDb(): { db: AppDb; pool: Pool } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("makeAppDb: DATABASE_URL not set");
  }
  const pool = new Pool(buildPoolConfig(url, { max: 20 }));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Owner database client. DDL only.
 *
 * Connects as `openwhispr_owner` DIRECTLY to Postgres on 5432, NOT via
 * PgBouncer. This is intentional: BYPASSRLS plus PgBouncer transaction-pool
 * connection reuse is a documented leak vector (RESEARCH-DB §Anti-Patterns).
 * Owner pool capacity is small (max=2) — only the migration runner and
 * one-shot ops scripts ever touch it.
 *
 * Connection string: DATABASE_URL_OWNER (e.g. postgres://openwhispr_owner:...@postgres:5432/openwhispr).
 *
 * Throws if DATABASE_URL_OWNER is unset — refusing to silently fall back
 * to DATABASE_URL is the failsafe against accidentally running migrations
 * through PgBouncer.
 */
export function makeOwnerDb(): { db: OwnerDb; pool: Pool } {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error("makeOwnerDb: DATABASE_URL_OWNER not set — refusing to run as owner");
  }
  const pool = new Pool(buildPoolConfig(url, { max: 2 }));
  const db = drizzle(pool, { schema });
  return { db, pool };
}
