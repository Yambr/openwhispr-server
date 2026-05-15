# Phase 19 — Discussion Log

**Date:** 2026-05-15
**Mode:** compact discuss (single advisor only; SERVER-ERRORS.md provides structured input)
**User pacing:** explicit Phase 19 selection from Phase 18.1.2 closure decision menu.

## Trigger

Phase 18.1.2-06 closure declared v2.1 milestone CLOSED-WITH-PRE-EXISTING-DEBT. SERVER-ERRORS.md ledger accumulated 5 production-side entries from Phases 18.1.1 + 18.1.2 (gated out by CLAUDE.md Hard Rule #1). User direction: "Phase 19 server-error closure" — production-fix phase consuming SERVER-ERRORS.md Entries 1-5 with explicit scope.

## Single advisor spawned (SR-19.1 strategy)

The 4 other SRs (SR-19.2 fastify types, SR-19.3 BYOK refactor, SR-19.4 otel export, SR-19.5 ops docs) had explicit suggested-fix sections in SERVER-ERRORS.md already approved by user. Only SR-19.1 (migration schema-aware refactor) required architectural decision between Option (i) strip `"public".` prefixes vs Option (ii) `OPENWHISPR_DB_SCHEMA` env knob.

**Advisor recommendation:** Option (i). Real scope: 11 grep hits across 3 files (not 18 / 50-100 LoC as Entry 1 estimated). Codebase already philosophically schema-agnostic (`pgTable("tenants", …)` plain Drizzle, RLS policies use unqualified names). Generated FK DDL is the only place that got `"public".` prefix by drizzle-kit default. Journal re-hash is informational on existing prod DBs (migrations already applied by hash+idx). pg_partman `parent_table='public.audit_log'` literal stays — it's partition metadata, not FK.

Option (ii) rejected: no v2 consumer; Drizzle 0.31 has no native schema parameterization; sed-and-pray runtime wrapper would be strictly worse for the only concrete consumer (test isolation).

## Decisions captured (D-01..D-26)

All in CONTEXT.md. Key locks:

- 3 plans sequential `19-01 → 19-02 → 19-03`
- ~8-10 atomic commits
- SR-19.1 LAST (drizzle journal + cross-cuts to Phase 18.1.2-03 W-2 revert)
- Atomic revert pattern: migrations edit + test-infra W-2 revert in SAME commit
- TDD D-39 doctrine carries
- ZERO `--no-verify`
- End-of-phase: `pnpm test` exit 0 + `pnpm typecheck` exit 0 + v2.1 milestone CLOSED (drops -WITH-PRE-EXISTING-DEBT suffix)

## Deferred ideas

- Option (ii) `OPENWHISPR_DB_SCHEMA` env knob — v3 multi-tenant-by-schema topology
- Per-tenant schema topology — v3+
- All operator-side carries (FSL scrub, GHA e2e-cjm, axe baselines, visual snapshots)

## Claude's discretion items

- Compact discuss (single advisor) — appropriate because SERVER-ERRORS.md provides structured input.
- SUMMARY artefacts smaller (≤80 LOC each) — bounded scope.
- ~2-3h total Phase 19 runtime estimate.
- v2.1 milestone CLOSED on Phase 19 close (assuming aggregate green).
