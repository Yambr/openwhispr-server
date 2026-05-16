# Deferred Items

Items discovered during execution that are out of scope for the current plan.

## From Plan 18.1.2-05 (Phase 18.1.2)

### Aggregate `pnpm --filter @openwhispr/api test` — 33 pre-existing failing test files

**Discovered:** 2026-05-15 during Plan 18.1.2-05 execution.

**Symptom:** Running the full `pnpm --filter @openwhispr/api test` reports
`Test Files 33 failed | 240 passed | 31 skipped (304)` with 4 failing tests
total. The 33 failing FILES span:

- 19 `tools/` lint-suite files (lint-cjm-doc, lint-colocated-tests,
  lint-compose-chart-parity, lint-docs-headings, lint-english,
  lint-migrations, lint-rls, lint-tdd, lint-tenant-context, lint-ui-spec,
  lint-weak-assertions, migrate-tests, global-vitest-teardown,
  lint-await-in-non-async, lint-dockerfile-tls, lint-phase-tag-comments,
  phase-tag-sweep, readiness-probe, spdx-header,
  testcontainer-availability, testcontainer-reaper-setup,
  install-hooks)
- 1 `tests/e2e-cjm` file (tls-cert-paths)
- 4 `@openwhispr/*` package files (auth, i18n, observability, wire-schemas)
- 1 `@openwhispr/data` worker-rls-property test
- 5 `apps/api` files (health, index, build-app-diarization-wiring,
  multipart-registered, lib/audit, scripts/check-default-secrets)

**Why deferred:** All 33 failures **pre-exist** Plan 18.1.2-05 — confirmed
by `git stash && pnpm test` showing identical `33 failed | 240 passed |
31 skipped (304)` counts before and after the Plan 05 commits. None of
the failing files were touched by Plan 05. Sample inspection of
`tests/unit/health.test.ts` shows `Error: process.exit unexpectedly
called with "1"` from `src/index.ts:56` — completely unrelated to the
shared-pg fixture migration.

**Plan 05 scope-bound verification:**
- `pnpm --filter @openwhispr/api test tests/unit/routes` — 51 files passed,
  479 tests passed in 47.89 s. ← Cluster #2's parent surface.
- `pnpm --filter @openwhispr/api test tests/unit/routes/conversations/__tests__` — 4 files, 34 tests passed.
- `pnpm --filter @openwhispr/api test tests/unit/routes/notes/__tests__` — 5 files, 36 tests passed.
- `pnpm --filter @openwhispr/api test tests/unit/routes/folders/__tests__ tests/unit/routes/transcriptions/__tests__ tests/unit/routes/v1/keys/__tests__` — 6 files, 56 tests passed.
- Shared testcontainer count after suite: 1 (label=container-hash).

**Likely fix scope:** Each failing file needs its own bug-fix plan;
they appear unrelated to one another. A Phase 18.1.2-07 or later "test
suite stabilization" plan should triage by package.

## From Plan 12-04 (Phase 12)

### AccountClient.test.tsx — pre-existing failure on "renders the three section headings"

**Discovered:** 2026-05-14 during Plan 12-04 execution.

**Symptom:** `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx > AccountClient (Phase 07.1 / Plan 08) > renders the three section headings (Profile / Active sessions / Danger zone)` fails because `screen.getByText(/Active sessions/i)` matches BOTH the subtitle paragraph (`Manage your profile, active sessions, and account deletion.`) AND the `<h2>Active sessions</h2>` heading.

**Why deferred:** The failure exists on `main` HEAD before any Plan 12-04 changes (verified by `git stash && pnpm vitest run AccountClient.test.tsx`). It is unrelated to the auth-screen / OIDC / wizard surface Plan 12-04 modifies, and falls outside the executor scope boundary (only fix issues directly caused by the current task's changes).

**Likely fix:** Tighten the assertion to `screen.getByRole("heading", { name: /^Active sessions$/i })` so it matches only the `<h2>`, not the prose. One-line change; ~3 minutes of work; belongs in a phase touching `AccountClient.tsx` directly.

## From Plan 14-02 (Phase 14)

### refuse-default-secrets.test.ts — "exits 0 and writes a complete, deny-list-clean .env"

**Discovered:** 2026-05-14 during Plan 14-02 execution.

**Symptom:** `tests/self-tests/refuse-default-secrets.test.ts > DATA-05 self-test: bootstrap.sh generates valid .env on placeholders > exits 0 and writes a complete, deny-list-clean .env` fails — the fixture's `.env.example` uses non-canonical placeholder values (`POSTGRES_OWNER_PASSWORD=PLACEHOLDER_OWNER`, etc.) but bootstrap.sh's three-way value semantics (Phase 02.2) regenerate only the literal `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE`. Every other value is preserved as a "real default config value", so the test's `expect(value).not.toBe(expected[key])` assertion fires.

**Why deferred:** The failure exists on `main` HEAD *before* any Plan 14-02 changes (verified by `git stash && pnpm vitest run refuse-default-secrets.test.ts` — same assertion fails identically). It is unrelated to Plan 14-02's bootstrap template-override surface and falls outside the executor scope boundary (only fix issues directly caused by the current task's changes).

**Likely fix:** Update the fixture body to use the canonical `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` literal for every secret key; the regeneration path then exercises correctly. Belongs in a phase auditing bootstrap fixtures or in Phase 14's own bootstrap-test sweep if it grows.

## From Plan 14-01 (Phase 14) — RESOLVED by Plan 14-03

All 7 cascading compose-shape tests were retargeted in Plan 14-03:
- `tests/integration/traefik-network-alias.test.ts` — now merges base
  + ingress + contract-test overlays.
- `tests/integration/traefik-realtime-entrypoint.test.ts` — reads
  `compose/docker-compose.ingress.yml` directly for the host-port assertion.
- `tests/integration/contract-test-runner-compose.test.ts` — merges base
  + ingress + contract-test for the `--profile contract-test` surface;
  bare base for the negative ("not in default") assertion.
- `tests/integration/oidc-env-wiring.test.ts` — merges base + contract-test
  for fixture-idp env wiring; bare base for the lazy-discovery default.
- `tests/infra/compose-schema.test.ts` — DELETED (replaced wholesale by
  `tests/integration/slim-core-base.test.ts` from Plan 14-01).
- `tests/integration/traefik-forwarded-headers.test.ts` — NO change required
  (reads `compose/traefik/traefik.yml` directly, not the compose file).
- `tests/integration/traefik-no-buffering.test.ts` — NO change required
  (reads `compose/traefik/dynamic.yml` directly).

Per-describe timeouts bumped to 30s on retargeted files
(`docker compose config` against the merged chain takes ~10s; vitest
default 5s timed out).

### Compose-shape tests asserting the pre-slim-core 19-service base (historical record)

**Discovered:** 2026-05-14 during Plan 14-01 execution.

**Symptom:** After slim-core inversion (plan 14-01) deletes 12 services (pgbouncer, minio, traefik, otel-collector, loki, tempo, mimir, grafana, mailpit, fixture-idp, seed, contract-test-runner) from the base `docker-compose.yml`, the following tests fail because they assert the existence / shape of those now-overlay-resident services against the bare `docker-compose.yml`:

- `tests/infra/compose-schema.test.ts` — Phase 1 Plan 01 base-shape spec (asserts 10 services + 7 volumes + only-traefik-publishes-ports). Test premise is structurally inverted by slim-core; `tests/integration/slim-core-base.test.ts` is the new canonical replacement.
- `tests/integration/traefik-network-alias.test.ts` — asserts `traefik` service block in base.
- `tests/integration/traefik-realtime-entrypoint.test.ts` — asserts `traefik` host port `8443:8443` in base.
- `tests/integration/traefik-forwarded-headers.test.ts` — asserts traefik static-config in base.
- `tests/integration/traefik-no-buffering.test.ts` — asserts traefik buffering middleware in base.
- `tests/integration/contract-test-runner-compose.test.ts` — asserts `contract-test-runner` block in base.
- `tests/integration/oidc-env-wiring.test.ts` — asserts `fixture-idp` block in base.

**Why deferred:** Plan 14-01's `files_modified` allowlist is explicitly `[docker-compose.yml]`. The phase plan anticipated this cascade: "13 non-slim services are REMOVED from base; they will be re-declared by overlays in Wave 2 plan 14-03." Rewiring each test to load the correct overlay (`compose/overlays/edge.yml`, `compose/overlays/contract-test.yml`, etc.) belongs in the Wave-2 plans that author those overlays, not here.

**Likely fix:** As each Wave-2 overlay plan lands, the corresponding test files above are updated to merge the overlay via `docker compose -f docker-compose.yml -f compose/overlays/<name>.yml config` (or to read the overlay YAML directly when the assertion is YAML-shape only). The Phase-1 base-shape spec (`tests/infra/compose-schema.test.ts`) is replaced wholesale by `tests/integration/slim-core-base.test.ts` (already shipped in plan 14-01) and should be deleted by plan 14-03 once overlays exist.

## From Plan 14-04 (Phase 14)

### Pre-existing apps/api + apps/worker typecheck failures (unrelated to byok-guard or otel sentinel)

**Discovered:** 2026-05-14 during Plan 14-04 typecheck verification.

**Symptom:** `pnpm --filter @openwhispr/api typecheck` and `pnpm --filter @openwhispr/worker typecheck` both report pre-existing errors:

- `apps/worker/src/lib/typed-queue.ts` — `Promise<Promise<Job>>` shape mismatch on BullMQ 5.x typings.
- `apps/worker/src/lib/with-tenant-context.ts` — `unknown` → `AttributeValue | undefined` and `unknown` → `string` in AsyncLocalStorage callback signature.
- `apps/api/src/routes/tokens/_call-provider.ts` — `body: string | undefined` not assignable to `RequestInit.body` under `exactOptionalPropertyTypes: true`.
- `apps/api/src/routes/transcriptions/{create,batch-create}.ts` — `CloudTranscriptionRow` missing index signature for generic constraint.
- Several `*.test.ts` files (typed-queue, reason, transcribe, test-only, openai-realtime) with assorted strictness errors.
- `packages/litellm-client/src/index.ts:171` — `Promise<ResponseData<unknown>>` not assignable to `Promise<ResponseData<null>>` on `chatCompletionsStream`.

**Why deferred:** Per SCOPE BOUNDARY rule. Verified by `grep -i otel|sdk|NodeSDK` on the typecheck output — none of the errors reference the otel-bootstrap files Plan 14-04 modified. The `NodeSDK | null` propagation introduced by this plan typechecks cleanly. These failures pre-date the plan and live in unrelated code paths.

**Likely fix:** Each error needs targeted attention in its owning subsystem (typed-queue / tenant-context / litellm-client). They would naturally be picked up by the next phase that touches those files. Not urgent — vitest test runs are unaffected (vitest uses esbuild, not tsc).

### §14-04 re-confirmed by Phase 18.1 (2026-05-15)

- 7 typecheck errors cataloged in 14-04 remain deferred.
- Re-confirm verified: failures evaluated on commit `2d50d62ef303008ef28cf660c61e216aa27699d6` (HEAD at the time of Phase 18.1 Plan 05 execution); `pnpm typecheck` exit code 1, error count 1.
- Drift since 14-04: -6 (baseline 7 → current 1; the surviving error is `packages/litellm-client/src/index.ts:171` — `Promise<ResponseData<unknown>>` not assignable to `Promise<ResponseData<null>>` on `chatCompletionsStream`. The six apps/api + apps/worker errors enumerated in §14-04 appear to have been resolved by intervening work; investigate before Phase 18.2 to confirm none re-surface under a different shape).
- Justification: scope-stretch for 18.1 (test-debt-closure phase). Fix scheduled for Phase 18.2 OR milestone-close gate.
- Owner: next operator picking up v2 close-out work.
- Closes ROADMAP Phase 18.1 SC9 (re-confirm-deferred-with-justification path).

### §14-04 CLOSED (2026-05-15, Phase 19 — SR-19.2 + SR-19.3)

**Status:** CLOSED via Phase 19-01 (SR-19.2 fastify.d.ts, commit 626fa30) + Phase 19-02 (SR-19.3 BYOKGuardError throw/catch, commit 1488057). The decorator-invisibility class root cause is fixed; remaining symptom-catalog items (BullMQ Promise wrap, RequestInit.body strictness, etc.) belong to distinct subsystems and are tracked under their respective deferrals, not §14-04.

### §14-04 SR-19.2 root-cause closure (2026-05-15, Phase 19-01-02)

- **SR-19.2 deliverable landed:** canonical `apps/api/src/types/fastify.d.ts`
  exists and provides the `declare module 'fastify'` augmentation for
  `FastifyRequest.user` + `FastifyRequest.tenant`. CONTEXT.md D-07 / D-08
  framing of "Phase 14-04 root cause" pointed at the *class* of decorator
  invisibility problems; SR-19.2 fixes that class.
- **Caveat (milestone honesty):** the §14-04 symptom catalog (BullMQ
  `Promise<Promise<Job>>`, `RequestInit.body` strictness, `CloudRow`
  generic constraint, litellm-client `ResponseData<unknown>`) is
  *not* caused by missing decorator types — those failures belong to
  separate subsystems and remain deferred to future phases that touch
  those files. SR-19.2 closes the root-cause class but not every
  catalogued symptom.
- **Status:** root-cause class CLOSED 2026-05-15 (Phase 19-01-02);
  individual symptom entries remain deferred per their original
  justification. Re-evaluate at next milestone-close gate.

## From Phase 18.1 — stale @expected-red REPOINT

### @cjm-3.1 password-reset — @after-phase-19.1 reset-mail wiring

**Discovered:** 2026-05-15 during Phase 18.1 v2 test-debt closure.

**Symptom:** `tests/e2e-cjm/features/password-reset.feature:6` carried `@after-phase-12` (speculative). Actual missing pre-req: `apps/api/src/auth.ts` lacks a `sendResetPassword` hook (Better Auth `forget-password` endpoint runs but never enqueues an email; worker `password_reset` template exists but is uncalled).

**Why deferred:** Phase 12 closed without wiring the hook; not a Phase 12 bug, but a future-phase deliverable. REPOINT to `@after-phase-19.1`.

**Likely fix:** Wire `sendResetPassword` in `apps/api/src/auth.ts` Better Auth config; enqueue via worker `password_reset` template; flip `@cjm-3.1` GREEN. Sub-phase 19.1 = reset-mail.

### @cjm-4.1 transcribe — @after-phase-19.2 stt-fixture

**Discovered:** 2026-05-15 during Phase 18.1.

**Symptom:** `tests/e2e-cjm/features/transcribe.feature:6` carried `@after-phase-12`. Actual missing pre-req: `apps/api/src/routes/transcribe.ts` proxies to LiteLLM (`provider=groq, model=whisper-large-v3`) and throws `MissingProviderKeyError → 503` when `GROQ_API_KEY` empty. CJM compose stack defaults to empty.

**Why deferred:** Per `feedback_loadtest_cost_discipline.md` (paid cloud gets smokes only — no real GROQ key in CI). REPOINT to `@after-phase-19.2`; bias toward a mock-litellm transcribe overlay (canned `{text: ""}` response).

**Likely fix:** Add `compose/docker-compose.cjm-mock-stt.yml` overlay that wires `mock-litellm` to respond canned `{text: ""}` for whisper requests; flip `@cjm-4.1` GREEN. Sub-phase 19.2 = stt-fixture.

### @cjm-1.4 signup-verify (RU locale) — @after-phase-19.3 ba-i18n

**Discovered:** 2026-05-15 during Phase 18.1.

**Symptom:** `tests/e2e-cjm/features/signup-verify.feature:27` carried `@after-phase-15`. Actual missing pre-req: `apps/api/src/routes/better-auth-handler.ts` is a black-box `webHandler` pass-through; Better Auth 4xx error envelope returns ENGLISH verbatim; `req.t(...)` never invoked.

**Why deferred:** Phase 15 surface was FSL relicense + relocation — not i18n. REPOINT to `@after-phase-19.3`.

**Likely fix:** Wrap Better Auth 4xx responses with a `req.t("better-auth:errors.<code>")` interception layer; flip `@cjm-1.4` GREEN. Sub-phase 19.3 = ba-i18n.

### @cjm-6.1 locale-switch — @after-phase-19.4 locale-e2e

**Discovered:** 2026-05-15 during Phase 18.1.

**Symptom:** `tests/e2e-cjm/features/locale-switch.feature:6` carried `@after-phase-15`. Actual missing pre-req: `tests/e2e-cjm/steps/locale.steps.ts:26-42` — all three step bodies `throw new Error("locale UI ships in Phase 15 — @cjm-6.1 stays @expected-red")`. Web-side `language-switcher.tsx` exists; cjm harness uses undici/fetch (no Playwright) and web container is not booted.

**Why deferred:** Requires booting the web container in cjm harness AND swapping out the cucumber HTTP-only step pattern for Playwright. Non-trivial infra. REPOINT to `@after-phase-19.4`.

**Likely fix:** Add web service to `compose/docker-compose.cjm.yml`; replace `throw` stubs in `tests/e2e-cjm/steps/locale.steps.ts:26-42` with real Playwright step-defs driving `LanguageSwitcher`; flip `@cjm-6.1` GREEN. Sub-phase 19.4 = locale-e2e.

---

## From Phase 18.1.1-01 (Bucket A path-fix sweep)

- **otel-bootstrap SIGTERM line-131 pre-existing failure** — `expected [Function] to not throw an error but 'Error: process.exit unexpectedly called with "143"' was thrown`. Unrelated to Cluster 4 path-fix scope. 2 path-related failures dropped to 1 (the SIGTERM one) after Cluster 4 path-fix landed; SIGTERM failure exists independent of path. File: apps/api/tests/unit/otel-bootstrap.test.ts:131. Defer to a separate behaviour-fix plan.

- **entrypoint-db-shape BYOK env missing failure** — after Cluster 5 path-fix (new URL → ../../../src/index.ts), the test now correctly resolves to apps/api/src/index.ts but the bootstrap branch triggers `byok-guard` `process.exit(1)` because the test env lacks BYOK env vars. Pre-fix the same failure (different exception path); fix is to set BYOK env in test setUp, out of Bucket A scope. File: apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts. Defer to a behaviour-fix plan.
## From Phase 18.1.1-01 (Bucket A path-fix sweep)

- **otel-bootstrap SIGTERM line-131 pre-existing failure** — `expected [Function] to not throw an error but 'Error: process.exit unexpectedly called with "143"' was thrown`. Unrelated to Cluster 4 path-fix scope. The 2 path-related failures dropped to 1 (the SIGTERM one) after Cluster 4 fix landed; SIGTERM failure exists independent of path. File: apps/api/tests/unit/otel-bootstrap.test.ts:131. Defer to a separate behaviour-fix plan.

## From Phase 18.1.1-04-05 (SignUpForm terms checkbox)

### W-1 SCOPE-OUT: terms checkbox deferred to Phase 19.x

**Discovered:** 2026-05-15 during Plan 04 Task 05 pre-flight check.

**Symptom:** Planner W-1 mandates that the SignUpForm terms checkbox
(`acceptedTerms: z.literal(true)` field with links to `/terms` and
`/privacy`) ships ONLY if both `apps/web/src/app/(public)/terms` and
`apps/web/src/app/(public)/privacy` route directories exist. Pre-flight
listing of `apps/web/src/app/(public)/` returns only `layout.tsx`,
`setup`, `sign-in`, `sign-up`, `verify-email` — neither legal route
exists.

**Why deferred:** A terms checkbox that links to non-existent routes
would 404 every link click. Per planner W-1 the checkbox is intentionally
scoped out of Plan 04 Task 05; the `SignUpForm.test.tsx` carries a
positive pin asserting `queryByRole("checkbox", { name: /agree to/i })`
returns null so accidental future reintroduction trips the suite.

**Likely fix:** When Phase 19.x ships the `/terms` and `/privacy` route
pages, add the checkbox to SignUpForm (extending signUpSchema with
`acceptedTerms: z.literal(true)`), wire the new
`end-user.signup.action.acceptTerms.label` i18n key (en+ru), and remove
the negative pin in `SignUpForm.test.tsx`.

## From Phase 18.1.1-03-03 (D-12 bootstrapRoles helper)

### worker-rls-property fast-check intermittent fail under parallel docker load

**Discovered:** 2026-05-15 during Plan 03 task D-12 verification.

**Symptom:** `packages/data/tests/unit/__tests__/worker-rls-property.test.ts > worker-tier RLS property (D-W4 layer 3, fast-check) > concurrent tenant-A / tenant-B jobs see only own notes (real BullMQ + Postgres)` fails intermittently with `Property failed after 8 tests` when run alongside heavy parallel testcontainer suites (e.g. `rls-property.test.ts`). The same test passes 100% when run alone or with light siblings.

**Why deferred:** Pre-existing flake — the inline-SQL → `bootstrapRoles()` helper refactor in D-12 emits byte-equivalent SQL, so it is not the trigger. Failure is rooted in docker resource contention (BullMQ/Redis + Postgres + PgBouncer testcontainers all racing). Out-of-scope per executor SCOPE BOUNDARY (only fix issues directly caused by current-task changes).

**Likely fix:** Either serialize worker-rls-property's vitest project so it does not co-run with rls-property/pgbouncer-interleave, or raise the fast-check seed shrink iterations to tolerate concurrent-container scheduling jitter. Belongs to a dedicated test-stability sweep.

## From Phase 18.1.1-01 Cluster 11 (apps/web locales coverage)

- **end-user.account.subtitle.body.text content drift** —
  `apps/web/tests/unit/locales/__tests__/coverage.test.ts` (Phase 07.1 / Plan
  06) asserts the en bundle value matches UI-SPEC-end-user.md Appendix C
  exactly. Cluster 11 fixed the REPO_ROOT depth (5 → 6 hops) so the spec
  table is now reachable; one remaining mismatch is content drift:
  bundle has `"Manage your profile and account."`; spec wants
  `"Manage your profile, active sessions, and account deletion."`.
  Out of scope for path-fix cluster — belongs to UI-SPEC copy reconciliation.

### Phase 18.1.2-02 singleThread for integration tests — DEFERRED

Vitest 4.1.5 removed `poolOptions` AND `poolMatchGlobs` (node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:179: "test.poolOptions was removed in Vitest 4"). Plan 18.1.2-02 task 02-03 HALT-3-branch user choice → Option (c) Defer: rely on withReuse() solo to address Docker Desktop port-exhaustion. A1 advisor's belt-and-suspenders singleThread becomes belt-only.

If port-exhaustion recurs after Plans 03-05 land, revisit via Vitest `projects` config (Option b).

### Phase 18.1.2-03 W-2 / W-2-bis → SR-19.1 (FK strip) + SR-19.1b (test-infra design) — Phase 19-03 update

**Status:** Partial closure 2026-05-15 via Phase 19-03 Plan 03 commit `d45291d` (SR-19.1 Option a). The 8 hardcoded `REFERENCES "public"."<table>"` sites in `packages/data/migrations/0000_initial.sql` + `0014_audit_log_partition.sql` + `0014_audit_log_partition.down.sql` are stripped. 3 partman registry literals (`'public.audit_log'` in partman API calls + part_config) intentionally exempt (NOT FK refs).

**Carry → SR-19.1b (open):** Per-file `search_path` test-isolation infrastructure design is still required. `apps/api/tests/support/shared-pg.ts` was BORN at commit `15c24c9` with the shared-public + TRUNCATE pattern; no prior per-file state exists for atomic revert. Mild D-20 violation acknowledged. Suggested design (deferred to v3 or dedicated test-infra-hardening phase): `acquireSchema(testId)` API + per-schema `migrationsSchema=_meta_test_<id>` + partman-aware helper. Estimated scope: ~4-6h. Touches ~17 integration test files + `shared-pg.ts` + a new partman test helper. Tracked as SERVER-ERRORS.md Entry 6.

**Current pattern (GREEN, in place since Phase 18.1.2-03):**
- Shared `public` schema via `getSharedPostgres()` (shared-pg.ts)
- Drizzle `_meta.__drizzle_migrations` no-ops repeated migrate() calls
- Per-file `TRUNCATE` in `beforeEach` + unique user emails for logical isolation
- 25/25 integration tests + 479/479 route tests stay GREEN post-SR-19.1 strip

### Phase 18.1.2-03 retry #3 W-2-bis HALT: shared-pg.ts uses `postgres:17-alpine` (no pg_partman)

**Discovered:** 2026-05-15 during Plan 18.1.2-03 retry #3 (Option A migration of `usage.integration.test.ts`).

**Symptom:** Once `usage.integration.test.ts` is rewired to `getSharedPostgres()` and the MIGRATIONS_FOLDER path is corrected from 5-up to 6-up (so migrate() actually finds the real `packages/data/migrations` tree), drizzle's migrate() advances past 0013 to `0014_audit_log_partition.sql` and fails on `partman.create_parent(...)` → `error: schema "partman" does not exist` (PG SQLSTATE 3F000).

**Root cause:** `apps/api/tests/support/shared-pg.ts` (created by Plan 18.1.2-02) hard-codes `new PostgreSqlContainer("postgres:17-alpine")` and never provisions `pg_partman`. Plan 02 predated awareness of migration 0014's hard partman dependency at apply time. Pattern documented in `packages/data/src/__tests__/helpers.ts` (`POSTGRES_PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman"` + `provisionPgPartman()` helper) is the canonical correct shape; shared-pg.ts must adopt it.

**Why HALT (not Rule 3 auto-fix):**
- Scope-stretch beyond Plan 18.1.2-03's stated "2 file migrations + 1 summary" envelope.
- `shared-pg.ts` is a Plan 18.1.2-02 deliverable; editing it from Plan 03 conflates plan ownership.
- Even though `shared-pg.ts` is test infrastructure (not production — CLAUDE.md hard rule #1 not directly tripped), the partman-image swap also requires propagating `provisionPgPartman()` semantics + the additional grants documented in helpers.ts:115-140. That's roughly 30 LOC of test-infra change on a file authored by a sibling plan.
- Original streaming-usage test (untouched, with the broken 5-up path) ALSO fails — meaning these integration tests have not been runnable since migration 0014 landed in Phase 06. So the "Option A makes them green" claim was incorrect from the planner — both files need the partman fix BEFORE Option A even has a chance to be evaluated.

**Proposed paths forward (user decision required):**
- **(a)** Extend Plan 18.1.2-03 scope to also edit `apps/api/tests/support/shared-pg.ts`: switch image to `POSTGRES_PARTMAN_IMAGE`, inline the `provisionPgPartman()` semantics, add partman grants. ~30 LOC test-infra change. Test infra only — CLAUDE.md hard rule #1 not violated.
- **(b)** Author a focused Plan 18.1.2-03.5 that fixes shared-pg.ts first, then re-runs the Option A migration of the two route tests as a follow-up wave.
- **(c)** Add a `image?: string` + `withPgPartman?: boolean` parameter to `getSharedPostgres()` mirroring `bootMigratedPostgres()`'s shape, defaulting to the partman image since migrations beyond 0013 are now the production baseline. Cleanest API; biggest plan-02-revision surface.

**Production code untouched:** confirmed. No migration SQL, route handlers, or schemas edited.


## G10 — Billing & subscription CJM (deferred to v3)

**Source:** `.planning/qa-audit/2026-05-16-cjm-coverage.md` G10.
**Phase 50 closure:** doc-anchor only at `docs/customer-journeys.md`
"## billing. Subscription & billing (G10 — deferred to v3)" reserves
the `@cjm-billing-*` tag namespace.
**v3 deliverable:** subscription wire surface (Stripe webhooks, usage
metering for paid tiers, dunning) + `@cjm-billing-1.x` Gherkin
scenarios. Until v3 lands, no code, no tests, no `.feature` file.
**Why deferred:** Phase 13 + Phase 14 froze v2.1 scope at the
self-host / BYOK matrix; billing requires a payment provider
integration that is out of scope for the OSS quickstart and not in
the corporate BYOK story either.

## From Plan 20-02b (Phase 20)

### Worker Dockerfile broken — missing packages/data COPY (Phase 33-04 cascade)

**Discovered:** 2026-05-16 during Plan 20-02b Task 2 (USER 1000 change).

**Symptom:** `docker build -f apps/worker/Dockerfile .` fails at the
`pnpm --filter @openwhispr/worker build` step with:

```
src/index.ts:12:39: ERROR: Could not resolve "@openwhispr/data"
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @openwhispr/worker@0.0.0 build: tsup
```

**Root cause:** Commit `e038481` (`feat(33-04): green — validateEncryptionBoot
wired into api + worker entries`) added an `import { validateEncryptionBoot }
from "@openwhispr/data"` to `apps/worker/src/index.ts` but never updated
`apps/worker/Dockerfile` to COPY the `packages/data` source tree + manifest
into the builder stage. tsup's `noExternal` pattern needs the source tree
present at build time to inline the workspace package. apps/api/Dockerfile
has the matching COPY pair (lines 41–42 + 71); apps/worker/Dockerfile does
NOT.

**Scope boundary:** Phase 20-02b only touches the `USER` directive at the
runtime stage; the build failure is upstream of that change and reproduces
on the pre-edit baseline (verified via `git stash` + rebuild). Per CLAUDE.md
Hard Rule #1, Phase 20-02b does NOT modify the worker Dockerfile beyond its
SR-20.5 mandate.

**Verification gap:** Plan 20-02b Task 2's `docker run --rm
openwhispr-worker:test20-02b -c 'id -u'` check could not run. The USER 1000
directive itself is syntactically valid (identical pattern as
apps/api/Dockerfile which built+ran successfully and returned uid 1000).
Once the upstream build is fixed the runtime check will pass.

**Recommended owner:** Phase 33 (envelope-encryption) follow-up plan OR a
small targeted Dockerfile-fix plan that adds `COPY packages/data/package.json`
+ `COPY packages/data packages/data` to the worker builder stage, mirroring
the api Dockerfile pattern. Tracking issue: TBD.

### LiteLLM non-root image fork

Phase 20-02b adopted Option A (relaxed hardening) for `ghcr.io/berriai/litellm:main-v1.83.14-stable` because:
1. Upstream image runs as uid 0
2. Prisma client writes to `/app/.prisma` at startup — incompatible with readOnlyRootFilesystem

Future hardening phase may revisit by either (a) building a fork with `USER 1000` + writable PVC for Prisma cache, or (b) waiting for upstream to add non-root support. Tracking issue: TBD.
