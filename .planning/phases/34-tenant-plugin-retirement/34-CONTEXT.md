# Phase 34: tenantPlugin retirement (CR-1 closure) — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped; user offline)
**Source:** ROADMAP Phase 34 + `.planning/review/api-core.md` CR-01 + REVIEW-INDEX.md CR-1

## Pre-flight

- `apps/api/src/middleware/tenant.ts` exists; `req.tenantId` is set from `x-tenant-id` header on every request (RED finding from review). The plugin's own comment admits "Phase 2 will replace it" but the dual-auth Phase 2 finished, leaving `req.tenantId` armed.
- Phase 31's `lint-prod-readiness` (LOCKER-04) is WARN-only and includes a 469-entry dead-export allowlist. Deleting `tenantPlugin` will shrink that surface by N entries; locker re-runs clean on the diff.
- Phase 33 lens.ts wraps Better Auth's drizzleAdapter — does NOT depend on `req.tenantId`. Phase 34 retirement is independent.

<domain>
## Phase Boundary

Either DELETE `apps/api/src/middleware/tenant.ts` entirely (preferred — Phase 2 dual-auth migrated real routes off `req.tenantId`) OR rename to `req.untrustedTenantHint` with a runtime guard that throws when both `req.tenant` (authoritative from dual-auth) and `req.untrustedTenantHint` (from forged header) are present AND disagree.

## Scope (in)

1. **Audit**: grep for every reader of `req.tenantId` in `apps/**/src/**` + `packages/**/src/**` (excluding tests). Result determines DELETE vs RENAME.
   - If 0 production readers → DELETE path. The plugin + module-augmentation + registration line all go.
   - If ≥ 1 production reader → fix each one to use `req.tenant.id` (authoritative), then DELETE.

2. **DELETE `apps/api/src/middleware/tenant.ts`** (if audit confirms safe).

3. **DELETE registration** at `apps/api/src/index.ts:382` (`app.register(tenantPlugin)`).

4. **DELETE module-augmentation** in `apps/api/src/types/` (or wherever `FastifyRequest { tenantId: string }` is declared).

5. **E2E `tests/e2e/tenant-isolation.test.ts`** (DISCIPLINE Rule 3) — boots real stack (docker compose); creates two tenants + two users; signs in as user A; sends `GET /api/notes` with forged `x-tenant-id: <userB-tenant-uuid>` header; asserts response shows user A's notes only (NOT user B's, NOT empty if A has notes). Real Better Auth session, real cookie, real header injection.

6. **Regression test** — vitest unit that asserts `apps/api/src/middleware/tenant.ts` does NOT exist; `apps/api/src/types/*.ts` does NOT augment `FastifyRequest` with `tenantId`. Hard guard against re-introduction beyond what `lint-prod-readiness` provides.

7. **Lint-prod-readiness allowlist update** — any `tenantPlugin`-related entry removed from the allowlist; re-run lockers confirms clean.

## Scope (out)

- New tenant-resolution logic — Phase 32 RLS + Phase 33 encryption already cover the authoritative path; no new code needed.
- Phase 35 api-routes-rest bundle.
- Phase 41 route-bulkfix.

</domain>

<decisions>
## Implementation Decisions

- **DELETE-preferred path.** If audit shows 0 production readers, delete is safer than rename (no surface area to maintain).
- **E2E test on real Better Auth.** Cannot mock the session creation — must boot real stack per DISCIPLINE Rule 4 (no internal mocks) and Rule 3 (e2e mandatory for user-visible routes).
- **Regression test as filesystem assertion.** Catches the simplest regression (someone re-creates the file). Pairs with `lint-prod-readiness` which catches the export-introduction case.

</decisions>

<code_context>
## Existing Code Insights

- `apps/api/src/middleware/tenant.ts` — read in full; small file (probably <100 lines per review).
- `apps/api/src/index.ts:382` — registration line.
- `apps/api/src/types/` — find module-augmentation.
- Phase 33 landed `apps/api/src/auth.ts` lens.wrapAdapter wiring; Phase 34 audit must verify no auth.ts callsite reads `req.tenantId`.
- Phase 32 `tests/e2e/rls-fail-closed.test.ts` is the canonical e2e pattern Phase 34's tenant-isolation test mirrors.

</code_context>

<specifics>
## Specific Ideas

- E2E test filename: `tests/e2e/tenant-isolation.test.ts` (per Phase 31/32 e2e naming pattern — `.test.ts` not `.spec.ts`).
- Run via vitest under `tests/e2e/vitest.e2e.config.ts`.
- Use existing testcontainer fixture if helpful, but the e2e is meant to exercise the real HTTP stack — prefer docker-compose-based fixture if available, fall back to in-process Fastify with full plugin chain.

</specifics>

<deferred>
## Deferred Ideas

- None for Phase 34. Tenant-isolation is one of the load-bearing security invariants — closing it cleanly is the only acceptable outcome.

</deferred>
