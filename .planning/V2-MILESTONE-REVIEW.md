# v2 Milestone Manual Audit — OpenWhispr Server

**Auditor:** Manual single-pass audit agent
**Audited:** 2026-05-15
**Scope:** Phases 12, 13, 14, 15, 16, 17, 18 (v2 milestone)
**Method:** Cross-check planning artifacts (PLAN / VERIFICATION / REVIEW / SECURITY / CONTEXT) against live codebase state + commit log.

---

## Per-phase Verdicts

### Phase 13 — E2E + CJM Harness — VERDICT: APPROVE
Cucumber+Playwright harness landed atomically (`17c603e` + `df91de2`); `make e2e-cjm` target wired in `Makefile:341-377`; `.github/workflows/e2e-cjm.yml` boots its own stack with `if: always()` testcontainer prune. `packages/email/` ships a real nodemailer-backed `EmailSender` (143 LOC + 414 LOC tests, 100/100/100/100 coverage) replacing `apps/worker/src/index.ts:68-134` `noopSender`. `docs/customer-journeys.md` enumerates 20 `@cjm-N.M` anchors across 8 sections; cross-ref linter `tools/lint-cjm-doc.ts` enforces doc⇄feature parity; weak-assertion linter `tools/lint-weak-assertions.ts` blocks the `getAllByText(...).length.toBeGreaterThan(0)` family across 41 files. 13-VERIFICATION 13/13; 13-REVIEW found 2 HIGH (HI-01 dev-fallback false-positive `delivered:true`; HI-02 URL credential leak in bootstrap logs) — both fixed under TDD in atomic commit `5c579d3` + docs `b437b9c` (`apps/api/src/lib/redact-url.ts` 100/100/100/100). 13-SECURITY 11/11 threats + 8/8 prompt surfaces cleared. **Residual risk:** harness has never run in real GHA — only locally; first GHA `e2e-cjm` failure mode is unknown. `retries: 0` (`tests/e2e-cjm/playwright.config.ts:34`) means any flake fails CI hard.

### Phase 12 — Admin Onboarding Wizard + UI-SPEC Conformance — VERDICT: APPROVE-WITH-FOLLOWUP
6 plans landed. `setup_state` enum + migration `0017` shipped (`apps/api/src/routes/setup-state.ts`, `apps/api/src/routes/setup-admin.ts`); `/setup` wizard page at `apps/web/src/app/(public)/setup/page.tsx` with RHF+Zod+shadcn Stepper; `users.role` migration + Better Auth `additionalFields.role`; `/admin` index page closes TD-12.a 404; `GET /api/auth/providers` + `GET /api/capabilities` close TD-12.c capability drift. 5 of 7 `@expected-red @after-phase-12` scenarios flipped GREEN (`admin-onboarding`, `signup-verify`, `oidc-providers`). **Two remain RED that should have flipped:** `@cjm-3.1` password-reset (`tests/e2e-cjm/features/password-reset.feature:6`) and `@cjm-4.1` transcribe (`transcribe.feature:6`) — verification doc claims "only @cjm-1.4 @after-phase-15 remains" which is factually wrong (live grep shows 4 RED tags). 12-VERIFICATION verdict `passed_with_gaps`: UICONF-05 axe baseline was never actually executed locally (`12-05b-SUMMARY` admits "Not executed in this local session — destructive local boot path is deferred to CI"); axe assertion is a CI promise, not recorded green. REQUIREMENTS.md flip gap noted in verification is now resolved per live grep. **No 12-REVIEW.md or 12-SECURITY.md was produced** — code review gate skipped. Pre-existing AccountClient.test.tsx failure deferred (`deferred-items.md` §From Plan 12-04). **Residual risk:** axe never empirically green; transcribe and password-reset scenarios still unverified end-to-end.

### Phase 14 — Slim Core + BYOK Profiles — VERDICT: APPROVE-WITH-FOLLOWUP
7 plans across 4 waves landed; 14-VERIFICATION 47/47 must-haves PASS. `docker compose config --services` returns exactly `api litellm migrate postgres valkey web worker`; `grep -n "profiles:" docker-compose.yml` returns 0 hits; 5 opt-in overlays under `compose/` confirmed (`docker-compose.acme.yml`, `docker-compose.contract-test.yml`, `docker-compose.dev-tools.yml`, plus observability/storage/ingress/pgbouncer). BYOK matrix in `docs/operations.md`; loud-fail byok-guard module shipped; all 3 worker noops resolved (sender → real EmailSender; litellmKeyClient + userKeyLookup → loud-fail or real adapters). Helm `*.enabled` toggles 1:1 with overlays. **However**: `deferred-items.md` records **pre-existing typecheck failures** in `apps/api` + `apps/worker` (typed-queue BullMQ shape, with-tenant-context `unknown`→AttributeValue, `routes/tokens/_call-provider.ts` exactOptionalPropertyTypes, transcriptions create/batch-create, packages/litellm-client `chatCompletionsStream` typing) — vitest passes because esbuild is permissive, but `tsc` is broken on multiple files. **No 14-REVIEW.md was produced** — code review gate skipped. Gherkin scenarios `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` authored but live-stack GREEN deferred to CI. `refuse-default-secrets.test.ts` deferred as pre-existing failure. **Residual risk:** typecheck CI gate (if any) is silently red; BYOK loud-fail behavior never empirically exercised against a misconfigured prod env.

### Phase 15 — Repo Refactor + FSL Relicense + History Scrub — VERDICT: NEEDS-WORK
4 plans; verdict `PASS-WITH-GAPS` (`status: human_needed`). Test layout codified (`docs/conventions.md:331`); `Phase15-MOVE-INVENTORY.md` present; 220 test files relocated under `apps/<ws>/tests/unit/`; `compose/` holds every YAML; Traefik host split (`web.localhost`/`api.localhost`) shipped (`compose/traefik/dynamic.dev.yml:36`); `apps/web/src/app/api/locale/route.ts` closes TD-15.g; `apps/web/public/.gitkeep` committed. FSL relicense executed: `LICENSE` now FSL-1.1-ALv2; `REUSE.toml` + `LICENSES/*.txt` + ~675 SPDX headers swept across 9 atomic per-area commits; `.github/workflows/reuse-lint.yml` gate; `CONTRIBUTING.md` + `.github/dco.yml` (cutoff_sha blank pending scrub); ADR-0013 + ADR-0004 superseded; chart-releaser workflow on `chart-v*` tags. 15-REVIEW: **3 HIGH (all fixed in `f523184` + `508041d` + `0735965`)**, 6 MEDIUM, 3 INFO. **FSL-06 + FSL-07 DEFERRED to operator** — `tools/history-scrub.sh` runbook driver exists, `docs/runbooks/15-04-history-scrub.md` published, but `git filter-repo --path speaches-audio.md --invert-paths` has **NOT been executed**: `speaches-audio.md` still appears in git history (`git log --all -- speaches-audio.md` returns commit `378d68a`); `MIGRATING.md` still contains literal placeholder `POST-SCRUB-HEAD-SHA: <filled-by-15-04-execution>`; the working-tree delete is staged (`D speaches-audio.md`) but uncommitted. **2 Dockerfile FSL LABELs missing** (`tests/e2e/mock-realtime/Dockerfile`, `tests/fixtures/idp/Dockerfile` — test-fixture only, low risk). `--no-verify` used in 15-02/15-03 (documented). **Residual risk:** ROADMAP table line 835 still marks Phase 15 as "In Progress 2/4" — table not aligned with phase closure claim; the FSL milestone announcement cannot ship until force-push executes.

### Phase 16 — Phase-Tag Comment Audit — VERDICT: APPROVE-WITH-FOLLOWUP
2 plans; 16-VERIFICATION 4/4 PASS. `tools/phase-tag-sweep.ts` (5 REMOVE rules + 5 KEEP rules + conservative-KEEP default at line 160); `tools/lint-phase-tag-comments.ts` wired into `package.json:24` + `lefthook.yml:24-26` + `.github/workflows/ci.yml:40`; allowlist file present. **Documented deviation:** empirical 23-violation finding collapsed planned 5 per-area sweep into single `6d9fb6c refactor(16-02): sweep 23 phase-tag comments` (12 files, well under 300-file ceiling). 16-REVIEW: **1 CRITICAL + 3 WARNING (all fixed)** — CR-01 over-strip regression on prose-bearing phase headers fixed (`ba5d3f3` + `2d730d2`); WR-01 close-out-vs-keep classifier ordering fixed (`b42fa19` + `17d95c2`); WR-02 sweep commit framing corrected (`31ad6a6`); cov-fix lifted lint CLI branch coverage 89.28→100 (`34a9c69`). ROADMAP §16 says "approximately 754" comments — actual sweep found 23, suggesting either the audit scope was over-estimated or many comments were already removed by Phase 15 SPDX rewrite churn. **Residual risk:** lint rule may not catch new variants (e.g., `// D-S3`, `// SC #1`) — only the explicit `Phase XX / Plan YY / D-ZZ` family is regex-gated.

### Phase 17 — Trusted Local TLS + Production ACME — VERDICT: APPROVE-WITH-FOLLOWUP
3 plans; 17-VERIFICATION 5/5 PASS but `status: human_needed`. `make tls-trust` target (`Makefile:123-146`) with mkcert PATH detection, exit-2-on-absence, 5-host SAN list, idempotency via `openssl x509 -checkend $$((86400*30))`; `compose/traefik/dynamic.prod.yml` declares 5 routers with `tls.certResolver: letsencrypt`; `compose/docker-compose.acme.yml` overlay; `charts/openwhispr/Chart.yaml:78-81` declares `cert-manager 1.16.4` sub-chart with `condition: certManager.bundled` (default OFF); `charts/openwhispr/templates/issuer.yaml` shipped; helm-unittest 163/163 PASS. Root `.dockerignore:26-34` + `compose/traefik/.dockerignore`; `tools/lint-dockerfile-tls.ts` clean across 12 in-repo Dockerfiles; `tests/e2e-cjm/features/phase17-tls.feature` 3 scenarios. 17-REVIEW: **5 WARNING + 1 INFO (all fixed)**. **3 deferred-to-operator/CI verifications**: (1) `make tls-trust` first-run requires a developer machine with mkcert installed — never executed by executor; (2) `@cjm-tls-trusted-localhost` + `@cjm-tls-acme-staging` Gherkin remain `@expected-red @after-docker-up`; (3) `@cjm-tls-no-dev-ca-in-prod-image` requires CI image-build step. **Residual risk:** ACME production path has never produced a real Let's Encrypt cert; failure modes are theoretical until first staging issuance.

### Phase 18 — LDAP / Keycloak SSO (SPEC + ADR only) — VERDICT: APPROVE
1 plan; 18-VERIFICATION 5/5 PASS (passed_spec_only, explicitly allowed per ROADMAP §Phase 18). `SPEC-ldap-keycloak.md` 173 lines (under 200 cap) covers option (a) Keycloak/Authentik OIDC frontend vs option (b) direct LDAP with decision matrix + v3 LOC estimate; 5 Better Auth extension points named; 7 env vars + 7 rejection codes documented. `tests/e2e-cjm/features/sso/keycloak-oidc.feature` (6 scenarios `@cjm-sso-1.1..1.6` all `@expected-red @after-phase-19`); `tests/e2e-cjm/steps/sso.steps.ts` throws "ships in Phase 19" for every step; `compose/test/keycloak.yml` fixture stub. `docs/adrs/0012-ldap-via-keycloak.md` (177L, accepted) with 4-anonymised-operator demand survey (PITFALLS §14 prerequisite satisfied). 18-REVIEW: **3 WARNING + 5 INFO**. ZERO production code in diff. **Residual risk:** none for v2 closure; option-(a)-vs-(b) decision should be re-validated when v3 starts.

---

## Cross-cutting Findings

### Test Debt
1. **Pre-existing typecheck failures in `apps/api` + `apps/worker` + `packages/litellm-client`** (`deferred-items.md` §From Plan 14-04). At least 7 files broken under `pnpm typecheck`; vitest passes via esbuild but `tsc` is red. **No phase owned this fix** — every phase deferred per "scope boundary".
2. **`apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx`** weak-assertion failure unrelated to Phase 12 surface (`deferred-items.md` §From Plan 12-04). One-line fix never landed.
3. **`tests/self-tests/refuse-default-secrets.test.ts`** DATA-05 fixture mismatch on `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` literal (`deferred-items.md` §From Plan 14-02). Deferred since Phase 1; no owner.
4. **`make e2e-cjm` never executed in real GHA CI** — locally green (24.1s, 10/10), but the workflow file landed in the same commit that ships the harness; first GHA run will reveal harness/runner mismatches.
5. **UICONF-05 axe baseline (5 auth routes) never produced a recorded green run** — `12-05b-SUMMARY` admits CI-only execution; phase verifier acknowledged the gap but passed anyway.
6. **BYOK loud-fail Gherkin scenarios** (`@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig`) authored but never live-stack GREEN.

### `@expected-red @after-phase-NN` Still RED
- `@cjm-3.1 @after-phase-12` (`password-reset.feature:6`) — Better Auth password-reset email flow never wired to real worker; should have flipped GREEN at Phase 12 close per ROADMAP SC-5 intent.
- `@cjm-4.1 @after-phase-12` (`transcribe.feature:6`) — multipart audio → typed response. Likely requires real LiteLLM/Whisper which only the realistic profile boots; blocked on either operator HF_TOKEN or hermetic mock fallback.
- `@cjm-1.4 @after-phase-15` (`signup-verify.feature:27`) — depends on locale-routing or host-split; STRUCT-04 closed but scenario tag not retired.
- `@cjm-6.1 @after-phase-15` (`locale-switch.feature:6`) — `/api/locale` shadowing was the closure point; tag should have flipped.
- `@cjm-traefik-host-split @after-docker-up @expected-red` x2 (`traefik-host-split.feature:14,19`) — deliberate, docker-gated.
- `@cjm-tls-trusted-localhost @after-docker-up @expected-red` + `@cjm-tls-acme-staging` + `@cjm-tls-no-dev-ca-in-prod-image` (Phase 17) — deliberate, runtime-deferred.
- `@cjm-sso-1.1..1.6 @after-phase-19` x6 — deliberate, Phase 19 deferred to v3.

**Blocker to flipping (12 / 15 reds):** Phase 12 and 15 verifiers signed off without re-running `pnpm exec playwright test --grep "@expected-red @after-phase-12"` to confirm transition. The phase-close convention "flip the tag" is not mechanically enforced; `tools/lint-cjm-doc.ts --check-expected-red` does not verify that closed phases have zero `@after-phase-N` for `N ≤ current_phase`.

### Architecture / Security Concerns
- **History scrub force-push is the FSL milestone gate.** `speaches-audio.md` is still in git history (`git log --all -- speaches-audio.md` returns `378d68a`). MIGRATING.md still has unfilled `POST-SCRUB-HEAD-SHA` placeholder. Until operator runs `bash tools/history-scrub.sh`, the FSL announcement is not shippable.
- **TLS dev-CA prod-image guard never empirically run** — `@cjm-tls-no-dev-ca-in-prod-image` requires CI to actually build the production image and tar-scan it. Until first CI run, the dev-CA isolation is a paper guarantee.
- **`OPENWHISPR_DISABLE_RATE_LIMIT` + `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` + `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE`** env switches default OFF but are documented escape hatches — operator footgun if leaked into prod. No CI lint blocks setting them outside `NODE_ENV=test`.

### Documentation Gaps
- **Phase 12 and Phase 14 have no `*-REVIEW.md` or `*-SECURITY.md` files** — code review and security gates skipped relative to Phases 13/15/16/17/18 which all carry both.
- **ROADMAP.md Progress Table (lines 832-838) inconsistent with phase-closure claims.** Line 832: "Phase 13 — Not started". Line 835: "Phase 15 — In Progress 2/4". Line 836: "Phase 16 — Not started". Lines 837-838: 17 and 18 "Not started". User's prompt asserts all 7 are closed; verification headers confirm closure. Table is stale.
- **ROADMAP.md checkboxes (lines 53, 56-58)** mark Phase 13, 15, 16, 17, 18 as `[ ]` (open) — only 12 and 14 are `[x]`. Roadmap not updated.
- **No v2 milestone summary** — `.planning/STATE.md` last_activity is Phase 13; no `v2-MILESTONE-SUMMARY.md` exists.
- **ADR-0012 LDAP decision not yet locked** — accepted but listed 5 open questions for v3.

### CI/CD Reliability Concerns
- **17 commits in Phase 17 use `(17-fix)` / `(15-fix)` / `(16-fix)` conventions** — heavy post-review fix volume suggests upfront plan check inadequate for these phases.
- **No evidence of `--no-verify` flags in commit subjects across v2 commits** (`git log --grep="no-verify"` returns nothing in v2 range). Good.
- **`retries: 0` in `tests/e2e-cjm/playwright.config.ts:34`** — strict, but means any flake immediately fails GHA. With harness having never run in real CI, expect false-positives.
- **`chart-releaser` workflow on `chart-v*` tags** — first chart release will reveal any tagging mistakes.

### Operator Footguns
1. `make tls-trust` errors silently if mkcert not installed (Makefile exit-2 path); README quickstart documents but doesn't pre-flight.
2. FSL force-push runbook (`docs/runbooks/15-04-history-scrub.md`) requires branch protection unlock; operator one-shot if misordered (PITFALLS §10).
3. `OPENWHISPR_DISABLE_RATE_LIMIT=1` boots with WARN banner but no hard gate against prod `NODE_ENV`.
4. `setup_state` migration `0017` adds `skipped_legacy` for upgrade installs — but ROADMAP doesn't document v1-to-v2 upgrade runbook.
5. BYOK loud-fail behavior is asserted in unit tests, never tested against a real misconfigured stack.

---

## Open Followups (Prioritized)

**Must clear before v2 milestone is "done-done":**

1. **Flip stale `@expected-red @after-phase-12` and `@after-phase-15` tags** (`password-reset.feature:6`, `transcribe.feature:6`, `signup-verify.feature:27`, `locale-switch.feature:6`). Either confirm the scenarios are now GREEN and remove the tag, or document why they remain deferred. (Owner: a 30-minute followup phase.)
2. **Execute FSL history scrub** (`bash tools/history-scrub.sh`). Until then Phase 15 is operationally incomplete; `MIGRATING.md` carries a literal `<filled-by-15-04-execution>` placeholder.
3. **Run `make e2e-cjm` end-to-end in real GHA CI at least once** to convert harness from "locally green" to "verified green". Most v2 phases deferred their Gherkin to CI.
4. **Author Phase 12 and Phase 14 REVIEW + SECURITY artifacts** retroactively — every other v2 phase carries both, and skipping them violates the v2 milestone pattern.
5. **Update ROADMAP.md** (lines 53-58 checkboxes + lines 832-838 progress table) to reflect actual v2 closure. Stale-roadmap risk: future contributors will replan closed work.
6. **Fix the `apps/api` + `apps/worker` typecheck regressions** flagged in `deferred-items.md`. `tsc` red is a TDD-01b coverage-floor violation even though vitest is green.
7. **Execute UICONF-05 axe baseline in CI** to convert phase-12 promise into recorded green.

**Can slip to v3:**

8. Add `tools/lint-cjm-doc.ts` rule asserting no `@after-phase-N` tag survives once Phase N is closed.
9. Add a `tsc --noEmit` CI job to prevent silent typecheck rot.
10. Fix `AccountClient.test.tsx` pre-existing weak-assertion (one-line, 3-minute fix).
11. Add 2 missing Dockerfile FSL LABELs (`tests/e2e/mock-realtime/Dockerfile`, `tests/fixtures/idp/Dockerfile`).
12. Lint-block `OPENWHISPR_DISABLE_*` env presence when `NODE_ENV=production`.
13. Document v1→v2 upgrade runbook (especially `setup_state.skipped_legacy` path).
14. Phase 16 lint rule extension to catch `// D-S<N>`, `// SC #<N>`, and other provenance-like comment variants.

---

## Confidence Statement

**Confidence that v2 is shippable as-is: MEDIUM-LOW.**

The v2 code surface is genuinely landed — wizard, harness, BYOK overlays, FSL license text, TLS Makefile, SSO spec — and every phase carries a passing verification doc. But three structural gaps prevent a clean "ship it":

- **The FSL history scrub force-push has not been executed.** Phase 15 is operationally a runbook, not a closed phase. `speaches-audio.md` is still in git history. The FSL announcement cannot ship until this runs.
- **The E2E harness has never executed in real GHA CI** for any v2 phase. Every Gherkin verification claim is "deferred to CI". First real CI run will surface unknowns.
- **Two phases (12, 14) skipped the REVIEW + SECURITY gate** that every other v2 phase carries, and two phases (15, 17) carry "human_needed" status. The verification doc claims do not all hold up against live grep (e.g., 12-VERIFICATION says only `@cjm-1.4` remains RED; actual count is 4).

**The 2-3 things that would most increase confidence:**

1. **Execute the FSL history scrub and the first real `make e2e-cjm` GHA run on the same PR.** Both are mechanical and operator-gated; both convert v2 from "ready" to "shipped".
2. **Retroactively run REVIEW + SECURITY gates on Phase 12 and Phase 14** to match the v2 pattern. This is what other phases caught (Phase 13's 2 HIGH bugs were security-relevant); the absence here is a known unknown.
3. **Flip or document the 4 stale `@after-phase-{12,15}` tags** and add the lint rule so future phase closure cannot silently leave tags red.

With those three items closed, v2 is shippable.
