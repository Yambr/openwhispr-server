# Test review — pre-publication audit

**Branch:** main @ 3df1060
**Date:** 2026-05-17
**Reviewers:** 3 parallel sub-agents (test-harness, test-quality, ci-coverage)
**Full run:** `pnpm test` → **33 files failed / 340 passed / 33 skipped** (4544 tests; 68 fail / 4104 pass / 372 skip; 180s)

## Headline

**Test infrastructure has three structural gaps** that masked the two production
bugs we just fixed (yaml dynamic-require crash + setup_state missing GRANT):

1. **Zero route-tests connect through the production app-role pool.** All six
   per-app `bootMigratedPostgres` helpers create `openwhispr_app` but never log
   in as it. `db = drizzle(ownerPool)` (BYPASSRLS, all grants) is used for every
   route handler test. The setup_state GRANT bug was invisible.
2. **No test ever imports the production esm bundle.** Tests import `.ts`
   sources directly; tsup output is never exercised. The yaml dynamic-require
   crash shipped green because no harness reproduced the bundled-runtime
   shape.
3. **Migration tests assert schema, not permissions.** `0001` checks `cols`
   contains `password`; `0017` checks the row exists. Neither asserts that
   `openwhispr_app` can SELECT the table. Mig 0021 is the lone in-tree
   precedent with `has_function_privilege('openwhispr_app', …)`.

Beyond that, CI has a **P0** — the `load-smoke` job in `.github/workflows/ci.yml`
is structurally broken (only `actions/checkout@v5` step survives; intended k6
steps swallowed into a downstream matrix job). Phase 44 cost-discipline gate
**does not run on PRs**.

## Severity bucket — actionable findings

### CRITICAL (CI gate broken; ship-blocker for v2.3)

- **CI-P0** `ci.yml:692-797` — `load-smoke` job is one-step (`checkout` only).
  All k6 / `make load-smoke` / log-capture steps land inside the next matrix
  job (`compose-lint`) which runs them 8× pre-bootstrap. Per
  `memory:feedback_loadtest_cost_discipline`, paid-provider gate is non-
  enforced. → `.planning/review-v2.2-close/ci-coverage-audit.md` §P0.

### HIGH (production-shadowing test gaps)

- **HARNESS-H-01** `apps/api/src/routes/__tests__/setup.ts:130` — route tests
  use `db = drizzle(ownerPool)`. **Fix:** make `bootMigratedPostgres` return
  `{ownerPool, appPool, ownerDb, appDb}` and force route tests onto `appDb`.
  Already promised by the helper (`appUri` exported, dead).
- **HARNESS-H-02..03** notes + v1/keys route-test setups — same shape.
- **QUALITY-H-02** zero production-bundle smoke tests. → Add a `tests/self-tests/api-bundle-imports.test.ts` that spawns `node apps/api/dist/index.js`
  with a dummy `.env` and asserts boot reaches "listening" without crash.
  Closes yaml-require regression class.
- **QUALITY-H-03** `apps/api/tests/unit/lib/audit.test.ts:437-451` —
  `try { recordAudit(...) } catch {}` swallows thrown assertions.
- **QUALITY-H-04** 13+ route tests use `makeFakeDb()` intercepting
  `drizzle.transaction.execute` and grep-asserting on SQL string substrings,
  not real DB behaviour. Re-write under `appDb` from H-01.
- **QUALITY-H-08** entrypoint boot test mocks 13 production modules —
  the only remaining assertion is "the captured arg has a `.db` property
  without `.pool`". Coverage theatre.

### MEDIUM (test-debt + new failures from v2.2 fixes)

#### A. Phase-33 plaintext-column tests not migrated to post-0020 invariant (8 fails)

The Phase 33 envelope-encryption migrations dropped plaintext `password` /
`value` / `access_token` / `refresh_token` columns and replaced them with 6
`bytea` sidecars each. Tests of migrations 0001/0002/0017/0019 still assert
the pre-0020 shape:

- `tests/unit/__tests__/0001_better_auth.test.ts` — `expect(cols).toContain("password")` / `"value"` → expect 6 sidecars instead.
- `tests/unit/__tests__/0002_oauth_state.test.ts` — same shape.
- `migrations/__tests__/0017-setup-state.test.ts` — pre-0020 row layout.
- `migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts` (12 fails) — asserts intermediate-state columns that no longer exist after 0020.
- `tests/unit/__tests__/lookup-by-previous-token.test.ts` (2 fails) — references DROPped function (0019b dropped the SECDEF).
- `tests/unit/__tests__/backfill-cli.test.ts` (2 fails) — CLI fixture data shape.
- `tests/unit/__tests__/migrate-litellm-db.test.ts` (1 fail).
- `migrations/__tests__/0014-audit-log-partition.test.ts` (1 fail).

→ Either rewrite to post-0020 invariant OR mark as `it.skip` with TODO. Same
class as Phase-32 DEFERRED (`32-DEFERRED.md`). Deferred to v2.3 by Hard
Rule 1 (don't rewrite production migration to make tests pass; rewrite
tests to current production reality).

#### B. v2.2 hotfix-2 regressions (1 fail; fix sequence-of-1)

- **`tests/integration/compose-overlays.test.ts:334`** —
  `expect(env.DATABASE_URL).toMatch(/pgbouncer:6432/)`. After today's
  `pgbouncer:6432 → pgbouncer:5432` overlay fix (commit `3df1060`), the
  test still asserts the old port. → change matcher to `pgbouncer:5432`.
- **`tests/integration/compose-overlays.test.ts:326`** title still says
  ":6432" — update title too.

#### C. CI gates with `continue-on-error` (3 files; flips required, not blocking)

- `ci.yml:lint-tdd` — `continue-on-error: true` despite TDD being constitutional.
- `nightly.yml:dep-audit` — `|| true` swallows exit code.
- `nightly.yml:load-test-placeholder` — literal `echo` stub.

→ `.planning/review-v2.2-close/ci-coverage-audit.md` §P1.

#### D. Tool linter own-tests (26 fails)

`tools/lint-{no-suppressions,prod-readiness,shell-credential-interpolation,
secret-shape-in-error,rls,compose-resources}.test.ts` — each linter's own
test exercises the linter against the live tree as a regression sentinel.
Failures here mean the **linter found new violations** in current tree, OR
the linter's fixture changed. Investigate per-linter:
- `lint-no-suppressions` (12 fails) — probably the most informative; look
  at the violation list, decide if it's real new debt vs harness drift.
- `lint-rls` (5 fails) — pg_partman child-table handling changed?
- `lint-prod-readiness` (3 fails) — LOCKER-04 allowlist drift?

→ Each linter own-test is a P1 to investigate before v2.3.

#### E. Live-stack-required tests (4 fails)

- `tests-self-tests/api-container-healthy.test.ts` (1 fail) — needs `docker compose up`.
- `tests-self-tests/migrate-gates-api.test.ts` (1 fail) — same.
- `tests-self-tests/load-smoke-cost-discipline.test.ts` (1 fail) — verifies CI gate; tied to **CRITICAL CI-P0** above.
- `tests-self-tests/refuse-default-secrets.test.ts` (1 fail) — bootstrap.sh smoke.

→ Reproducible only against running compose. Investigate during v2.3 stack
fixes.

#### F. Worker / api domain tests (12 fails)

- `apps/api/tests/unit/routes/agent/stream.test.ts` (9 fails) — Phase 41.b
  HI-02 edge cases (Tests 7/8/10): finishReason='upstream_error' vs
  'stream_error', AbortController on raw.close, x-litellm-call-id leak
  test asserts opposite of fix. These are HARNESS bugs after the fix
  changed behaviour; tests not updated.
- `apps/api/tests/unit/__tests__/auth-session-token-shape.test.ts` (2 fails) —
  Phase 33 token-storage shape changed.
- `apps/api/tests/unit/routes/test-only.test.ts` (1 fail).

### LOW (cosmetic / accepted debt)

- `tests-integration/env-slim-example.test.ts` (2 fails) — overlay key
  inventory drift (we added overlay vars to local `.env`; the test
  asserts the slim-example shape, not `.env`).
- 8 LOW migration tests doing owner-only schema checks (harness audit
  catalogued under `.planning/review-v2.2-close/test-harness-audit.md`).
- 30+ weak content-free assertions (`length > 0`, `toBeDefined()` on
  non-null types) catalogued under `test-quality-audit.md`.

## How to check tests are green

```bash
# All workspaces (real Postgres testcontainers; ~3 min)
pnpm test

# Single workspace
pnpm --filter @openwhispr/api test
pnpm --filter @openwhispr/data test

# Single file (cd into the package or use --filter)
cd packages/litellm-client && pnpm exec vitest run tests/unit/model-aliases.test.ts
pnpm --filter @openwhispr/api exec vitest run tests/unit/routes/__tests__/setup-state.test.ts

# Watch (single file)
cd apps/api && pnpm exec vitest tests/unit/routes/__tests__/setup-state.test.ts

# Coverage
pnpm test:coverage

# E2E (compose must be up; gated by env)
E2E=1 pnpm exec vitest tests/e2e
```

Vitest summary parser:

```
Test Files  N failed | M passed | K skipped (TOTAL)
Tests       N failed | M passed | K skipped (TOTAL)
```

Exit 0 ⇔ all green. CI gates: `pnpm test:ci` runs the same surface plus
coverage thresholds.

## Recommended action plan

### v2.2-close (now, before GitHub publish)

1. **Fix `compose-overlays.test.ts` 6432 → 5432** (1-line; closes the only
   pure regression from today's hotfix-2). ≤5 min.
2. **Promote `bootMigratedPostgres` to return `{ownerPool, appPool, ownerDb,
   appDb}`** — keep all existing callers on `ownerDb` (no behaviour change)
   but expose `appDb` so v2.3 tests can opt in. `appUri` is already exported
   and dead; this just makes it consumable. ≤30 min.
3. **CI P0 (`load-smoke` broken)** — minimum: open a GitHub issue documenting
   the structural break. Full fix (rewire YAML steps back into the right
   job) is a focused PR — recommend 1-hour task. **Ship-blocker for v2.3.**

### v2.3 (next milestone, first phase)

- **TEST-HARNESS-1** rewrite all 6 per-app `setup.ts` helpers + 13 makeFakeDb-using route tests to consume `appDb` from H-01 fix. Cover the 3 HIGH from harness audit.
- **TEST-PROD-BUNDLE-1** add `tests/self-tests/api-bundle-boot.test.ts` that spawns the production esm bundle. Closes yaml-require regression class.
- **TEST-MIG-PERMS-1** every migration test gets a "and openwhispr_app can SELECT/INSERT/UPDATE as expected" assertion. Codify mig 0021 pattern.
- **TEST-32-DEFERRED-1** + **TEST-33-DEFERRED-1** rewrite 8 Phase-33 fail-by-design tests (Category A above) to post-0020 invariant.
- **CI-HARDEN-1** fix `load-smoke` job, flip `lint-tdd` continue-on-error off, fix `nightly.yml` echo stub + `|| true`, expand path filters on `web.yml` / `conformance-axe.yml`.
- **CONST-AMEND** add to CLAUDE.md Hard Rules:
  > Tests covering production code that runs as `openwhispr_app` MUST connect via an `openwhispr_app` pool.

### Optional now (≤10 min each)

- Mark the 8 Phase-33 plaintext tests with `it.skip` + `TODO(v2.3)` — keeps `pnpm test` green for publish.
- Update `compose-overlays.test.ts:326,334` (5432).

## Source artifacts

- `.planning/review-v2.2-close/test-harness-audit.md` — 3 HIGH + 6 MEDIUM + 8 LOW
- `.planning/review-v2.2-close/test-quality-audit.md` — 8 HIGH + 30+ MEDIUM + LOW
- `.planning/review-v2.2-close/ci-coverage-audit.md` — 1 P0 + 6 P1
- `/tmp/full-test-run.log` — full `pnpm test` output
