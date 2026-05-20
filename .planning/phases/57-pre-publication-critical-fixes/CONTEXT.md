# Phase 57 — Pre-publication CRITICAL fixes

## Background

A pre-GitHub-publication code review (`.planning/review/REVIEW-INDEX.md`, dated 2026-05-20, branch main @ 6e43588) ran 11 parallel `gsd-code-reviewer` agents across all production code in `apps/**` + `packages/**`. The review surfaced **13 CRITICAL findings** that block public release of the repository.

The 13 CRITICAL findings fall into **6 fix tracks** (Tier 0 in the index). This phase closes all 6 tracks.

Out of scope for this phase: ~38 HIGH, ~49 MEDIUM, ~30 LOW findings — those become Phase 58+.

## Goal

After this phase:
1. All 13 CRITICAL findings from `REVIEW-INDEX.md` are fixed and verified.
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), in atomic commits where production code change and its tests live in the same commit.
3. Tests cover the regression-shape (i.e., would catch a future revert of the fix).
4. `pnpm test` is green across the monorepo; `pnpm lint:lockers` is green (all 8 lockers).
5. The repository is publication-ready on the security/correctness axis (Tier 0 only — HIGH/MED/LOW deferred).

## CRITICAL track summary

### Track A — Better Auth plaintext credentials at rest
Findings: **`data:CR-01` + `data:CR-03`**

Problem: `apps/api/src/auth.ts:160` `ENCRYPTED_COLUMNS_MAP = {}` is empty, so the envelope-encryption lens never fires for Better Auth-owned columns: `account.{password, access_token, refresh_token, id_token}`, `verification.value`, `sessions.{token, previous_token}`. Migration 0019 added 48 bytea sidecar columns that are dead schema. LOCKER-08 discipline was amended in commit 13a1547 to justify the gap with rationale ("the lens deletes plaintext before INSERT") that is mechanically false given the empty map. CLAUDE.md hard rule 1 violation — schema mutation driven by tests.

Fix: Populate `ENCRYPTED_COLUMNS_MAP` to cover every Better Auth-owned encrypted column. Restore the LOCKER-08 invariant to its pre-amendment text. Add an integration test that writes a Better Auth credential and verifies (a) plaintext column is empty/null after write, (b) ciphertext sidecars are populated, (c) lens round-trips correctly.

### Track B — Fail-OPEN RLS posture re-installed by migration 0024
Findings: **`data:CR-02`**

Problem: Migration 0024 (`0024_better_auth_tenant_id_defaults.sql`) re-installs `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'` (rolconfig DEFAULT) and `ALTER TABLE users/sessions/account/verification ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid`. Migration 0018 (CRIT-FIX-01 / Phase 32) had specifically RESET these to make RLS fail closed. Any code path missing `withTenant()` now silently reads the default tenant.

Fix: Either (option-A) write a forward migration 0027 that DROPs the rolconfig and removes the column DEFAULTs again, OR (option-B) replace 0024 with a variant that satisfies Better Auth's needs without rolconfig fallback (e.g. surface a Better Auth hook that always provides tenant context via `withTenant()` from request-scope before any DB call). Option-A is simpler; option-B is more durable. Decide during planning.

Either way, add a property-test that proves RLS fail-closes on bare connection: open a pool connection without `withTenant`, SELECT from a tenant-scoped table, verify ZERO rows returned (not "the default-tenant rows").

### Track C — `/api/_test/*` missing production-veto
Findings: **`api-routes-rest:CR-02` + `CR-03`**

Problem: `apps/api/src/routes/test-only.ts:202` (`/api/_test/force-rotate`) and line 311 (`/api/_test/reset-setup`) lack the `NODE_ENV === 'production'` veto that line 372 (`/api/_test/seed-tenant`) has. A misset `OPENWHISPR_TEST_ROUTES=true` in production allows any unauthenticated caller to (a) force a session-token rotation on any user, or (b) re-open the admin claim window.

Fix: Add the production veto to every handler in `test-only.ts` (not just seed-tenant). Better: lift the veto to the plugin-registration gate so the plugin itself refuses to register on `NODE_ENV='production'` regardless of `OPENWHISPR_TEST_ROUTES`. Add a regression test that starts the API with `NODE_ENV=production` + `OPENWHISPR_TEST_ROUTES=true` and asserts every `/api/_test/*` route returns 404.

### Track D — BYOK redact regex coverage gaps
Findings: **`byok:CR-01` + `CR-02`**

Problem: `packages/byok-guard/src/redact-url.ts:61-70` `BEARER_SHAPES` regex set is missing common provider key prefixes:
- GitHub PAT/OAuth: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`
- Tavily (shipped per memory `project_phase5_websearch.md`): `tvly-`
- Yandex (shipped per memory): `AQVN…`, `y0_…`
- AWS STS session keys: `ASIA…`

Plus the `sk-[A-Za-z0-9_-]{20,}` regex's ≥20 threshold lets `sk-…` with bodies ≤19 chars (LiteLLM virtual keys / sandbox keys) slip past.

Fix: Extend `BEARER_SHAPES` to cover all the above shapes. Lower the `sk-` threshold (16 is the LiteLLM virtual-key minimum — verify against LiteLLM source). Add a coverage test asserting every shape redacts; add property-test fuzzing key-like strings to catch future regressions.

### Track E — Host header injection bypassing Better Auth CSRF
Findings: **`api-routes-rest:CR-01`**

Problem: `apps/api/src/routes/better-auth-handler.ts:79` falls back to `req.headers.host` when both `INGRESS_BASE_URL` and `AUTH_URL` env are unset. The allowlist-pass and allowlist-fail branches return the same attacker-controlled `${proto}://${host}` value. Better Auth's CSRF/Origin/redirect-uri validation bypassable on any deploy without `INGRESS_BASE_URL` or `AUTH_URL`.

Fix: Make `INGRESS_BASE_URL` (preferred) or `AUTH_URL` boot-required. If both unset → `validateAuthBoot()` exits 78 (`EX_CONFIG`). Remove the `req.headers.host` fallback entirely. Add a boot-time regression test (unset both → exits 78) and a runtime test (bogus Host header → still uses INGRESS_BASE_URL origin).

### Track F — Production safety knobs unguarded
Findings: **`api-core:CR-01`**

Problem: `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_VERIFICATION`, `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE`, `MOCK_DIARIZATION` env vars currently WARN-log and continue when set in production. Breaks the loud-fail pattern (other safety knobs exit 78 on misuse).

Fix: Wrap each knob in `NODE_ENV === 'production'` check at boot. If knob is set AND production → `validateConfigBoot()` exits 78. Add a boot-time test per knob.

## Constraints

- **Strict TDD** — every fix RED→GREEN→REFACTOR. Test commit precedes production code commit OR test + production code land in the same atomic commit.
- **No mocks of internal logic** — DB-touching tests use real Postgres + PgBouncer via testcontainers (already wired in `apps/api`).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers must pass** — `pnpm lint:lockers` (all 8) must be green after every track lands.
- **No production code edited "to make tests pass"** — CLAUDE.md hard rule 1. If a test reveals a production-code constraint that blocks the obvious fix, log it in `.planning/deferred-items.md` and find an alternative.
- **Order of tracks during execution:** A → B → C → D → E → F (data tracks first because they require migration sequencing; A and B can be parallelized only if migration numbers don't clash).
- **Each track lands as its own commit pair** (test + impl) or atomic combined commit.
- **No skipped tests, no `.only`, no `.todo`.**
- **No `@ts-expect-error` without `issue-NNNN: <reason>` (LOCKER-02).**

## Verification gate

This phase passes when:
1. All 13 CRITICAL findings from `REVIEW-INDEX.md` have a corresponding RED test + GREEN fix on main.
2. `pnpm test` green across the monorepo.
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` green.
5. Spot-check of every CRITICAL fix: grep the fingerprint line in the source, confirm regression test references the finding ID in its name or comment.
6. `git log --oneline -<N>` shows expected commits on HEAD.
7. `.planning/review/REVIEW-INDEX.md` is updated with a "Closed by Phase 57" marker next to each closed finding.

## Reference

- Code review report: `.planning/review/REVIEW-INDEX.md`
- Per-package reports: `.planning/review/{api-core,api-routes-rest,data,byok-guard-contract-tests,worker,...}.md`
- CLAUDE.md hard rules: 1 (no schema mutation for tests), 3 (verify sub-agent claims), 4 (no gitleaks bypass)
- Constitutional lockers: LOCKER-01..08 (see CLAUDE.md §Constraints)
- Phase 32 / CRIT-FIX-01 (RLS fail-closed) — `.planning/phases/32-*`
- Phase 33 / CRIT-FIX-02 (envelope encryption) — `.planning/phases/33-*`
