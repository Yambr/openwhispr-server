---
phase: 13-e2e-cjm-harness-v2-ships-first
verified: 2026-05-14T13:05:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  note: Initial verification (no prior VERIFICATION.md). Two plans (13-01, 13-02) shipped atomically in commits 17c603e + df91de2 with docs in 4eedcf4 + b6e7ad4.
---

# Phase 13: E2E + CJM Harness (v2 — ships first) — Verification Report

**Phase Goal (ROADMAP):** Every subsequent v2 phase writes its tests RED against a Cucumber+Playwright harness that boots the real docker-compose stack — happy-path-only tests (TD-13.a/d) become structurally impossible.

**Verified:** 2026-05-14T13:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + merged PLAN must_haves)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `make e2e-cjm` boots compose, runs Cucumber+Playwright suite against `web.localhost`/`api.localhost`, exits 0 with every happy + negative twin GREEN; same suite runs in GHA on PRs via `E2E_CJM=1` job | ✓ VERIFIED | `Makefile:341-377` defines `e2e-cjm` target with `E2E_CJM=1` gate, `-p e2e-cjm` hermetic project, `--profile default` boot, lint-cjm-doc preflight, `--grep-invert "@expected-red"`. `.github/workflows/e2e-cjm.yml` runs same target with always()-guarded testcontainer prune. Live proof in 13-02-SUMMARY: **10/10 in-phase scenarios GREEN in 24.1s** (@cjm-1.1, 1.2, 1.3, 2.1, 2.2, 3.2, 4.2, 5.2, 8.1, 8.2) |
| 2 | `docs/customer-journeys.md` enumerates ~20 named journeys with `@cjm-N.M` tags; every happy has at least one negative twin; signup→email→verified round-trips through Mailpit HTTP API against real worker | ✓ VERIFIED | `docs/customer-journeys.md` (323 lines): exactly **20 distinct `@cjm-N.M` anchors** across **8 H2 sections** (CJ-1 Signup through CJ-8 Errors). 13 anchors carry `(negative twin)` annotation in their H3 heading. `tests/e2e-cjm/support/mailpit-helper.ts` (166 LOC) implements `/api/v1/messages` polling against the mailpit `127.0.0.1:8025` host-bound port; `auth.steps.ts` exercises the full signup→token→verified flow. Mailpit host-port added in `docker-compose.yml:723-724` |
| 3 | The atomic commit shipping the harness ALSO replaces `apps/worker/src/index.ts:68-134` `noopSender` with a real nodemailer-backed `EmailSender` in new `packages/email/` | ✓ VERIFIED | Single atomic commit `17c603e` contains: new `packages/email/{EmailSender.ts (143 LOC), EmailSender.test.ts (414 LOC), README.md, index.ts, package.json, tsconfig.json, vitest.config.ts}` AND `apps/worker/src/index.ts:35` `import { createEmailSender } from "@openwhispr/email"` + line 74 `realSender = createEmailSender({...})`. `apps/api/src/email.ts` (-105) + `apps/api/src/email.test.ts` (-190) deleted in same commit. `apps/worker/package.json` declares `"@openwhispr/email": "workspace:*"` |
| 4 | testcontainers leaks closed: `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook locally, CI prunes in `always()`; weak-assertion linter blocks `getAllByText(...).length.toBeGreaterThan(0)` family; 7 web auth test sites swept | ✓ VERIFIED | `tools/global-vitest-teardown.ts` (76 LOC) exports `default` + `installSignalHook()`. Wired in `vitest.config.ts:20` `globalTeardown: ["./tools/global-vitest-teardown.ts"]`. `.github/workflows/e2e-cjm.yml:47-55` prunes via `if: always()` filtering `label=org.testcontainers=true`. `tools/lint-weak-assertions.ts` (220 LOC) implemented; `pnpm tsx tools/lint-weak-assertions.ts apps/web` ran clean: **41 file(s) scanned, exit 0**. Test sweep in 17c603e: SignUpForm, NoteDetailClient, NotesListClient, plus AccountClient, SessionsTable, TranscriptionDetail/List, UsageDashboard updated. `docker ps --filter label=org.testcontainers=true` at verification time: **empty (no leaks)** |
| 5 | Readiness probes gate scenario start; per-scenario tenant isolation; retry-on-flake BANNED in CI; verifier reports PASSED with ≥90/90/90/90 coverage on diff | ✓ VERIFIED | `apps/api/src/routes/probes.ts:127-141` returns `{ status: "ok", migrations_completed: boolean }` via `_meta.__drizzle_migrations` SQL probe. `tests/e2e-cjm/support/wait-for-readiness.ts` (212 LOC) polls until `migrations_completed === true`. `tests/e2e-cjm/playwright.config.ts:34` sets `retries: 0`. **Coverage on diff**: packages/email 100/100/100/100 (24 tests pass); tools/lint-weak-assertions.ts + tools/lint-cjm-doc.ts 99.47/93.33/100/100 (54 tests pass); tools/global-vitest-teardown.ts 100/100/100/100; apps/api/src/routes/probes.ts 100/100/100/100 (21 tests pass) — all axes ≥ 90% |
| 6 | `GET /api/health` returns `{ status: "ok", migrations_completed: true }` after migrate completes | ✓ VERIFIED | Implemented in `apps/api/src/routes/probes.ts:127-141`. Schema mirrored in `packages/contract-tests/schemas/health.ts`. Tests in `apps/api/src/routes/probes.test.ts` (21 passing, 100% coverage) |
| 7 | In production (`NODE_ENV=production`) with `SMTP_HOST` unset, `createEmailSender` throws at module init (no silent dev-fallback) | ✓ VERIFIED | `packages/email/src/EmailSender.ts:69-83`: `if (!host) { if (env.NODE_ENV === "production") throw new Error("SMTP_HOST is required in production (event:email.smtp_required_in_production)") }`. Test `EmailSender.test.ts` covers this branch (414 LOC, 24 tests, 100% branch coverage) |
| 8 | Every `.feature` file ships at least one happy AND one negative twin (no happy-path-only features) | ✓ VERIFIED | 8 `.feature` files in `tests/e2e-cjm/features/`. All 20 `@cjm-N.M` anchors mapped 1:1 from doc to features. `tools/lint-cjm-doc.ts --features` passed (`exit 0`, "20 anchors") confirming machine-checkable cross-reference. signup-verify, signin, password-reset, transcribe, admin-onboarding, locale-switch, oidc-providers, error-paths all carry happy+twin |
| 9 | `tools/lint-cjm-doc.ts` exits non-zero if any `.feature` Scenario tag lacks a matching docs/customer-journeys.md `@cjm-N.M` anchor | ✓ VERIFIED | `tools/lint-cjm-doc.ts` (346 LOC, two-mode: doc-validate + `--features` cross-check). Run at verification: `pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red` → `exit 0`. Wired in `Makefile:351` as preflight before bddgen; `.github/workflows/e2e-cjm.yml` runs `make e2e-cjm` which runs the lint |
| 10 | Downstream-phase scenarios land tagged `@expected-red @after-phase-N` and are filtered by `--grep-invert "@expected-red"` in CI | ✓ VERIFIED | `Makefile:e2e-cjm` target runs playwright with `--grep-invert "@expected-red"`. Inventory: **7 scenarios `@after-phase-12`** + **3 scenarios `@after-phase-15`** = 10 `@expected-red` scenarios across 5 deferred product gaps (matches deferred-items.md). 13-02-SUMMARY records `pnpm exec playwright test ... --grep "@expected-red"` → "10 failed (as expected) — the RED guard works" |
| 11 | GHA job `e2e-cjm` boots its own compose stack (independent of `e2e-hermetic`) and prunes testcontainers in `always()` | ✓ VERIFIED | `.github/workflows/e2e-cjm.yml` (62 LOC) — separate workflow file from `e2e-hermetic.yml`; calls `make e2e-cjm`; step at line 47 `if: always()` runs `docker ps --filter label=org.testcontainers=true` then prunes; canary fails if leaks remain |
| 12 | `make e2e-cjm` GREEN-includes 13-01's @cjm-1.1 + @cjm-1.2 AND every new in-phase scenario for Phase 13 | ✓ VERIFIED | 13-02-SUMMARY records authoritative live proof: 10 passed, 24.1s wall clock, against fresh DB + mailpit. Verifier did not re-run e2e per orchestrator instruction (trust recorded green) but cross-validated the harness gates: lint-cjm-doc green, lint-weak-assertions green, all artifacts present, docker-ps clean |
| 13 | Atomic commit constraint (D-04): exactly ONE feat commit per plan covering all integration deltas | ✓ VERIFIED | `git log -- packages/email tools/lint-weak-assertions.ts tools/global-vitest-teardown.ts tests/e2e-cjm apps/api/src/routes/probes.ts apps/worker/src/index.ts` shows `17c603e feat(13-01)` containing 58 files / +4304 / -539 as one feat commit; `df91de2 feat(13-02)` containing 23 files / +2408 / -1 as one feat commit. Docs commits `4eedcf4` + `b6e7ad4` are separate doc-only commits (allowed) |

**Score:** 13/13 truths verified

### Deferred Items (not gaps — explicitly addressed in later phases)

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | `@cjm-1.4` Locale-scoped signup error copy + `@cjm-6.2` `/api/locale` routing | Phase 15 (locale plane) | feature files tagged `@expected-red @after-phase-15`; 13-02-SUMMARY notes "GREEN the day Phase 15 wires Better Auth error renderer through the i18n plugin" |
| 2 | `@cjm-1.5` Zero-providers gating + `@cjm-7.1`/`@cjm-7.2` OidcButtons defaults | Phase 12 (auth UI finish) | tagged `@expected-red @after-phase-12` |
| 3 | `@cjm-3.1` forget-password no-mail-leak + `@cjm-5.1`/`@cjm-5.3` Admin onboarding wizard | Phase 12 | tagged `@expected-red @after-phase-12` |
| 4 | `@cjm-4.1` transcribe round-trip live | Phase 12 | tagged `@expected-red @after-phase-12` |
| 5 | `@cjm-8.x` SSRF/error envelopes (subset) | Phase 15 | tagged `@expected-red @after-phase-15` |

Total deferred: 10 RED scenarios across 5 product gaps. All carry explicit `@after-phase-N` tags, filtered by Makefile `--grep-invert "@expected-red"`, and recorded under `.planning/deferred-items.md`.

### Required Artifacts

| Artifact | Status | LOC | Details |
|---|---|---|---|
| `packages/email/src/EmailSender.ts` | ✓ VERIFIED | 143 | Exports `createEmailSender`, `EmailSender`, `SendArgs`, `SendResult`, `Logger`. Prod loud-fail at L79-83 |
| `packages/email/src/EmailSender.test.ts` | ✓ VERIFIED | 414 | 24 tests pass, 100% coverage, includes prod loud-fail branch + dev fallback + SMTP_SECURE override |
| `tools/lint-weak-assertions.ts` | ✓ VERIFIED | 220 | tsx-script, exit-code contract; ran clean against apps/web (41 files scanned, exit 0) |
| `tools/lint-cjm-doc.ts` | ✓ VERIFIED | 346 | Two-mode (doc + --features); ran clean (exit 0, 20 anchors) |
| `tools/global-vitest-teardown.ts` | ✓ VERIFIED | 76 | Exports `default` + `installSignalHook()`; wired in `vitest.config.ts:20` |
| `tests/e2e-cjm/support/compose-harness.ts` | ✓ VERIFIED | 261 | `bootStack()`, `tearStack()`, `waitForReadiness()`; spawns `docker compose --profile default` (Makefile line 361) |
| `tests/e2e-cjm/support/mailpit-helper.ts` | ✓ VERIFIED | 166 | `/api/v1/messages` HTTP polling against mailpit:8025 |
| `tests/e2e-cjm/support/wait-for-readiness.ts` | ✓ VERIFIED | 212 | Polls `/api/health` until `migrations_completed === true` |
| `tests/e2e-cjm/support/world.ts` | ✓ VERIFIED | 107 | Per-scenario isolation primitives |
| `tests/e2e-cjm/support/fixtures.ts` | ✓ VERIFIED | 130 | 13-02 fixture harness (incl. `silent.wav`) |
| `tests/e2e-cjm/playwright.config.ts` | ✓ VERIFIED | 56 | Inlines `defineBddConfig({...})` (playwright-bdd 8.x API does NOT use standalone `bddgen.config.ts` — see L4-7 inline rationale). **Deviation from PLAN file roster — architecturally correct per upstream API** |
| `tests/e2e-cjm/features/*.feature` (8 files) | ✓ VERIFIED | — | signup-verify, signin, password-reset, transcribe, admin-onboarding, locale-switch, oidc-providers, error-paths |
| `tests/e2e-cjm/steps/*.steps.ts` (9 files) | ✓ VERIFIED | — | auth, signin, password-reset, transcribe, admin, locale, oidc, error-paths, signup-extras |
| `docs/customer-journeys.md` | ✓ VERIFIED | 323 | 20 @cjm-N.M anchors, 8 H2 sections |
| `apps/api/src/routes/probes.ts` | ✓ VERIFIED | 146 | **Renamed from plan-spec `routes/health.ts` — same `/api/health` endpoint, broader probe surface (renames as RECON outcome)**. Tests passing 21/21, 100% coverage |
| `Makefile` `e2e-cjm` target | ✓ VERIFIED | — | L341-377, E2E_CJM=1 gate, hermetic `-p e2e-cjm` project, lint preflight, `--grep-invert "@expected-red"` |
| `.github/workflows/e2e-cjm.yml` | ✓ VERIFIED | 62 | Separate from e2e-hermetic; always()-prune of `label=org.testcontainers=true` |
| `docker-compose.yml` mailpit host port | ✓ VERIFIED | — | L723-724 binds `127.0.0.1:8025:8025` so e2e-cjm harness polls mailpit HTTP API outside the bridge network |

**Two PLAN-roster paths deviated** (`tests/e2e-cjm/bddgen.config.ts` and `apps/api/src/routes/health.ts`). Both are documented in-source: `bddgen.config.ts` is inlined as `defineBddConfig({...})` in `playwright.config.ts:32` per the upstream playwright-bdd 8.x API contract (their CLI does NOT load a standalone bddgen file); `health.ts` was merged into `probes.ts` as part of the broader probe surface. Both deviations are architecturally equivalent — the same wiring, the same endpoints, the same exports — and the artifact-roster mismatch is purely path-naming. No verifier override needed because all observable behaviors and key links are present.

### Key Link Verification

| From | To | Status | Evidence |
|---|---|---|---|
| `apps/worker/src/index.ts` | `@openwhispr/email` | ✓ WIRED | L35 import + L74 instantiation grep confirmed |
| `tests/e2e-cjm/support/compose-harness.ts` | `docker compose --profile default up -d` | ✓ WIRED | Harness spawns; Makefile e2e-cjm target uses `-p e2e-cjm --profile default` |
| `apps/api/src/routes/probes.ts` | `_meta.__drizzle_migrations` | ✓ WIRED | `checkMigrationsCompleted()` SQL probe → `migrations_completed` field on `/api/health` |
| `vitest.config.ts` (root) | `tools/global-vitest-teardown.ts` | ✓ WIRED | `globalTeardown: ["./tools/global-vitest-teardown.ts"]` at L20 |
| `.github/workflows/e2e-cjm.yml` | `docker container prune` | ✓ WIRED | L47 `if: always()` + label filter |
| `tools/lint-cjm-doc.ts` | `docs/customer-journeys.md` | ✓ WIRED | Markdown parse + anchor extraction; live exit 0 |
| `tools/lint-cjm-doc.ts --features` | `tests/e2e-cjm/features/**/*.feature` | ✓ WIRED | Cross-check passed (20 anchors) |
| `.github/workflows/e2e-cjm.yml` | `tools/lint-cjm-doc.ts` | ✓ WIRED | Make target preflight `Makefile:351` runs before bddgen |
| `tests/e2e-cjm/features/admin-onboarding.feature` | `@expected-red @after-phase-12` | ✓ WIRED | 7 such scenarios across 4 features |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Weak-assertion linter green on apps/web | `pnpm tsx tools/lint-weak-assertions.ts apps/web` | `41 file(s) scanned ... exit=0` | ✓ PASS |
| CJM doc lint green (doc + features cross-check) | `pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red` | `CJM lint passed: docs/customer-journeys.md (20 anchors), exit=0` | ✓ PASS |
| No testcontainer leak at verification time | `docker ps --filter label=org.testcontainers=true --format '{{.Names}}'` | empty | ✓ PASS |
| packages/email vitest suite green | `pnpm vitest run --coverage` in `packages/email` | 24 tests pass, 100% coverage | ✓ PASS |
| Phase 13 tools coverage on diff | `pnpm vitest run --coverage --coverage.include='tools/lint-{cjm-doc,weak-assertions}.ts'` | 99.47/93.33/100/100, 54 tests pass | ✓ PASS |
| apps/api probes.ts coverage on diff | `pnpm vitest run --coverage --coverage.include='src/routes/probes.ts'` in apps/api | 100/100/100/100, 21 tests pass | ✓ PASS |
| global-vitest-teardown coverage on diff | `pnpm vitest run --coverage --coverage.include='tools/global-vitest-teardown.ts'` | 100/100/100/100 | ✓ PASS |
| E2E harness run | (NOT re-executed — trust recorded 13-02-SUMMARY live proof) | Recorded: **10 passed, 24.1s, fresh DB + mailpit**; @expected-red scenarios fail-as-expected (RED guard) | ✓ PASS (per orchestrator instruction) |

### Requirements Coverage (E2E-01 … E2E-12)

All twelve requirements declared in 13-01 + 13-02 frontmatter map to verified artifacts:

| Req | Plan | Status | Evidence |
|---|---|---|---|
| E2E-01 | 13-01 | ✓ SATISFIED | `tests/e2e-cjm/` harness + Makefile + GHA workflow |
| E2E-02 | 13-02 | ✓ SATISFIED | docs/customer-journeys.md (20 anchors, 8 sections) |
| E2E-03 | 13-01 | ✓ SATISFIED | signup-verify.feature: @cjm-1.1 happy + 1.2/1.3/1.4/1.5 twins (4 negatives, last two `@expected-red`-deferred) |
| E2E-04 | 13-01 | ✓ SATISFIED | mailpit-helper.ts polls /api/v1/messages; auth.steps.ts round-trips signup→token→verified |
| E2E-05 | 13-02 | ✓ SATISFIED | signin.feature @cjm-2.* incl. 403-unverified twin (@cjm-2.2) |
| E2E-06 | 13-02 | ✓ SATISFIED | transcribe.feature @cjm-4.* + silent.wav fixture |
| E2E-07 | 13-02 | ✓ SATISFIED | admin-onboarding.feature @cjm-5.* (1 GREEN + 2 `@expected-red @after-phase-12`) |
| E2E-08 | 13-02 | ✓ SATISFIED | locale-switch.feature @cjm-6.* (1 GREEN + 1 `@expected-red @after-phase-15`) |
| E2E-09 | 13-01 | ✓ SATISFIED | packages/email + worker `realSender` wired |
| E2E-10 | 13-01 | ✓ SATISFIED | global-vitest-teardown.ts + always()-prune; verified clean docker ps |
| E2E-11 | 13-01 | ✓ SATISFIED | lint-weak-assertions.ts + 7-site sweep + tests green |
| E2E-12 | 13-01 | ✓ SATISFIED | wait-for-readiness.ts gates scenarios on `migrations_completed: true`; `retries: 0` in playwright.config |

No orphaned requirements found in REQUIREMENTS.md for Phase 13.

### Anti-Patterns Found

None blocking. Notes:

- 13-02-SUMMARY documents `@cjm-1.2 mail-count check` as a known flake **against a stateful existing stack only**; disappears under the Makefile `-p e2e-cjm` fresh-compose path. This is explicitly documented (not hidden) and the production CI path is the fresh path. **Info only — not a blocker.**
- No `TBD`/`FIXME`/`XXX` markers introduced in Phase 13 diff (`git show 17c603e df91de2` audited for new instances; none added without referenced follow-up).
- Coverage tooling note: the root `vitest.config.ts` thresholds are configured against the whole monorepo aggregate. Per-package + per-file `--coverage.include` runs show all Phase 13 new/modified surfaces ≥ 93% on every axis (most at 100%).

### Human Verification Required

None — the goal is achieved with machine-verifiable artifacts and live-proof run already executed by the executor.

### Gaps Summary

No gaps. Phase 13 ships exactly the harness the ROADMAP success criteria demand:

1. The Cucumber+Playwright stack at `tests/e2e-cjm/` boots the real docker-compose project, polls `/api/health` until `migrations_completed: true`, and executes 10 GREEN in-phase scenarios in 24.1s (recorded live proof in 13-02-SUMMARY).
2. The `docs/customer-journeys.md` enumerates 20 anchored journeys across 8 H2 sections with 13 explicit negative-twin annotations; `tools/lint-cjm-doc.ts` mechanizes the happy-twin invariant and the doc↔feature cross-reference.
3. The atomic commit `17c603e` simultaneously closes the worker `noopSender` debt by extracting `packages/email/` and wiring `createEmailSender` (with prod loud-fail) into `apps/worker/src/index.ts:35,74`.
4. Testcontainer-leak closure (`tools/global-vitest-teardown.ts` + GHA always()-prune) is verifiable: zero containers at verification time.
5. Weak-assertion ban shipped as `tools/lint-weak-assertions.ts` and swept across all 7 web auth test sites — `exit 0` on apps/web.
6. Diff-coverage axes all clear the 90/90/90/90 floor on Phase 13 new/modified code.

Two artifact-path deviations (`bddgen.config.ts` → inlined `defineBddConfig`; `health.ts` → merged into `probes.ts`) are architecturally correct and documented inline; no override required because all behaviors and links are preserved.

Phase 13 successfully unblocks Phases 12, 14, 15, 16, 17 to write RED Gherkin scenarios against this harness. The `@expected-red @after-phase-N` deferral mechanism is wired, lint-enforced, and CI-filtered.

---

_Verified: 2026-05-14T13:05:00Z_
_Verifier: Claude (gsd-verifier, goal-backward)_
