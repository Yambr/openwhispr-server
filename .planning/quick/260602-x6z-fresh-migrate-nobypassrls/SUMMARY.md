---
quick_id: 260602-x6z
slug: fresh-migrate-nobypassrls
date: 2026-06-02
status: complete
validate: true
---

# Summary: fresh migrate under a single NOBYPASSRLS role (upstream #4)

Completes blocker #2 for migration-REPLAY. The claim-driven RLS fix (0033) was a
retrofit on the final policy state; on a fresh DB the 0006 `INSERT INTO
tenant_settings` seed runs under FORCE RLS before 0033's bypass arm → `42501`
under a NOBYPASSRLS owner role (upstream passed only via owner BYPASSRLS).

## Fix (A + B, defense-in-depth)

(B) `migrate.ts`: exported `MIGRATE_SESSION_OPTIONS = "-c app.bypass=on -c
app.tenant_id=00000000-0000-0000-0000-000000000000"`, applied to the migrate
pool ONLY (`new Pool(buildPoolConfig(url, { max: 2, options: ... }))`). app.bypass
satisfies post-0033 policies; app.tenant_id=<default> satisfies pre-0033 WITH
CHECK on the default-tenant seed rows. NEVER on the app pool — RLS stays
full-force for app traffic.
(A) `0006_tenant_settings.sql`: both policies bypass-aware at creation
(`current_setting('app.bypass',true)='on' OR tenant_id = NULLIF(...)`), matching
the 0033 shape — self-contained, not reliant on a later retrofit.
- `docs/security.md` §11.2 migration-replay note added.

## Verification (own eyes)

- NEW `migration-fresh-nobypassrls.test.ts` — genuine NOBYPASSRLS owner role,
  full history replay through a pool with MIGRATE_SESSION_OPTIONS: **5 passed**
  (migrate end-to-end OK / default-tenant tenant_settings backfilled / 0006
  policies contain app.bypass / owner rolbypassrls=false / FORCE RLS intact).
- `rls-fail-closed.property` 128 + `rls-claim-bypass.property` 81 + 0006-backfill
  2 — **216 passed total**, app-pool posture UNCHANGED (GUCs don't leak).
- Unit (migrate-grant-app-role.test.ts +3): MIGRATE_SESSION_OPTIONS shape; app
  pool config has NO app.bypass; migrate pool carries the options. **8 passed**.
- data typecheck exit 0; biome clean; lint-migrations clean (0006 edit not
  flagged).

## Acceptance

Fresh `migrate` on an empty DB passes under ONE NOBYPASSRLS role with no
connection hacks beyond what migrate.ts itself sets. ✓ Closes upstream #4.

## Out of scope / next

Local commits only. Fast-follow release (v1.0.21 / chart 1.0.24) decided by Nick
after verification.
