#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: Apache-2.0
import { exit } from "node:process";
/**
 * lint-rls.ts — Standalone RLS-introspection lint.
 *
 * Phase 1 / Plan 05 constitutional gate. Connects to a migrated Postgres
 * via $DATABASE_URL and asserts that every tenant-scoped table is wired
 * with FORCE ROW LEVEL SECURITY plus a tenant-isolation policy that
 * references the `app.tenant_id` GUC. The lint is the regression net for
 * Phase 1 success criterion #2: any future migration that adds an
 * unguarded tenant_id-bearing table fails CI.
 *
 * The three failure modes (each emits a `file:line:col`-style stderr
 * diagnostic and counts toward the non-zero exit):
 *
 *   1. NO_RLS:        a table with a `tenant_id` column has
 *                     `relrowsecurity = false`. RLS not enabled at all.
 *   2. NO_POLICY:     a table has `relrowsecurity = true` but no row in
 *                     `pg_policies`. The table is RLS-enabled with the
 *                     default deny-all behavior, which silently breaks
 *                     application reads/writes — usually unintended.
 *   3. POLICY_DRIFT:  at least one policy on a tenant-scoped table whose
 *                     USING (`qual`) or WITH CHECK (`with_check`)
 *                     expression does NOT reference `app.tenant_id`.
 *                     This catches a policy whose predicate has been
 *                     changed away from the canonical
 *                     `tenant_id = current_setting('app.tenant_id', ...)`
 *                     shape.
 *
 * The lint also prefers FORCE RLS over plain ENABLE: an ENABLE-only
 * table allows the table owner to bypass policies (Pitfall 5). When a
 * tenant_id-bearing table has `relrowsecurity = true` AND
 * `relforcerowsecurity = false` we still emit a NO_RLS-class diagnostic
 * named "FORCE RLS missing" — it is treated as a failure mode of the
 * same severity, since the constitutional invariant requires both bits.
 *
 * Scope:
 *
 *   * Schema: `public` only. The `_meta` schema (where Drizzle's
 *     `__drizzle_migrations` table lives) is intentionally excluded —
 *     that table has no `tenant_id` column and is never reachable from
 *     the openwhispr_app role.
 *   * Tenant-scoped detection: any table in `public` that has a
 *     `tenant_id` column (per `information_schema.columns`). The
 *     `tenants` table itself is excluded (no `tenant_id` column on the
 *     parent — D-17).
 *
 * Exit codes:
 *
 *   0 — no offenders
 *   1 — at least one offender; each printed to stderr
 *   2 — internal error (e.g., DATABASE_URL not set, pg connect failed)
 *
 * CRITICAL: $DATABASE_URL must point to Postgres directly, NOT through
 * PgBouncer. The introspection queries are session-feature-light, but
 * keeping the whole lint chain off PgBouncer matches the migration
 * runner discipline and avoids transaction-pool surprises.
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://owner:pw@localhost:5432/openwhispr \
 *     pnpm exec tsx tools/lint-rls.ts
 */
import { Client } from "pg";

const SCHEMA = "public";
// Tables in `public` that have a `tenant_id` column but are NOT
// themselves under tenant isolation. The `tenants` table is the parent
// of the relationship and intentionally has no `tenant_id` column, so it
// will not be discovered; this allowlist is reserved for future shapes.
const TENANT_LESS_ALLOWLIST = new Set<string>([]);

interface Diagnostic {
  table: string;
  rule: "NO_RLS" | "NO_FORCE_RLS" | "NO_POLICY" | "POLICY_DRIFT";
  message: string;
}

// Q_TENANT_TABLES: tables in `public` that own a `tenant_id` column.
// These are the lint scope; tables without `tenant_id` are out of scope.
//
// Phase 6 / Plan 02 — pg_partman 5.x names monthly child partitions of
// `audit_log` as `audit_log_pYYYYMMDD` (the first-day-of-month stamp)
// plus an `audit_log_default` catch-all when infinite_time_partitions
// is true. Children inherit RLS from the partitioned parent (PG 13+
// native behaviour) but do NOT have their own rows in pg_policies. We
// exclude them from the lint scope to prevent NO_POLICY false-positives
// while keeping the parent (`audit_log`) — relkind 'p' — in scope.
const AUDIT_LOG_CHILD_REGEX = "^audit_log_(p[0-9]{8}|default)$";
const Q_TENANT_TABLES = `
  SELECT c.table_name AS tablename
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name   = c.table_name
  WHERE c.table_schema = $1
    AND c.column_name  = 'tenant_id'
    AND t.table_type   = 'BASE TABLE'
    AND c.table_name !~ $2
  ORDER BY c.table_name;
`;

// Q_RLS_FLAGS: relrowsecurity + relforcerowsecurity per relation, for
// the tenant-scoped tables found above.
const Q_RLS_FLAGS = `
  SELECT n.nspname  AS schemaname,
         c.relname  AS tablename,
         c.relrowsecurity      AS rls_enabled,
         c.relforcerowsecurity AS rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relname = ANY($2::text[])
    AND c.relkind IN ('r', 'p');
`;

// Q_POLICIES: every policy attached to the relevant tables. We then
// inspect both `qual` (USING) and `with_check` for an `app.tenant_id`
// substring. The 0000_initial.sql writes both for the canonical
// policies; a policy that drops the GUC reference in either expression
// is suspect.
const Q_POLICIES = `
  SELECT schemaname,
         tablename,
         policyname,
         qual,
         with_check
  FROM pg_policies
  WHERE schemaname = $1
    AND tablename = ANY($2::text[]);
`;

interface RlsRow {
  schemaname: string;
  tablename: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
}

function policyExpressionMentionsGuc(expr: string | null): boolean {
  if (expr === null) return false;
  return expr.includes("app.tenant_id");
}

async function lint(databaseUrl: string): Promise<Diagnostic[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const diags: Diagnostic[] = [];
  try {
    const tables = (
      await client.query<{ tablename: string }>(Q_TENANT_TABLES, [SCHEMA, AUDIT_LOG_CHILD_REGEX])
    ).rows
      .map((r) => r.tablename)
      .filter((t) => !TENANT_LESS_ALLOWLIST.has(t));

    if (tables.length === 0) {
      // Empty scope is not itself a failure — it just means nothing to
      // check. The migration_rollback test asserts the canonical four
      // tables exist; this lint stays silent in that edge case.
      return diags;
    }

    const flags = (await client.query<RlsRow>(Q_RLS_FLAGS, [SCHEMA, tables])).rows;
    const flagsByName = new Map<string, RlsRow>(flags.map((f) => [f.tablename, f]));

    const policies = (await client.query<PolicyRow>(Q_POLICIES, [SCHEMA, tables])).rows;
    const policiesByTable = new Map<string, PolicyRow[]>();
    for (const p of policies) {
      const list = policiesByTable.get(p.tablename) ?? [];
      list.push(p);
      policiesByTable.set(p.tablename, list);
    }

    for (const t of tables) {
      const f = flagsByName.get(t);
      if (!f || !f.rls_enabled) {
        diags.push({
          table: t,
          rule: "NO_RLS",
          message: `table "${t}" has tenant_id column but RLS is disabled (relrowsecurity=false)`,
        });
        // Skip downstream checks — they are meaningless without ENABLE.
        continue;
      }
      if (!f.rls_forced) {
        diags.push({
          table: t,
          rule: "NO_FORCE_RLS",
          message: `table "${t}" has ENABLE RLS but FORCE RLS missing — table owner can bypass policies`,
        });
      }
      const tablePolicies = policiesByTable.get(t) ?? [];
      if (tablePolicies.length === 0) {
        diags.push({
          table: t,
          rule: "NO_POLICY",
          message: `table "${t}" has RLS enabled but no policy attached — default deny-all`,
        });
        continue;
      }
      for (const p of tablePolicies) {
        const qualOk = policyExpressionMentionsGuc(p.qual);
        const withCheckOk =
          p.with_check === null ? true : policyExpressionMentionsGuc(p.with_check);
        if (!qualOk || !withCheckOk) {
          diags.push({
            table: t,
            rule: "POLICY_DRIFT",
            message: `policy "${p.policyname}" on "${t}" does not reference app.tenant_id (qual=${
              p.qual ?? "<null>"
            }, with_check=${p.with_check ?? "<null>"})`,
          });
        }
      }
    }
  } finally {
    await client.end();
  }
  return diags;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "lint-rls: DATABASE_URL not set — point at Postgres directly (NOT through PgBouncer).\n",
    );
    exit(2);
  }

  const diags = await lint(url);
  if (diags.length > 0) {
    process.stderr.write(`RLS-introspection lint failed: ${diags.length} offender(s)\n`);
    for (const d of diags) {
      process.stderr.write(`  ${d.table}: [${d.rule}] ${d.message}\n`);
    }
    exit(1);
  }
  process.stdout.write(
    "RLS-introspection lint passed: every tenant-scoped table is FORCE-RLS'd with a tenant_id policy.\n",
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`lint-rls: internal error: ${String(err)}\n`);
  exit(2);
});
