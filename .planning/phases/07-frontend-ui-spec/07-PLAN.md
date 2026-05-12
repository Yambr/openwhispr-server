---
phase: 07-frontend-ui-spec
plan: 00
type: index
wave: 0
depends_on: []
files_modified: []
autonomous: false
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "Both UI-SPEC-*.md files exist on disk and lint clean"
    - "Every screen enumerated in 07-SPEC.md (2 admin + 13 end-user) has a corresponding section in the relevant UI-SPEC file with all 10 required subsections (Purpose, Roles, Route, Data, Actions, States, User journey, Copy keys, Wireframe, shadcn primitives)"
    - "Every API endpoint referenced by UI-SPEC exists in apps/api/src/routes/ (or matches the BETTER_AUTH_PATHS allowlist)"
    - "Every copy key is unique across both UI-SPEC files and follows the 5-level dotted schema"
    - "Every `See visual:` reference resolves to a real JSX function in design/"
    - "`pnpm lint:ui-spec` script runs the linter and exits non-zero on any violation"
    - "GHA CI job runs `pnpm lint:ui-spec` on every PR touching UI-SPEC-*.md, tools/lint-ui-spec.ts, or apps/api/src/routes/**"
    - "tools/lint-ui-spec.ts coverage ≥90/90/90/90 (lines/branches/functions/statements) on diff"
    - "All linter unit tests were authored RED before GREEN production code (per-commit RED→GREEN evidence in git log)"
  artifacts:
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md"
      provides: "Admin console spec (A2 Observability + A3 Config) — 2 screens × 9 subsections + shared appendix"
      contains: "## A2", "## A3", "Appendix"
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md"
      provides: "End-user UI spec (U1..U13) — 13 screens × 9 subsections + shared appendix"
      contains: "## U1", "## U13", "Appendix"
    - path: "tools/lint-ui-spec.ts"
      provides: "Spec linter: 5 validation rules (subsections, endpoints, copy-key uniqueness, See-visual refs, wireframe monospace)"
    - path: "tools/lint-ui-spec.test.ts"
      provides: "Vitest unit tests for linter (≥90% coverage on diff)"
    - path: "tools/lint-ui-spec.config.ts"
      provides: "BETTER_AUTH_PATHS allowlist + WIP_ENDPOINTS list"
    - path: "tools/lint-ui-spec/fixtures/"
      provides: "Markdown fixtures that exercise each lint rule (pass and fail cases)"
    - path: ".github/workflows/ui-spec.yml"
      provides: "GHA workflow gating UI-SPEC and routes drift"
    - path: "package.json"
      provides: "`lint:ui-spec` script entry"
    - path: "lefthook.yml"
      provides: "Pre-commit hook running `pnpm lint:ui-spec` when relevant files change"
  key_links:
    - from: "UI-SPEC-*.md inline-code endpoint refs (e.g., `GET /api/usage`)"
      to: "apps/api/src/routes/usage.ts (or BETTER_AUTH_PATHS for /api/auth/*)"
      via: "tools/lint-ui-spec.ts endpoint-exists rule"
      pattern: "(GET|POST|PATCH|DELETE) /api/..."
    - from: "UI-SPEC-*.md `See visual:` lines"
      to: "design/screens-{admin,user}.jsx function exports"
      via: "tools/lint-ui-spec.ts visual-ref-resolves rule"
      pattern: "See visual: design/<file>.jsx#<FunctionName>"
    - from: ".github/workflows/ui-spec.yml"
      to: "pnpm lint:ui-spec"
      via: "GHA job step"
      pattern: "run: pnpm lint:ui-spec"
---

# Phase 7 — Frontend UI-SPEC: Plan Index

> Master plan index for Phase 7. Each numbered plan file below is a self-contained
> task brief that gsd-executor consumes. Execution order is dictated by the
> `wave` and `depends_on` frontmatter fields in each plan.

## Scope (recap, authoritative)

Deliver two markdown UI-SPEC artifacts and a TypeScript spec linter, gated by GHA CI.
**No new API endpoints introduced** (steering rule D-S1). **No `apps/web/` scaffold** —
that work moves to Phase 8 per RESEARCH § Open Question 1.

- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` — 2 screens (A2, A3) per D-API4 / D-API5.
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` — 13 screens (U1–U13).
- `tools/lint-ui-spec.ts` + `tools/lint-ui-spec.test.ts` + `tools/lint-ui-spec.config.ts` + fixtures under `tools/lint-ui-spec/fixtures/`.
- `.github/workflows/ui-spec.yml` runs the linter on PRs touching relevant paths.
- `package.json` adds `lint:ui-spec` script; `lefthook.yml` wires pre-commit hook.

## Requirement → Plan Map

| Requirement | Description | Covered by plans |
|-------------|-------------|------------------|
| UI-SPEC-01 | Admin Console UI-SPEC (A2 Observability + A3 Config) | 01 (verify API), 03 (linter GREEN against admin fixtures), 04 (author UI-SPEC-admin.md), 06 (shared appendix + design-gap markers), 07 (full lint sweep) |
| UI-SPEC-02 | End-User UI-SPEC (U1–U13) | 01 (verify API), 03 (linter GREEN against end-user fixtures), 05 (author UI-SPEC-end-user.md), 06 (shared appendix + design-gap markers), 07 (full lint sweep) |
| UI-SPEC-03 | Target stack (Next 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5), WCAG 2.2 AA, responsive, themed, component inventory, design tokens | 04 + 05 (per-screen shadcn inventory), 06 (shared appendix: design tokens + breakpoint matrix + i18n key index + API endpoint index) |

## Wave Structure

```
Wave 0 (serial) — Foundation
  01  Verify upstream API shapes (read apps/api/src/routes/ + packages/auth/, pin response shapes)
  02  Linter tests + fixtures RED  (TDD red phase; produces failing tests for every lint rule)

Wave 1 (parallel after Wave 0) — Build
  03  Implement tools/lint-ui-spec.ts (turn 02's tests GREEN)
  04  Author UI-SPEC-admin.md          (2 screens × 9 subsections)
  05  Author UI-SPEC-end-user.md       (13 screens × 9 subsections)

Wave 2 (serial after Wave 1) — Integration
  06  Shared appendix authoring, design-gap markers, GHA workflow, lefthook hook,
      cross-file copy-key uniqueness sweep, package.json `lint:ui-spec` script

Wave 3 (serial after Wave 2) — Verifier-friendly close
  07  Full lint pass, STATE.md update, ROADMAP.md update,
      goal-backward must-have proof
```

**Lint gate location:** The cross-file `pnpm lint:ui-spec` gate runs in **Wave 2 (Plan 06)**, not Wave 1. Plans 04 and 05 author UI-SPEC content in parallel but do NOT invoke the linter (the `tools/lint-ui-spec.ts` binary is created by Plan 03 in the same wave). Acceptance for Plans 04/05 is content-inspection only; Plan 06 runs the full linter after Wave 1 completes.

| Plan | Wave | Depends on | Files modified | Autonomous |
|------|------|------------|----------------|------------|
| 01 — API shape verification | 0 | — | adds `## API Reference (verified)` to both UI-SPEC stubs (creates the stubs if absent) | yes |
| 02 — Linter tests RED + fixtures | 0 | 01 | `tools/lint-ui-spec.test.ts`, `tools/lint-ui-spec.config.ts`, `tools/lint-ui-spec/fixtures/**`, `package.json` (devDeps + script) | yes |
| 03 — Linter implementation GREEN | 1 | 02 | `tools/lint-ui-spec.ts` | yes |
| 04 — UI-SPEC-admin.md authoring | 1 | 01, 02 | `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` | yes |
| 05 — UI-SPEC-end-user.md authoring | 1 | 01, 02 | `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` | yes |
| 06 — Appendix, design-gap markers, GHA, lefthook | 2 | 03, 04, 05 | both UI-SPEC files (appendix), `.github/workflows/ui-spec.yml`, `lefthook.yml`, `package.json` (script confirmation) | yes |
| 07 — Finalize: full lint, STATE/ROADMAP | 3 | 06 | `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/phases/07-frontend-ui-spec/07-SUMMARY.md` | yes |

## File-ownership matrix (parallel safety check)

Wave 1 has three plans running in parallel (03, 04, 05). File-ownership is **disjoint**:

| File | Plan 03 | Plan 04 | Plan 05 |
|------|---------|---------|---------|
| `tools/lint-ui-spec.ts` | ✓ writes | — | — |
| `UI-SPEC-admin.md` | reads as fixture (via copy) | ✓ writes | — |
| `UI-SPEC-end-user.md` | reads as fixture (via copy) | — | ✓ writes |
| `tools/lint-ui-spec/fixtures/**` | reads only | — | — |

**No write conflicts in Wave 1.** Wave 2 (Plan 06) is the only writer that touches
both UI-SPEC files (appendix authoring) and is serialized after Wave 1 by `depends_on`.

## Constitutional Compliance (CLAUDE.md)

- **TDD enforced per-task**: every code task (02, 03) lands tests in the SAME atomic
  commit as production code; RED phase (02) precedes GREEN phase (03) by full plan.
- **Coverage ≥90/90/90/90 on diff**: enforced by `pnpm test --coverage` against
  `tools/lint-ui-spec*.ts` files. Plan 07 verifies.
- **No mocks of internal logic**: linter unit tests use real markdown fixtures under
  `tools/lint-ui-spec/fixtures/`, real Fastify route files under `apps/api/src/routes/`
  (read-only); only fs IO is exercised as-is.
- **GitHub Actions only**: workflow lands in `.github/workflows/ui-spec.yml`.
- **English-only source artifacts**: UI-SPEC body, code comments, identifiers,
  copy-key names — all English. Russian translations deferred to Phase 10.
- **No new API endpoints**: D-S1 enforced by Plan 01 (API verification) and the
  linter itself (Plan 03's endpoint-exists rule).

## Goal-Backward Verification (verifier checklist for /gsd-verify-phase 07)

A verifier confirms Phase 7 done when all checks below pass against the live tree:

1. ✅ `test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md`
2. ✅ `test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md`
3. ✅ `pnpm lint:ui-spec` exits 0
4. ✅ `grep -c "^## A[23] " UI-SPEC-admin.md` returns ≥ 2
5. ✅ `grep -cE "^## U([1-9]|1[0-3]) " UI-SPEC-end-user.md` returns ≥ 13
6. ✅ Each screen section contains all 10 required subsections (linter rule 1)
7. ✅ Every `(GET|POST|PATCH|DELETE) /api/...` inline-code endpoint resolves to either
      a Fastify route file under `apps/api/src/routes/` or the `BETTER_AUTH_PATHS` allowlist (linter rule 2)
8. ✅ Every copy key is globally unique across both UI-SPEC files and matches the
      5-level dotted schema `[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){4}` (linter rule 3)
9. ✅ Every `See visual: design/<file>.jsx#<Function>` reference resolves (linter rule 4)
10. ✅ ASCII wireframes pass the monospace tolerance check OR carry the visual-only sentinel (linter rule 5)
11. ✅ `.github/workflows/ui-spec.yml` exists and references `pnpm lint:ui-spec`
12. ✅ `package.json` exposes the `lint:ui-spec` script
13. ✅ Coverage on `tools/lint-ui-spec.ts` is ≥90/90/90/90 on diff
14. ✅ Three design-gap markers are encoded (U1 forgot-password, A3 effective-env removal, U4 activity-feed removal)
15. ✅ STATE.md updated with phase 7 completion entry; ROADMAP.md phase 7 checkbox ticked

## Execution Notes

- Commit message convention: `docs(07): <subject>` for spec authoring,
  `feat(07): <subject>` for linter code, `chore(07): <subject>` for tooling wiring,
  `test(07): <subject>` for RED test commits.
- Every commit is atomic and follows the CLAUDE.md rule that tests + implementation
  ship together in the same commit (Plan 02 commits failing tests + fixtures;
  Plan 03 ships the implementation that turns them green in a single commit).
- No emojis in any artifact (project rule).
- All paths absolute when referenced in command output; relative when referenced in spec body.
