---
quick_id: 260602-x6z
slug: fresh-migrate-nobypassrls
date: 2026-06-02
status: complete
validate: true
---

# Quick Task: fresh migrate works under a single NOBYPASSRLS role (upstream #4)

Completes blocker #2 for migration-REPLAY. The claim-driven RLS fix (migration
0033) is a retrofit on the final policy state; on a clean DB the seed DML in
0006 runs BEFORE 0033's bypass arm exists → `INSERT INTO tenant_settings` fails
42501 under a NOBYPASSRLS owner role. Upstream passed only via owner BYPASSRLS.

## Fix (A + B, defense-in-depth)

(B) **migrate.ts** — migrate pool (line 215) ONLY gets libpq session GUCs
`options: "-c app.bypass=on -c app.tenant_id=00000000-0000-0000-0000-000000000000"`.
`app.bypass=on` satisfies post-0033 policies; `app.tenant_id=<default>` satisfies
pre-0033 policy WITH CHECK (0004/0006 seed default-tenant rows). Extract the
string to an exported `MIGRATE_SESSION_OPTIONS` const so it's unit-testable.
NEVER on the app pool (makeAppDb / DATABASE_URL) — RLS stays full-force for app
traffic. The litellm admin pool (line 79) is unaffected (no RLS tables).

(A) **0006_tenant_settings.sql** — add `current_setting('app.bypass',true)='on'
OR` to both policy bodies (tenant_settings + user_settings) at creation, matching
the 0033 NULLIF shape. Each migration's policy self-contained/bypass-aware. Safe
to edit (drizzle applies by created_at; existing DBs skip 0006).

## Tests (TDD RED→GREEN)
- NEW `migration-fresh-nobypassrls.test.ts`: stock postgres:17-alpine, owner role
  **NOBYPASSRLS**, run migrate() through a pool with MIGRATE_SESSION_OPTIONS →
  (1) migrate succeeds (pre-fix 42501 on 0006), (2) tenant_settings has default-
  tenant row, (3) 0006 policies contain 'app.bypass' (pg_policies), (4) RLS forced.
- Unit (migrate.test or sibling): MIGRATE_SESSION_OPTIONS contains app.bypass +
  app.tenant_id; makeAppDb pool config has NO options/app.bypass.
- Keep green: migration-0006-backfill, migration-rollback, all RLS property tests
  (app-pool posture UNCHANGED — GUCs must not leak to app pool).

## Constraints
Strict TDD; ≥90% diff cov; lint-migrations on edited 0006; docs/security.md §11.2
migration-replay note. Local commits only — fast-follow release decided after.
