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

## From Plan 14-01 (Phase 14)

### Compose-shape tests asserting the pre-slim-core 19-service base

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
