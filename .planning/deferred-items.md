# Deferred Items

Items discovered during execution that are out of scope for the current plan.

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
