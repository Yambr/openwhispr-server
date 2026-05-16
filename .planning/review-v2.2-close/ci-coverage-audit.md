# CI Test-Coverage Audit — openwhispr-server

**Scope:** `.github/workflows/*.yml`, root + workspace `vitest.config.ts`, `lefthook.yml`, `package.json` scripts, `Makefile` e2e targets.
**Repo HEAD audited:** `3df1060` (working tree, branch `main`).
**Audit date:** 2026-05-17.
**Constitutional baseline:** DISCIPLINE rule "max test automation, no human QA"; per-phase ≥90/90/90/90 coverage floor; mandatory e2e on user-visible changes.

This is a **catalog**, not a fix plan. Findings are tiered **P0 / P1 / P2 / INFO**:
- **P0** — CI silently does not run what its YAML claims; constitutional gate is broken.
- **P1** — Gate runs but is weakened (advisory, conditional, narrow path filter, mis-scoped).
- **P2** — Inconsistent / drift-prone but not currently broken.
- **INFO** — Documented design choice, here for visibility.

---

## 1. Workflow × Job × Gate Matrix

### 1.1 `.github/workflows/ci.yml` — main PR gate

| Job | Trigger | `if:` gate | `continue-on-error` | Blocks PR? | Notes |
|---|---|---|---|---|---|
| `lint` | PR + push:main | none | no | yes | biome `pnpm lint` |
| `lint-english` | PR + push:main | none | no | yes | runs 5 separate linters incl. `make lint:lockers` + allowlist-diff |
| `commitlint` | PR + push:main | `if: pr` | no | PR-only (intentional) | |
| `typecheck` | PR + push:main | none | no | yes | `pnpm typecheck` runs `tsc --noEmit` per workspace |
| `i18n-completeness` | PR + push:main | none | no | yes | `pnpm test:i18n-completeness` |
| `test` | PR + push:main | none | no | yes | `pnpm test` (vitest root w/ coverage). `TESTCONTAINERS_RYUK_DISABLED=true`. |
| `mutation-quick` | PR-only | `if: pr` | **NO** ← but no required-check guarantee | depends on branch-protection.json | Stryker incremental. NOT marked advisory; will block PR if branch protection lists it. |
| `pr-checklist` | PR-only | `if: pr` | no | yes (when listed) | `require-checklist-action` |
| `lint-tdd` | PR-only | `if: pr` | **`continue-on-error: true`** (line 165, "advisory in v1 / D-21") | **NO — ADVISORY** | **P1 — see §5** |
| `lint-tenant-context` | PR + push:main | none | no | yes | static AST walk of `apps/worker/src/jobs/**` |
| `harness-self-check` | PR + push:main | none | no | yes | runs `tests/self-tests/` + tool-version sanity |
| `lint-rls` | PR + push:main | none | no | yes | spins postgres-service, runs `pnpm migrate` + `pnpm lint:rls` |
| `test-migration` | PR + push:main | none | no | yes | **forward-apply → drop → re-apply → schema-diff** (good) |
| `contract-test` | PR + push:main | needs lint/typecheck/test | no | yes | docker-compose w/ hermetic LiteLLM mock + `fixture-idp` |
| `e2e-hermetic` | PR + push:main | needs lint/typecheck/test | no | yes | `make e2e-hermetic` — Plan 09 hermetic suite, NO real keys needed |
| `e2e-phase6-quick` | PR + push:main | needs lint/typecheck/test | no | yes | 3 fastest Phase-6 tests (probes-dep, audit-log, rate-limit). Full 8 nightly. |
| `lint-gherkin-tags` | PR + push:main | none | no | yes | Phase 21 SR-21.1 |
| `lint-playwright-config` | PR + push:main | none | no | yes | Phase 21 SR-21.2 |
| `lint-steps-have-unit-tests` | PR + push:main | none | no | yes | Phase 21 SR-21.3 |
| `prod-edit-guard` | PR-only | `if: pr` | no | yes | Phase 21 SR-21.4 — Hard Rule #1 |
| `coverage-floor` | PR-only | `if: pr` | no | yes | Phase 21 SR-21.5 — per-file 90/90/90/90 on diff (this IS the enforced gate, see §6) |
| `smoke` | PR + push:main | none | no | yes | slim-core compose + `pnpm smoke` |
| **`load-smoke`** | PR-only | `if: pr` | no | **STRUCTURALLY BROKEN — see §9 / P0-1** | declared but body collapsed |
| `compose-lint` | PR + push:main | matrix of 8 cells | no | yes | **steals load-smoke's steps — see §9 / P0-1** |
| `compose-lint-resources` | PR + push:main | none | no | yes | `make lint-compose-resources` |

### 1.2 `.github/workflows/nightly.yml` — cron 03:00 UTC

| Job | Schedule | Gate | Cost | Notes |
|---|---|---|---|---|
| `full-mutation` | nightly | none | minutes | `pnpm test:mutation` (Stryker full) |
| `lockers-nightly` | nightly | none | seconds | re-invokes LOCKER-04/05/06 **without** `--warn-only` so WARN-only-on-PR gates surface failures nightly. See §11. |
| `load-test-placeholder` | nightly | none | 0 | **`echo "k6 load test placeholder - wired in Phase 8"`** — `make load-test` is NOT in CI, only via this echo stub. **P1 — see §9.2** |
| `e2e-test` (real-provider) | nightly | step-level `if: steps.gate.outputs.have_keys == 'true'` | $$ per run | gated on `secrets.OPENROUTER_API_KEY` presence; falls to no-op if missing. **NOT in branch-protection.** |
| `dep-audit` | nightly | none | seconds | **`pnpm audit --prod \|\| true`** — exit code swallowed; advisory only. **P1 — see §5** |
| `backup-roundtrip` | nightly | none | minutes | age-encrypted pg_dump → drop → restore → schema-diff. Uses `secrets.BACKUP_AGE_IDENTITY`. |
| `e2e-phase6` (full 8) | nightly | none | ~30 min | full Phase-6 e2e suite (`make e2e-test-phase6`). Hermetic. **NOT in branch-protection.** |

### 1.3 Other workflow files

| File | Trigger | What it gates | Notes |
|---|---|---|---|
| `e2e-cjm.yml` | PR + push:main | `make e2e-cjm` (gated `E2E_CJM=1`) | Boots hermetic `-p e2e-cjm` compose project; runs playwright-bdd. Includes "no leaked testcontainers" assertion. Required. |
| `conformance-axe.yml` | PR (path-filtered) + push:main | axe-core baseline against `/sign-in`, `/sign-up`, `/verify-email`, `/setup`, `/admin` | **PR path filter — see §10** |
| `web.yml` | PR (path-filtered) + push:main | typecheck → vitest → build → size-limit → playwright | **PR path filter — see §10** |
| `lint-migrations.yml` | PR (path-filtered) + push:main | squawk-gate on new SQL + `pnpm test:lint-migrations` 90/90/90/90 | PR path filter `drizzle/**/*.sql`, etc. **Migration-runner code outside `drizzle/` not gated.** |
| `ui-spec.yml` | PR (path-filtered) + push:main | `pnpm lint:ui-spec` + `pnpm test:lint-ui-spec` | path filter — fine, narrow scope |
| `spdx.yml` | PR (path-filtered) + push:main | `pnpm spdx:check` + `pnpm test:spdx-header` | path filter limited to `**/*.{ts,tsx,js,jsx,mjs,cjs}` |
| `reuse-lint.yml` | PR + push:main (path negation) | REUSE 3.3 compliance | broad path filter |
| `verify-images.yml` | PR (path-filtered) + push:main | `scripts/verify-images.sh` image-pin check | narrow filter |
| `chart-release.yml` | tags / dispatch | helm chart release | release-only |
| `helm-lint.yml` | PR + push | helm chart static lint | |
| `helm-release.yml` | tags / dispatch | helm release | |
| `helm-upgrade-matrix.yml` | (need to confirm) | k8s upgrade matrix | not audited in this pass |
| `release.yml` | tags / dispatch | release pipeline | |
| `nightly-realtime-soak.yml` | cron 06:00 UTC + tags `v*` + dispatch | 65-min live OpenAI Realtime soak | cost-gated — explicit `if:` belt-and-suspenders. **NOT in branch-protection.** |
| `expected-red-staleness.yml` | cron Mon 09:07 UTC + dispatch | issues a tracking issue when @expected-red goes stale | reporting-only |
| `security.yml` | PR + push:main + weekly cron | gitleaks, trivy-fs (CRIT/HIGH, exit-code 1), codeql (js/ts), license-scan | all blocking |

---

## 2. `E2E=1` / `E2E_CJM=1` Environment Gates — Verified Runs in CI

| Suite | Gate | Set in CI? | Where |
|---|---|---|---|
| `tests/e2e/*.e2e.test.ts` (DISCIPLINE-rule-3 hermetic back-fill) | `E2E=1` | **YES** | `ci.yml:e2e-hermetic` → `make e2e-hermetic` exports `E2E=1` |
| `tests/e2e/*.test.ts` (Plan 09 realtime+stream) | `E2E=1` | **YES** | `ci.yml:e2e-phase6-quick` line 522; `Makefile:e2e-test` requires `E2E=1` |
| `tests/e2e/realtime-soak-live.test.ts` | `E2E=1` + `OPENWHISPR_E2E=1` + real `OPENAI_API_KEY` | **schedule + tag + dispatch only** | `nightly-realtime-soak.yml` — NOT on PR (intentional cost gate) |
| `tests/e2e-cjm/**` (playwright-bdd) | `E2E_CJM=1` | **YES** | `e2e-cjm.yml` sets `E2E_CJM=1`; Makefile target refuses without it |
| Phase 6 full 8-test suite | `E2E=1` via `make e2e-test-phase6` | **nightly only** | `nightly.yml:e2e-phase6` — NOT in branch-protection |
| Real-provider contract (`make e2e-test`) | `E2E=1` + 4 provider keys | **nightly + `have_keys==true`** | `nightly.yml:e2e-test` step-level gate |

**Tests/e2e directory invariant**: `tests/e2e/vitest.config.ts` has `include: E2E_ENABLED ? ["**/*.e2e.test.ts"] : []`. Without `E2E=1`, root `pnpm test` skips this whole tree by **empty include** — silent skip, not error. This is by design but worth noting: local `pnpm test` never executes these unless the dev sets `E2E=1`.

---

## 3. Workspace `vitest.config.ts` — Excludes / `passWithNoTests` Catalog

`passWithNoTests` does NOT appear in any workspace config. Good.

### Per-workspace coverage exclusions (cumulative on top of root `exclude:`)

| Config | `coverage.include` | Local exclusions | Thresholds |
|---|---|---|---|
| `vitest.config.ts` (root) | `apps/**/src/**/*.ts`, `packages/**/src/**/*.ts` | `**/*.test.ts`, `**/*.spec.ts`, `**/*.gen.ts`, `**/dist/**`, `**/node_modules/**`, `**/.stryker-tmp/**`, `**/reports/**`, `tests/**`, `scripts/**`, **`packages/i18n/src/index.ts`** (Phase-0 stub), **`apps/api/src/index.ts`** (Phase-0 stub — comment says "Plan 03 Task 2 fills this in"; needs verification it's still a stub), **`packages/data/src/schema/**`** (drizzle declarative — phantom v8 sourcemap), **`packages/data/src/migrate.ts`** (CLI) | **85/80/80/85** — does NOT match constitutional 90/90/90/90 |
| `apps/api/vitest.config.ts` | `src/**/*.ts` (merged onto root excludes) | none added | 90/90/90/90 |
| `apps/worker/vitest.config.ts` | `src/**/*.ts` | `src/index.ts`, `**/*.test.ts` | 90/90/90/90 |
| `apps/web/vitest.config.ts` | `src/**/*.{ts,tsx}` (FRESH config, does NOT mergeConfig root) | `src/**/*.test.{ts,tsx}`, `src/**/__tests__/**`, **`src/app/**/page.tsx`**, **`src/app/**/layout.tsx`**, **`src/app/**/route.ts`** (RSC routes — Playwright-only), **`src/components/ui/**`** (vendored shadcn), **`src/lib/utils.ts`** | 90/90/90/90 |
| `packages/data/vitest.config.ts` | `src/**/*.ts` (root excludes flow through) | none added | 90/90/90/90 |
| `packages/byok-guard/vitest.config.ts` | `src/**/*.ts` | none | 90/90/90/90 |
| `packages/email/vitest.config.ts` | `src/**/*.ts` | none | 90/90/90/90 |
| `packages/litellm-client/vitest.config.ts` | `src/**/*.ts` | none | 90/90/90/90 |
| `packages/contract-tests/vitest.config.ts` | NO coverage config | NO coverage | n/a — runs against deployed backend |
| `tools/load-test/vitest.config.ts` | `src/**/*.ts`, `scripts/**/*.ts` | **`src/main.ts`** (k6 entry), **`src/smoke.ts`**, **`src/baseline.ts`** (k6 entry), `src/k6.config.ts`, `src/fixtures/**`, `scripts/**/*.mjs` | 90/90/90/90 |
| `tools/test-probe/vitest.config.ts` | `src/probe.ts` ONLY | n/a | **NO thresholds set** — `coverage` section has no thresholds at all. **P2 — see §6** |
| `compose/mock-litellm/vitest.config.ts` | `src/**/*.ts` | `**/*.test.ts`, **`src/server-bootstrap.ts`** | 90/90/90/90 |
| `tests/e2e/vitest.config.ts` | n/a (no coverage stanza) | E2E-gated includes | n/a |
| `tests/e2e/mock-realtime/vitest.config.ts` | `server.ts` ONLY | tests + dist + node_modules | 90/90/90/90 |
| `vitest.smoke.config.ts` | none | no coverage | smoke probes — intentional |

**Excluded files worth re-checking each phase (Phase-0 stub allowlist):**
- `apps/api/src/index.ts` — root config excludes this with comment "drop the root-level exclusion for that file in the SAME commit" when real Plan-03 multipart wiring lands. **Has that exclusion been removed?** If apps/api/src/index.ts is now real production code, coverage is silently skipped.
- `packages/i18n/src/index.ts` — Phase-0 placeholder excluded; if the package is now real, coverage is bypassed.
- `packages/data/src/schema/**` — entire drizzle schema dir excluded. Behavior asserted via integration tests per ADR-0002; this is by design but a large surface to trust to integration coverage alone.

---

## 4. Root `projects:` Array Registration

Root `vitest.config.ts:39-152` lists these projects:

**Explicit config-path entries:**
```
apps/api, apps/web, apps/worker
packages/byok-guard, packages/contract-tests, packages/data,
  packages/email, packages/litellm-client
tools/load-test, tools/test-probe
compose/mock-litellm
tests/e2e, tests/e2e/mock-realtime
```

**Inline-project entries** (workspaces without their own vitest.config.ts):
```
@openwhispr/auth-stub          → packages/auth/tests/**/*.test.ts
@openwhispr/i18n-stub          → packages/i18n/tests/**/*.test.ts
@openwhispr/observability      → packages/observability/tests/**/*.test.ts
@openwhispr/wire-schemas       → packages/wire-schemas/tests/**/*.test.ts
tools                          → tools/*.test.ts + tools/__tests__/*.test.ts
                                  (excludes load-test/**, test-probe/**)
tests-e2e-cjm-steps            → tests/e2e-cjm/steps/__tests__/*.test.ts
tests-integration              → tests/integration/**/*.test.ts
tests-self-tests               → tests/self-tests/**/*.test.ts
```

**Cross-check vs `find -name tests` directories present:**
```
apps/web/tests           — covered by apps/web/vitest.config.ts (Playwright owns tests/e2e/**)
apps/api/tests           — covered by apps/api/vitest.config.ts (via inherited include patterns; verify)
apps/worker/tests        — covered by apps/worker/vitest.config.ts
packages/contract-tests/tests — covered (own config)
packages/data/tests      — covered (own config; verify include glob picks up tests/**)
packages/email/tests     — covered
packages/byok-guard/tests — covered
packages/litellm-client/tests — covered
charts/openwhispr/tests  — Helm template tests; NOT in vitest scope (intentional, runs via helm-lint workflow)
```

**Concern P2-1**: Several workspace configs (apps/api, packages/data, packages/byok-guard, packages/email, packages/litellm-client) `mergeConfig` from root but **do NOT declare an explicit `include` glob for their own tests directory**. They rely on inherited defaults from vitest. Verify each picks up `tests/**/*.test.ts` post the Phase-15 STRUCT-01 codemod move. The `tests-integration` and `tests-self-tests` inline entries were added BECAUSE they had drifted out of discovery (per root config comment) — same drift risk applies to anything that doesn't appear in the projects array AND doesn't ship its own vitest.config.

**`tools/` discovery glob** (`*.test.ts` + `__tests__/*.test.ts`) — counted file present at `tools/__tests__/lint-no-plaintext-secret-columns.test.ts` plus many sibling `tools/lint-*.test.ts`. Look fine.

---

## 5. `pnpm test` vs Targeted Scripts — Discrepancies

| Command | What runs | Used in CI? |
|---|---|---|
| `pnpm test` (= `vitest run --coverage`) | All projects in root `projects:` array | `ci.yml:test` job line 125 + `coverage-floor:test --coverage` |
| `pnpm test:i18n-completeness` | `pnpm --filter @openwhispr/api test:i18n-completeness` | `ci.yml:i18n-completeness` |
| `pnpm test:contract` | contract-tests workspace | NOT in any CI job; runs via `make contract-test` docker target |
| `pnpm test:mutation` (Stryker full) | mutation testing | nightly only |
| `pnpm test:mutation:incremental` | incremental stryker | `ci.yml:mutation-quick` |
| `pnpm test:e2e` | `playwright test` (default config) | NOT directly invoked in CI; web/cjm/conformance workflows use scoped playwright invocations |
| `pnpm test:lint-<NAME>` (~20 such scripts) | per-tool 90/90/90/90 coverage gate | called by `ci.yml:lint-gherkin-tags / lint-playwright-config / lint-steps-have-unit-tests / prod-edit-guard / coverage-floor / etc.` |
| `pnpm smoke` (= `vitest run --config vitest.smoke.config.ts`) | smoke probes | `ci.yml:smoke` |

**Discrepancies found:**

- **D1 (P2)**: There is no `pnpm test:ci` script — CI just runs `pnpm test`. So in principle local `pnpm test` and CI `pnpm test` execute the same projects. **HOWEVER:** local devs do NOT have `E2E=1` set by default, so the `tests/e2e/*.e2e.test.ts` glob expands to `[]` and the e2e suite is silently skipped locally. Same applies to CI's `test` job — it does NOT set `E2E=1`, so the root `pnpm test` skips the entire `tests/e2e` project there too. **The hermetic e2e suite runs ONLY in the dedicated `e2e-hermetic` and `e2e-phase6-quick` jobs.** This is by design but worth flagging — `pnpm test` is NOT the universal "run everything" command its name implies.

- **D2 (P1)**: `lint-tdd` is `continue-on-error: true` on PR (advisory in v1 per D-21 comment). **The TDD gate is therefore non-enforcing at the CI layer.** Any TDD violation lands silently green. Per CLAUDE.md constitutional rule, TDD is "NON-NEGOTIABLE" — the advisory designation is a documented degradation. **Action: schedule the flip-to-blocking phase.**

- **D3 (P1)**: `dep-audit` in `nightly.yml` runs `pnpm audit --prod || true` — exit code is **explicitly swallowed**. Comment says "advisory; Dependabot is the blocking path". Confirm Dependabot is configured at `.github/dependabot.yml` (not audited here).

- **D4 (P2)**: `mutation-quick` does NOT have `continue-on-error`. If it's not listed in branch-protection's required_status_checks, it's PR-visible-but-non-blocking. Audit `scripts/branch-protection.json` separately to confirm.

---

## 6. Coverage Thresholds — 85/80 vs 90/90 Floor

**Root `vitest.config.ts` line 202-207:**
```
thresholds: { lines: 85, branches: 80, functions: 80, statements: 85 }
```

DISCIPLINE rule states ≥90/90/90/90 on **new/modified code**.

**Resolution actually used:** Per-file 90/90/90/90 enforcement is delegated to:
1. **Per-workspace `vitest.config.ts` files** which `mergeConfig` and override to 90/90/90/90. Comment at root `vitest.config.ts:43` confirms this is the intentional layering.
2. **`coverage-floor` job in `ci.yml`** (Phase 21 SR-21.5) which runs `pnpm tsx tools/lint-coverage-floor-per-phase.ts --summary coverage/coverage-summary.json --changed <PR-diff>` — the actual constitutional gate.

**Gap (P1)**: The 85/80/80/85 root threshold is the "global aggregate" floor, NOT a 90 floor. If the per-workspace 90 override is missing from any workspace, that workspace silently runs against 85/80. **Currently missing 90/90/90/90:**
- `tools/test-probe/vitest.config.ts` — no thresholds at all (relies on root 85/80)
- `tests/e2e/vitest.config.ts` — no coverage stanza (intentional; e2e doesn't measure coverage)
- `packages/contract-tests/vitest.config.ts` — no coverage stanza (intentional)
- Inline-project entries in root `projects:` array (auth-stub, i18n-stub, observability, wire-schemas, tools, tests-e2e-cjm-steps, tests-integration, tests-self-tests) **inherit the 85/80 floor** because they `extends: true` from root. **Per-stub-package coverage is therefore measured at 85/80, not 90/90.** The `coverage-floor` job's per-file diff check is the only line of defense for these.

**Gap (P2)**: `apps/web/vitest.config.ts` does NOT `mergeConfig(rootConfig, …)` — it defines a fresh config. This is fine but means root excludes (Phase-0 stub allowlist, drizzle schema) do not apply. Currently no apps/web files appear in the root stub allowlist, so this is benign.

---

## 7. Lefthook Hooks — Glob-Scoped Test Gates

**`pre-commit`** (`parallel: true`):

| Hook | Glob | What runs | Skip condition |
|---|---|---|---|
| `gitleaks` | (no glob — scans staged diff) | `gitleaks protect --staged …` | never |
| `biome` | `*.{ts,tsx,js,jsx,json}` | `biome check --write {staged_files}` | non-source commit |
| `english` | (no glob) | full repo lint | never |
| `colocated-tests` | `{apps,packages}/*/src/**/*.test.ts` | `pnpm lint:colocated-tests` | **commit touches no co-located *.test.ts** |
| `phase-tag-comments` | `{apps,packages}/**/*.{ts,tsx}` | `pnpm lint:phase-tag-comments` | doc-only commits skip |
| `dockerfile-tls` | `**/Dockerfile` | `pnpm lint:dockerfile-tls` | non-Dockerfile commits skip |
| `lockers` | `{apps,packages}/*/src/**/*.{ts,tsx}` | `make lint:lockers` | **commits touching only docs/`.planning/`/`tests/`/tools/ SKIP THE LOCKERS** — CI re-runs them via `lint-english` job |
| `tenant-context` | `apps/worker/src/jobs/*.ts` | `pnpm exec tsx tools/lint-tenant-context.ts` | jobs untouched → skip |
| `ui-spec` | curated set | `pnpm lint:ui-spec` | unrelated commits skip |
| `web-typecheck` | `apps/web/**/*.{ts,tsx}` | `pnpm --filter @openwhispr/web typecheck` | non-web commits skip |
| `gherkin-tags` | `{tests/e2e-cjm/features/**/*.feature,docs/customer-journeys.md}` | `pnpm lint:gherkin-tags` | unrelated commits skip |
| `playwright-config` | `{**/playwright.config.ts,apps/**/*.{test,spec}.ts,tests/**/*.{test,spec}.ts}` | `pnpm lint:playwright-config` | unrelated commits skip |
| `steps-have-unit-tests` | `tests/e2e-cjm/steps/**/*.ts` | `pnpm lint:steps-have-unit-tests` | unrelated commits skip |

**`pre-push`** (`parallel: true`):

| Hook | Glob | What runs |
|---|---|---|
| `gitleaks` | (none — scans commit range) | `gitleaks detect --redact …` |
| `web-test` | `apps/web/**` | `pnpm --filter @openwhispr/web test:unit` |

**`commit-msg`**: `commitlint`.

**Findings:**
- **P2 — Hook scope insurance**: Every hook is glob-scoped — a commit that only touches docs or `.planning/` runs only `gitleaks` + `english` + `commitlint`. This is **fine for pre-commit speed** because every gate also runs in CI on every PR. The risk is a developer who does `--no-verify` for one commit and the CI pipeline does not catch it; mitigated by CI re-running everything.
- **P1 — Coverage NOT in pre-push**: `pre-push` does NOT run the full vitest suite or coverage. Only `apps/web` unit tests. That is acceptable iff CI is the enforcement layer — which it is. Worth documenting.

---

## 8. Migration Safety / Sequencing

| Job / Workflow | Runs against | Asserts |
|---|---|---|
| `ci.yml:test-migration` | Fresh postgres-service per run | **Forward-apply → schema dump → DROP schema → forward-apply again → schema diff** — proves idempotency. Schema-preamble normalization filters pg_dump nondeterminism. |
| `ci.yml:lint-rls` | Fresh postgres-service per run | Boots roles, applies migrations once, runs RLS-introspection lint |
| `nightly.yml:backup-roundtrip` | Fresh postgres-service per run | Migrations applied → seed-free backup → drop DB → restore → schema-diff. Effectively verifies backup→restore preserves schema. |
| `lint-migrations.yml:squawk-gate` | NO database | Static squawk lint on new SQL files vs PR base + 90/90/90/90 unit-test gate on the lint driver itself |

**Gap (P1) — "existing-data" migration test missing**: All migration jobs run against a **fresh database**. There is no CI job that:
1. Seeds Postgres with realistic data,
2. Applies the new migration,
3. Verifies row-level invariants survive (no data loss, no constraint violations on existing rows).

This is the canonical "production data shape vs new column" gap. Squawk catches DDL anti-patterns; `backup-roundtrip` only proves schema-equivalent restore; `test-migration` only proves idempotent forward-apply. **Data-mutation safety is not gated.** Worth a follow-up phase to add a seeded-data migration test.

---

## 9. Load-Test Gates

### 9.1 P0 — `load-smoke` job is structurally broken (HIGH SEVERITY)

**File:** `.github/workflows/ci.yml` lines 692-797.

YAML parse via `yaml.safe_load` confirms:

```
load-smoke: 1 steps
   - actions/checkout@v5
compose-lint: 12 steps
   - step-security/harden-runner@…
   - actions/checkout@v5
   - pnpm/action-setup@v4
   - actions/setup-node@v5
   - pnpm install --frozen-lockfile
   - Install k6
   - Run mock load smoke (≤ 2 min)         ← BELONGS TO LOAD-SMOKE
   - Capture compose logs on failure
   - actions/upload-artifact@…
   - Tear down
   - Bootstrap fixture .env (env interpolation source)   ← LATE: AFTER load-smoke ran
   - Validate compose config (${{ matrix.cell }})
```

**What's broken:**
1. `load-smoke` declares only one step (`actions/checkout@v5`) — passes immediately as green without ever installing k6, never invoking `make load-smoke`, never asserting `OPENWHISPR_LOADTEST_ALLOW_PAID` is unset. The PR-time cost-discipline gate per memory `feedback_loadtest_cost_discipline` is **not enforced in CI**.
2. The `compose-lint` matrix has inherited all of load-smoke's intended steps. Inside each of 8 matrix cells (default/contract-test/observability/pgbouncer/storage/load-test-mock/load-test-realistic/e2e), CI **installs k6 and runs `make load-smoke`** before then trying to bootstrap `.env` and run `docker compose config`. The Makefile's `make load-smoke` refuses to run without proper preconditions; the matrix cells are likely all failing or producing meaningless output.
3. Step ordering inside compose-lint is also wrong: `make load-smoke` runs **before** `.env` is bootstrapped.

**Root cause:** Missing newline between the single `- uses: actions/checkout@v5` step at line 697 and the `# ─────────` separator-comment block at line 698. YAML's `steps:` block ends because the next non-indented key `compose-lint:` appears at the job-key indent (2 spaces), but every comment line between is parsed as a comment within `steps:`, and the **subsequent** "real" step list at line 751 (`steps:` for `compose-lint`) actually defines compose-lint's steps. The bug: load-smoke's intended body was deleted and replaced with the compose-lint job, but the `load-smoke:` job header at 692-697 was left dangling.

**Effect:**
- The PR-time k6 mock smoke (Phase 44 / Plan 44-01 L3) **does not run**. Cost-discipline gate is decorative.
- `compose-lint` matrix cells do extra work that may pass coincidentally or fail unrelated to compose-config validation.

**This is the highest-impact finding in this audit.**

### 9.2 P1 — `load-test-placeholder` is still a literal echo stub

**File:** `.github/workflows/nightly.yml` lines 65-68.

```
load-test-placeholder:
  runs-on: ubuntu-24.04
  steps:
    - run: echo "k6 load test placeholder - wired in Phase 8 (TEST-LOAD-01)"
```

Phase 8 is referenced as complete by Makefile (`make load-test PROFILE=mock|realistic`) and tools/load-test workspace exists. The placeholder was never replaced with the real nightly load test. **Plateau-mode k6 against mock-litellm is not running nightly** despite memory `feedback_realistic_profile_smoke_and_baseline` and `feedback_loadtest_cost_discipline`. Manual `make load-test` exists but no scheduled CI invocation.

### 9.3 P2 — `OPENWHISPR_LOADTEST_ALLOW_PAID` gate enforcement

- **Makefile `load-smoke` target** (line 452-458): hard-refuses if `OPENWHISPR_LOADTEST_ALLOW_PAID=1`. Correct.
- **`tests/self-tests/load-smoke-cost-discipline.test.ts`**: asserts the Makefile contains the refusal. Runs as part of `harness-self-check` and root `pnpm test` via `tests-self-tests` project entry. Correct.
- **CI invocation**: Per P0-1 above, `make load-smoke` is currently invoked inside `compose-lint` cells, not `load-smoke`. The Makefile's refusal still triggers on any cell that has `OPENWHISPR_LOADTEST_ALLOW_PAID=1` set, but no CI env sets it. So gate is dormant-but-correct; the surrounding plumbing is broken.

---

## 10. Path-Filtered Workflows — Coverage Gaps

The following workflows have `on.pull_request.paths:` filters meaning they **don't run on every PR**:

| Workflow | Filter | Risk |
|---|---|---|
| `web.yml` | `apps/web/**`, `packages/wire-schemas/**`, `apps/api/src/routes/**`, `docker-compose.yml`, `compose/**`, `.github/workflows/web.yml` | A PR that breaks web tests via a shared dependency NOT in this list (e.g. `packages/auth/**` or `packages/observability/**`) **skips web typecheck + vitest + playwright** |
| `conformance-axe.yml` | `tests/conformance/**`, `tests/e2e-cjm/support/**`, `apps/web/src/app/**`, `apps/web/src/components/**`, `docker-compose.yml`, `compose/docker-compose.embedded-litellm.yml`, `compose/**`, this workflow | A PR touching `apps/web/src/lib/**` (utility/data hooks consumed by pages) does NOT trigger axe — accessibility regressions can land |
| `lint-migrations.yml` | `drizzle/**/*.sql`, `tools/lint-migrations.ts`, fixtures, this workflow | Changes to `packages/data/src/migrate.ts` runner do NOT trigger squawk — runner bugs slip |
| `ui-spec.yml` | UI-SPEC docs + linter + routes | narrow, fine |
| `spdx.yml` | `**/*.{ts,tsx,js,jsx,mjs,cjs}` + linter | acceptable |
| `verify-images.yml` | `docker-compose.yml`, `scripts/verify-images.sh`, this workflow | narrow, fine |
| `nightly-realtime-soak.yml` | schedule + tags only | cost-gated, intentional |

**Finding (P1)**: `web.yml` and `conformance-axe.yml` path filters are too narrow — they assume web tests can be skipped when web files aren't touched, but transitively-imported packages (auth, observability, i18n, wire-schemas) can break the web build. Consider either:
1. Adding the dependent packages to the path filter, or
2. Dropping the path filter (run on every PR; web suite is ~5 min and not expensive).

---

## 11. Locker WARN-only Drift (Already-Documented)

CLAUDE.md DISCIPLINE rule 14 documents the LOCKER-04/05/06 WARN→BLOCKING ledger:
- LOCKER-04 flips Phase 41 (47-route bulkfix backlog closes there).
- LOCKER-05 flips Phase 37.
- LOCKER-06 flips Phase 36.a.

**Until those flips land:**
- `ci.yml:lint-english:make lint:lockers` invokes the package.json aggregate which preserves `--warn-only` flags. LOCKER-04/05/06 violations on PR currently print WARN and **do not fail CI**.
- `nightly.yml:lockers-nightly` re-invokes each locker binary directly **without** `--warn-only`. New violations surface as nightly failures but **do not block merge**.

**This is documented degradation, not a bug. INFO-level for this audit.** The risk is forgetting to flip them on the named phases; suggest a tracking issue + reminder on each phase's plan.

---

## 12. Silently-Skipped Tests — Consolidated List

| Skip mechanism | Tests affected | Severity |
|---|---|---|
| **load-smoke job structurally broken** (§9.1) | k6 mock smoke (Phase 44 PR-time gate) | **P0** |
| **load-test-placeholder echo stub** (§9.2) | nightly k6 plateau against mock-litellm | **P1** |
| `lint-tdd` `continue-on-error: true` | TDD violations on PR (advisory only) | **P1** |
| `dep-audit` `\|\| true` swallow | `pnpm audit --prod` non-zero exits | **P1** |
| `E2E=1` not set in root `pnpm test` job | `tests/e2e/*.e2e.test.ts` (only the dedicated `e2e-hermetic` job sets it) | **INFO** (by design) |
| `E2E_CJM=1` not set locally | `tests/e2e-cjm/**` (only `e2e-cjm.yml` workflow runs them in CI) | **INFO** (by design) |
| Real-provider keys absent → `e2e-test` nightly step-gated | `make e2e-test` against Groq+OpenRouter+OpenAI+pyannote | **INFO** (cost-gated) |
| Path filters on `web.yml`, `conformance-axe.yml`, `lint-migrations.yml` | Web/axe/migration tests when filter doesn't match | **P1** |
| Per-workspace stubs (auth-stub, i18n-stub, etc.) inherit 85/80/80/85 NOT 90 | Coverage on stub workspaces | **P1** (mitigated by `coverage-floor` per-file diff job) |
| `tools/test-probe/vitest.config.ts` — no coverage thresholds | `tools/test-probe/src/probe.ts` | **P2** |
| `apps/api/src/index.ts` root-config exclusion | If this is no longer Phase-0 stub, coverage is missed | **P2** (verify status) |
| `packages/i18n/src/index.ts` root-config exclusion | If no longer Phase-0 stub, coverage is missed | **P2** (verify status) |
| Existing-data migration test missing | Production-shape data + new migration combo | **P1** |
| Phase 6 full e2e suite (8 tests) — nightly-only | full Phase 6 invariants on PR (only 3 fastest run) | **INFO** (by design — 45-min budget) |
| Phase 31 LOCKER-04/05/06 — WARN-only on PR | Prod-readiness + secret-shape + shell-credential interpolation violations | **INFO** (documented WARN→BLOCKING ledger) |

---

## 13. Weak / Conditional Gates Summary

| Gate | Weakness | Recommendation |
|---|---|---|
| `lint-tdd` | `continue-on-error: true` | Flip to blocking — schedule a phase to clean the TDD-lint backlog if any exists |
| `dep-audit` (nightly) | exit-code swallowed `\|\| true` | Drop `\|\| true`; Dependabot is parallel safety net but `pnpm audit` should fail loudly |
| `mutation-quick` | No `continue-on-error`, but no required-check confirmation | Verify it's in `scripts/branch-protection.json` required-status-checks |
| `load-smoke` | Structurally broken — 1-step phantom job | **FIX YAML** (§9.1) |
| `load-test-placeholder` | Literal echo | Replace with real nightly invocation of `make load-test PROFILE=mock` |
| Path-filtered workflows | Transitive deps not in filter | Add dep packages or drop filter |
| Root 85/80/80/85 thresholds | Below constitutional 90/90/90/90 | Either raise root to 90/90/90/90 OR document each workspace's per-config 90 override is mandatory (and lint for its presence) |
| Per-package stub workspaces (`auth-stub`, `i18n-stub`, etc.) | Inherit 85/80 from root | Add per-stub `vitest.config.ts` with 90/90 thresholds, mirror inline-project shape |
| `tools/test-probe/vitest.config.ts` | No thresholds | Add 90/90/90/90 |
| Migration safety | Fresh-DB-only | Add seeded-data migration job |

---

## 14. Closure Recommendations (Pre-GitHub-Publish)

**Must-fix before publishing** (P0 + targeted P1):

1. **Fix `ci.yml:load-smoke` YAML structure** — restore the load-smoke job's steps (install k6, install pnpm/node, pnpm install, run `make load-smoke`, log capture, teardown). Move `Bootstrap fixture .env` step in `compose-lint` to BEFORE `Validate compose config`. Verify YAML parse with `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` + assert step counts.
2. **Wire `nightly.yml:load-test-placeholder` to a real run** — at minimum `make load-test PROFILE=mock` with explicit `OPENWHISPR_LOADTEST_ALLOW_PAID` unset assertion.
3. **Flip `lint-tdd` from `continue-on-error: true` to blocking** — if backlog exists, document the deferred cleanup in `.planning/deferred-items.md`; if clean, just flip.
4. **Drop `\|\| true` from `nightly.yml:dep-audit`** — or document explicitly in the workflow comment that it is intentional and Dependabot is the actual gate.

**Should-fix soon** (remaining P1):

5. Audit `scripts/branch-protection.json` against this matrix — confirm `mutation-quick`, `coverage-floor`, `lint-tenant-context`, `lint-rls`, `test-migration`, `contract-test`, `e2e-hermetic`, `e2e-phase6-quick`, `smoke`, `compose-lint`, `compose-lint-resources`, `e2e-cjm`, all six Phase 21 SR-21.* jobs, `security:gitleaks/trivy-fs/codeql/license-scan` are required checks.
6. Widen `web.yml` and `conformance-axe.yml` `paths:` filters to include `packages/auth/**`, `packages/observability/**`, `packages/i18n/**`, `packages/wire-schemas/**` (the transitive dep set) — OR remove filter entirely (suite is short).
7. Add seeded-data migration test to `lint-migrations.yml` or nightly: load fixture data → apply new migration → assert row count + invariants preserved.
8. Add per-workspace 90/90/90/90 to stub-package inline-project entries in root `vitest.config.ts:60-151` (or extract them to real per-package configs).

**Document-don't-fix** (P2 + INFO):

9. Add a `pnpm test:all` script that sets `E2E=1` + `E2E_CJM=1` and runs every workspace, for parity with "what CI eventually runs across all jobs". Even if locally heavy, it's a known one-shot before opening a PR.
10. Append a comment to `tools/test-probe/vitest.config.ts` documenting why it does not set 90/90/90/90 thresholds (or just add them).
11. Add a CI invariant test (under `tests/self-tests/`) that parses every `.github/workflows/*.yml` and asserts each declared job has `len(steps) >= 1` AND no job's step list contains a structurally-orphaned step. This would have caught P0-1.
12. Audit the root-config Phase-0 stub exclusions (`apps/api/src/index.ts`, `packages/i18n/src/index.ts`) — if either is now real production code, remove from exclusion list.

---

## 15. Output Summary

**Counts:**
- Total workflows: 19 in `.github/workflows/`
- Total CI jobs across all workflows: ~50 (not counting matrix expansions)
- P0 findings: **1** (load-smoke YAML structural break — §9.1)
- P1 findings: **8** (lint-tdd advisory, dep-audit swallow, load-test-placeholder echo, path-filter narrowness on web/axe, fresh-DB-only migrations, stub-workspace 85/80 floor, root 85/80 vs constitutional 90/90 — partially mitigated by coverage-floor job, missing seeded-data migration test)
- P2 findings: **4** (test-probe thresholds, root-stub exclusions, apps/web fresh config, mutation-quick branch-protection unverified)
- INFO findings: **5** (E2E gate design, cost-gated real-provider, phase 6 nightly-only, LOCKER WARN ledger, contract-tests no-coverage)

**Bottom-line "false sense of coverage" risks:**
- Highest: load-smoke job appears green every PR because it runs only `actions/checkout` then exits 0. Cost-discipline gate is decorative.
- Second: nightly load-test "placeholder" still active despite Phase 8 closure.
- Third: TDD-lint advisory means TDD compliance is unenforced at CI; relies entirely on review discipline.

**Audit complete. No production code modified; this artifact is the only output.**

_— gsd-code-reviewer, 2026-05-17_
