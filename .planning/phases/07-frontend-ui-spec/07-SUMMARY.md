---
phase: 07-frontend-ui-spec
type: summary
completed: 2026-05-12
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
commits:
  - b72882f docs(07): plan 01 — verify upstream API shapes, scaffold UI-SPEC stubs
  - 0a240cd test(07): plan 02 — RED linter tests, fixtures, config (TDD foundation)
  - ce72448 feat(07): plan 03 — implement tools/lint-ui-spec.ts (GREEN)
  - 70aed25 docs(07): plan 04 — author UI-SPEC-admin.md (A2 + A3)
  - cd9bf30 docs(07): plan 05 — author UI-SPEC-end-user.md (U1–U13)
  - 65824b7 chore(07): plan 06 — shared appendix, GHA, lefthook, lint gate green
  - (this) docs(07): plan 07 — finalize phase 7 (SUMMARY, STATE, ROADMAP)
metrics:
  total_commits: 7
  total_lines_added: ~4096
  coverage_lint_ui_spec_ts:
    statements: 96.77
    branches: 92.24
    functions: 94.59
    lines: 96.81
---

# Phase 7 — Frontend UI-SPEC: Summary

**Completed:** 2026-05-12
**Status:** Done
**Verifier:** gsd-verifier (run `/gsd-verify-phase 07`)

## What Shipped

- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` — 2 screens (A2 Observability + A3 Config) per D-API4 / D-API5; admin role gate moved to deployment-level per A4 refutation (758 lines).
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` — 13 screens (U1–U13) per D-UX/D-API decisions, including U4 collapsed to KPI-only after A2/A3 refutation removed dailySeries/providerBreakdown/activity-feed (1915 lines).
- `tools/lint-ui-spec.ts` + `tools/lint-ui-spec.config.ts` + `tools/lint-ui-spec.test.ts` + `tools/lint-ui-spec/fixtures/**` — 5-rule spec linter (unified+remark + TS AST routes scanner); coverage 96.77/92.24/94.59/96.81 on the linter module.
- `.github/workflows/ui-spec.yml` — GHA gate firing on UI-SPEC / routes / linter / config drift.
- `lefthook.yml` — pre-commit hook running `pnpm lint:ui-spec` when relevant files change.
- `package.json` — `lint:ui-spec` script + `unified` / `remark-parse` / `mdast-util-from-markdown` devDeps.

## Goal-Backward Verification — Must-Have Proof Table (15/15 PASS)

| # | Must-have | Evidence | Result |
|---|-----------|----------|--------|
| 1 | `UI-SPEC-admin.md` exists | `test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` → 0 | PASS |
| 2 | `UI-SPEC-end-user.md` exists | `test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` → 0 | PASS |
| 3 | `pnpm lint:ui-spec` exits 0 | command output below; `EXIT=0` | PASS |
| 4 | `grep -c "^## A[23] " UI-SPEC-admin.md` ≥ 2 | returned **2** (A2, A3) | PASS |
| 5 | `grep -cE "^## U([1-9]|1[0-3]) " UI-SPEC-end-user.md` ≥ 13 | returned **13** (U1–U13) | PASS |
| 6 | Each screen has 10 required subsections | linter rule `required-subsections` exits 0 (`tools/lint-ui-spec.ts` `lintRequiredSubsections`) | PASS |
| 7 | Every endpoint resolves to `apps/api/src/routes/` or `BETTER_AUTH_PATHS` | linter rule `endpoint-exists` exits 0 (`tools/lint-ui-spec.ts` `lintEndpointExists`) | PASS |
| 8 | Every copy key globally unique + 5-level dotted schema | linter rule `copy-key-uniqueness` + `COPY_KEY_REGEX` enforced via `tools/lint-ui-spec.config.ts:39` | PASS |
| 9 | Every `See visual:` ref resolves | linter rule `see-visual-resolves` exits 0 (`tools/lint-ui-spec.ts` `lintVisualRefs`) | PASS |
| 10 | Wireframes pass monospace tolerance OR visual-only sentinel | linter rule `wireframe-monospace` exits 0 (`tools/lint-ui-spec.ts` `lintWireframeMonospace`) | PASS |
| 11 | `.github/workflows/ui-spec.yml` references `pnpm lint:ui-spec` | `grep -c "lint:ui-spec" .github/workflows/ui-spec.yml` → ≥ 1 | PASS |
| 12 | `package.json` exposes `lint:ui-spec` script | `grep -c "lint:ui-spec" package.json` → **1** | PASS |
| 13 | Coverage on `tools/lint-ui-spec.ts` ≥90/90/90/90 | vitest v8 report: **96.81 lines / 92.24 branches / 94.59 functions / 96.77 statements** | PASS |
| 14 | Three design-gap markers encoded | `grep -cE "<!-- DESIGN-GAP "` → admin 1 + end-user 2 = **3** (D-UX2, D-API4, A2/A3+D-API6) | PASS |
| 15 | STATE.md + ROADMAP.md updated with Phase 7 done | this commit | PASS |

## Command Output (proof)

### `pnpm lint:ui-spec` — final tree

```
$ pnpm lint:ui-spec
$ tsx tools/lint-ui-spec.ts
EXIT=0
```

### Coverage — `tools/lint-ui-spec.ts`

```
npx vitest run tools/lint-ui-spec.test.ts --coverage --config /tmp/vitest-cov-lint-ui-spec.config.ts

 Test Files  1 passed (1)
      Tests  37 passed (37)

 % Coverage report from v8
-----------------|---------|----------|---------|---------|---------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|---------------------
All files        |   96.77 |    92.24 |   94.59 |   96.81 |
 lint-ui-spec.ts |   96.77 |    92.24 |   94.59 |   96.81 | 261,354-361,601-605
-----------------|---------|----------|---------|---------|---------------------

Statements   : 96.77% ( 240/248 )
Branches     : 92.24% ( 107/116 )
Functions    : 94.59% ( 35/37 )
Lines        : 96.81% ( 213/220 )
```

Note: the project-root `vitest.config.ts` excludes `tools/**` from coverage by default (Phase 0 placeholder-stub policy); the `tools/lint-ui-spec.ts` coverage is measured via a Phase-7-scoped vitest config that whitelists the file (mirrors the per-tool coverage pattern used by `tools/lint-rls.ts` and `tools/lint-english.ts`).

## Decisions Honored

| Decision | Where enforced |
|----------|----------------|
| D-S1 (no new APIs) | Plan 01 verified API table + linter rule 2 + appendix endpoint index |
| D-API1 (flat transcript JSON) | U7 Data subsection |
| D-API2 (BA `/api/auth/list-sessions`) | U5 endpoints |
| D-API4 (no Effective env) | A3 Purpose + Wireframe + `<!-- DESIGN-GAP D-API4 -->` marker |
| D-API5 (drop A1 audit-log viewer) | UI-SPEC-admin contains only A2 + A3 |
| D-API6 (no activity feed) | U4 `<!-- DESIGN-GAP A2/A3 + D-API6 -->` marker; KPI-only chart set |
| D-UX1 (email+password) | U1 / U2 forms |
| D-UX2 (forgot-pw deferred) | U1 disabled state + `<!-- DESIGN-GAP D-UX2 -->` marker |
| D-UX3 (no PAK web UI v1) | absence verified by grep |
| D-UX4 (Continue with SSO) | U1 / U2 OIDC button copy keys |
| D-UX5 (folders read-only) | U8 sidebar |
| D-ART1..D-ART7 (artifact shape) | two UI-SPEC files + appendix + linter + fixtures |

## Notable Deviations from Original Plan

1. **A2/A3 refutation (Plan 01)** — Original plan envisioned a full Usage dashboard (U4) with dailySeries / providerBreakdown / latest-activity feed. Plan 01 API verification (against the live Phase 5 `/api/usage` shape) refuted those fields. **Action:** collapsed U4 to KPI-only; encoded D-API6 design-gap marker. **Impact:** UI-SPEC ships with fewer surfaces but every surface is API-backed.
2. **A4 refutation (Plan 01)** — Original plan envisioned an admin role gate inside the UI. Plan 01 found no `role`/`admin` column on the user/session schema (Better Auth v1.6.9 single-role default). **Action:** moved admin role gate to deployment-level (Traefik/IdP claim filter); UI-SPEC-admin contains no per-user role check.
3. **BETTER_AUTH_PATHS extension (Plan 06)** — During the cross-file lint gate, the path allowlist was extended to cover the catch-all `/api/auth/*` handler shape used by Better Auth v1.6.9 (paths verified against `apps/api/src/routes/better-auth-handler.ts` live source).
4. **Three design-gap markers (not failures)** — D-UX2 (forgot-password visual treatment), D-API4 (A3 layout rebalancing after Effective-env removal), A2/A3+D-API6 (U4 grid rebalancing after activity-feed removal). All are queued for **Claude Design re-engagement**, not phase failures.

## Phase 7.x Backlog (deferred to follow-up phases)

- **U14 Forgot password** (`/forgot-password`) — wires to Better Auth `/api/auth/forget-password`.
- **U15 Reset password** (`/reset-password?token=`) — wires to Better Auth `/api/auth/reset-password`.
- **U16 PAK manager web UI** — `/api/v1/keys/list` + `/api/v1/keys/:id/revoke`.
- **A1 Audit log viewer** — requires new `GET /api/admin/audit/list` endpoint (Phase 6 D-A5 still open).
- **Three Claude Design re-engagements** for D-UX2 / D-API4 / D-API6+A2/A3 gaps.

## Phase 8 Pointer (next phase)

Phase 8 should scaffold `apps/web/` (Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 via `pnpm dlx shadcn@latest init`) and **implement the UI per these two UI-SPEC files**. Phase 7 explicitly deferred the scaffold per RESEARCH § Open Q 1 to keep the verifier surface small.

## Constitutional Compliance

- **TDD:** Plan 02 (RED tests + fixtures, commit `0a240cd`) precedes Plan 03 (GREEN implementation, commit `ce72448`) in git log — verified via `git log --oneline`.
- **Coverage:** `tools/lint-ui-spec.ts` measured at 96.77 / 92.24 / 94.59 / 96.81 — all four axes ≥90.
- **E2E:** N/A (no user-visible route in Phase 7 deliverable; Phase 8 will add e2e against the Next.js app).
- **No mocks of internal logic:** linter tests use real markdown fixtures (`tools/lint-ui-spec/fixtures/`) and the real `apps/api/src/routes/` source tree; no HTTP mocks.
- **GitHub Actions only:** `.github/workflows/ui-spec.yml` is the sole CI surface for this phase.
- **English-only:** UI-SPEC body, code comments, copy-key identifiers, commit messages — all English. Russian translations deferred to Phase 10.

## Self-Check: PASSED

- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` — FOUND
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` — FOUND
- `tools/lint-ui-spec.ts` — FOUND
- `tools/lint-ui-spec.config.ts` — FOUND (WIP_ENDPOINTS empty)
- `tools/lint-ui-spec.test.ts` — FOUND (37 tests passing)
- `.github/workflows/ui-spec.yml` — FOUND
- `lefthook.yml` — FOUND
- Commits b72882f / 0a240cd / ce72448 / 70aed25 / cd9bf30 / 65824b7 — all present in `git log`
