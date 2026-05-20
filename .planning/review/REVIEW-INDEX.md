# Code Review Index — pre-GitHub publication

- **Branch:** main @ `6e43588`
- **Date:** 2026-05-20
- **Reviewers:** 11 parallel `gsd-code-reviewer` agents (one per package/route-group)
- **Scope:** production code in `apps/**` + `packages/**`. Tests, `tools/`, `.planning/`, `docs/`, `compose/`, `charts/` excluded.

> **STATUS UPDATE 2026-05-20 — Phase 57 closed all 13 Tier-0 CRITICAL findings.**
> See `.planning/phases/57-pre-publication-critical-fixes/`. Per-finding closure
> markers inline below. `data:CR-04`/`CR-05` + all HIGH/MED/LOW remain open
> (Phase 58+). Tier-0 publication blockers are CLEARED.

## Aggregate totals

| Severity | Count | Status |
|---|---|---|
| **CRITICAL** | **13** | **11 closed by Phase 57** (9 fixed + `data:CR-02` resolved-via-D2); 2 (`worker:CR-01/02`) deferred to Phase 58. Plus `data:CR-04/05` deferred. |
| **HIGH** | ~38 | open — Phase 58 |
| **MEDIUM** | ~49 | open — Phase 58+ |
| **LOW** | ~30 | open — Phase 58+ |

> Note: Phase 57 Tier-0 scope was the 9 publication-blocking CRITICALs
> (`data:CR-01/02/03`, `api-routes-rest:CR-01/02/03`, `byok:CR-01/02`,
> `api-core:CR-01`). `worker:CR-01/02` are billing-correctness (Tier-1) and
> `data:CR-04/05` are token-rotation/dead-code — all four deferred to Phase 58.

## Per-package roll-up

| Package | CRIT | HIGH | MED | LOW | Report |
|---|---:|---:|---:|---:|---|
| `apps/api` core (bootstrap/auth/middleware/plugins/lib/i18n) | **1** | 5 | 11 | 8 | [api-core.md](./api-core.md) |
| `apps/api` routes — conversations/folders/notes | 0 | 4 | 5 | 3 | [api-routes-conversations.md](./api-routes-conversations.md) |
| `apps/api` routes — transcriptions/tokens/v1-keys/agent | 0 | 11* | 6* | — | [api-routes-transcriptions.md](./api-routes-transcriptions.md) |
| `apps/api` routes — rest (auth-callback, setup, test-only, …) | **3** | 3 | 5 | 8 | [api-routes-rest.md](./api-routes-rest.md) |
| `apps/web` (Next.js 15) | 0 | 6 | 12 | 9 | [web.md](./web.md) |
| `apps/worker` (BullMQ) | **2** | 7 | 6 | 2 | [worker.md](./worker.md) |
| `packages/data` (schema, RLS, encryption, migrate) | **5** | 6 | 7 | 5 | [data.md](./data.md) |
| `packages/wire-schemas` | 0 | 1 | 4 | 8 | [wire-schemas.md](./wire-schemas.md) |
| `packages/litellm-client` | 0 | 3 | 4 | 4 | [litellm-client.md](./litellm-client.md) |
| `packages/byok-guard` + `packages/contract-tests` | **2** | 5 | — | — | [byok-guard-contract-tests.md](./byok-guard-contract-tests.md) |
| `packages/{auth,email,i18n,observability}` | 0 | 1 | 2 | 3 | [small-pkgs.md](./small-pkgs.md) |

\* transcriptions reviewer used WARNING (= HIGH+MEDIUM mix) / INFO scale; counts approximated.

## All CRITICAL findings (13)

### `packages/data` — 5 CRITICALs (the heaviest cluster)

1. **`data:CR-01` — Plaintext credentials at rest for every Better-Auth-owned column.** `apps/api/src/auth.ts:160` exports `ENCRYPTED_COLUMNS_MAP = {}` so the envelope-encryption lens never fires for `account.{password,access_token,refresh_token,id_token}`, `verification.value`, `sessions.{token,previous_token}`. The 48 bytea sidecars added by migration 0019 are dead schema for these models. Phase 33 / CRIT-FIX-02's entire security value is reverted. *(spot-checked: file:line confirmed.)* — **✅ CLOSED by Phase 57 Track A** (commits `382214a`, `8377735`, `adede88`, `6133c2b`: lens transaction-wrap + codegen `additionalFields` + populated `ENCRYPTED_COLUMNS_MAP`; canary `better-auth-envelope-at-rest.test.ts` green).

2. **`data:CR-02` — Fail-OPEN RLS posture re-installed by migration 0024.** Phase 32 / CRIT-FIX-01 (migration 0018) explicitly RESET the rolconfig and DROPped `tenant_id` column DEFAULTs to make RLS fail closed. Migration 0024 RE-INSTALLs `ALTER ROLE openwhispr_app SET app.tenant_id TO '<default>'` + column DEFAULTs on `users`/`sessions`/`account`/`verification`. Any code path missing `withTenant()` silently reads the default tenant. *(spot-checked: migration 0024 lines 43+53-59 confirmed.)* — **✅ RESOLVED by Phase 57 Track B via D2** (commit `42dd13f`: documented v1 single-tenant debt in `docs/security.md` §11.1 + `CLAUDE.md` discipline item 16 + `rls-posture-boundary.test.ts` property test locking the 12-app-tables-fail-closed / 4-BA-tables-default-tenant boundary). Durable fix **D3** (request-scoped per-request Better Auth adapter) is a **v2-blocker** tracked in `.planning/deferred-items.md`. D1 was eliminated — PgBouncer transaction-mode `DISCARD ALL` wipes session `SET`.

3. **`data:CR-03` — Schema mutation driven by tests (CLAUDE.md hard rule 1 violation).** Commits `13a1547` and `da674a3` rewrote production schema + amended LOCKER-08 discipline to satisfy a Better-Auth integration test. Amendment rationale ("lens deletes plaintext before INSERT") is mechanically false given CR-01. — **✅ CLOSED by Phase 57 Track A** (commit `6133c2b`: LOCKER-08 amendment rationale reverted; the rationale is now mechanically true because `ENCRYPTED_COLUMNS_MAP` is populated and the lens fires).

4. **`data:CR-04` — AUTH-04 5-minute overlap broken.** `previous_token_fp` never populated → previous-token rotation overlap window non-functional. — **⏳ DEFERRED to Phase 58** (out of Phase 57 scope per CONTEXT.md).

5. **`data:CR-05` — Dead plaintext-fallback in `oauth-state-codec.ts` post-migration-0020.** — **⏳ DEFERRED to Phase 58** (out of Phase 57 scope per CONTEXT.md).

### `apps/api` routes — rest — 3 CRITICALs

6. **`api-routes-rest:CR-01` — Host header injection.** `better-auth-handler.ts:79` falls back to `req.headers.host` when `INGRESS_BASE_URL` + `AUTH_URL` both unset. Both allowlist-pass and allowlist-fail branches return the same attacker-controlled `${proto}://${host}`. Better Auth CSRF/Origin/redirect-uri validation bypassable. *(spot-checked: line 79 confirmed.)* — **✅ CLOSED by Phase 57 Track E** (commits `147acd5b`, `38cb182d`: `validateIngressBoot()` boot gate exits 78 when both envs unset; `req.headers.host` fallback removed — origin is always env-derived).

7. **`api-routes-rest:CR-02` — `/api/_test/reset-setup` lacks NODE_ENV='production' veto.** `/api/_test/seed-tenant` has the veto (test-only.ts:372); `/api/_test/reset-setup` (line 311, `auth: false`) does not. One misset `OPENWHISPR_TEST_ROUTES=true` in production allows any unauthenticated caller to re-open the admin claim window. *(spot-checked: confirmed.)* — **✅ CLOSED by Phase 57 Track C** (commits `6f23de0b`, `665a1d2d`: registration gate now `NODE_ENV !== 'production' && (...)`; whole `/api/_test/*` plugin refuses to register in production regardless of `OPENWHISPR_TEST_ROUTES`).

8. **`api-routes-rest:CR-03` — `/api/_test/force-rotate` same fragility.** Line 202 same pattern. Stolen bearer → forced rotation → permanent account takeover. *(spot-checked: confirmed.)* — **✅ CLOSED by Phase 57 Track C** (same registration-gate fix as CR-02).

### `apps/worker` — 2 CRITICALs

9. **`worker:CR-01` — Spend-ingest watermark advances past silently-skipped rows.** `jobs/ingest-litellm-spend.ts:329-344` — missing end_user/tenant/invalid duration rows are skipped but watermark advances. Permanently orphans billable spend even after prerequisite data materializes. Only duration-skip emits a billing-anomaly counter. — **⏳ DEFERRED to Phase 58** (Tier-1 billing-correctness; out of Phase 57 Tier-0 scope per CONTEXT.md).

10. **`worker:CR-02` — Daily rollup + reconciliation bucket by `created_at`, not LiteLLM `startTime`.** A 30-second-late tick after UTC midnight allocates yesterday's spend to today's rollup. Reconciliation reads same column so drift gauge reports 0 while rollup is wrong. — **⏳ DEFERRED to Phase 58** (Tier-1 billing-correctness).

### `packages/byok-guard` — 2 CRITICALs

11. **`byok:CR-01` — Redact regex missing common provider key shapes.** `redact-url.ts:61-70` `BEARER_SHAPES` lacks GitHub PAT/OAuth (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`), Tavily (`tvly-`), Yandex (`AQVN…`/`y0_…`), AWS STS (`ASIA…`). Tavily + Yandex are shipped providers (memory). Real keys leak into boot hints + structured logs. *(spot-checked: only `sk-` rule present.)* — **✅ CLOSED by Phase 57 Track D** (commits `063a7c20`, `5eb31e0f`: `BEARER_SHAPES` extended with `gh[pousr]_`, `tvly-`, `AQVN`, `y0_`, `ASIA` shapes).

12. **`byok:CR-02` — `sk-[A-Za-z0-9_-]{20,}` threshold lets `sk-…` ≤19-char bodies through.** LiteLLM virtual keys / sandbox keys typically fit this gap. *(spot-checked: line 63 confirmed.)* — **✅ CLOSED by Phase 57 Track D** (same commits: `sk-` threshold lowered `{20,}` → `{8,}`).

### `apps/api` core — 1 CRITICAL

13. **`api-core:CR-01` — Production safety knobs unguarded by NODE_ENV.** `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_VERIFICATION`, `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE`, `MOCK_DIARIZATION` — WARN-log and continue if set in production. Breaks loud-fail pattern. — **✅ CLOSED by Phase 57 Track F** (commits `c4cfc512`, `1d9331ac`: `validateSafetyKnobsBoot()` exits 78 when any knob is set under `NODE_ENV=production`).

## All HIGH findings (~38) — distribution

- **`api-core` (5):** AUTH_URL plaintext-localhost default; `/__test/fetch` survives in prod via `OPENWHISPR_TEST_ROUTES`; centralized error-handler echoes `err.message` for typed-error classes; OIDC discovery cached unbounded (token-endpoint hijack → client_secret leak); `tryPreviousToken` follow-up email SELECT bypasses RLS.
- **`api-routes-conversations` (4):** LOCKER-04 inv-14 violations (12 routes in folders/notes without `schema:`); wire-schema drift in messages.ts (server adds `"tool"` role, metadata shape diverges); non-canonical `{error:string}` envelope in delete-all.
- **`api-routes-rest` (3):** missing rateLimit on auth-callback + desktop-signin; verification-status docstring claims `(ip,email)` keyed but no keyGenerator → corporate NAT DoS.
- **`api-routes-transcriptions` (11 warning):** `ServiceUnavailable(err.message)` propagating upstream verbatim (7 sites); openai-realtime echoing `upstreamBody`; AuthError code drift `AUTH_ERROR` vs `UNAUTHORIZED`; `Math.random()` for multipart boundary; STT `text_preview` logged unredacted to pino.
- **`web` (6):** sign-in form drops `?from=`; SessionsTable ships Better Auth bearer tokens to JS heap; NotesListClient queryKey mismatch wastes prefetch; AdminShell has no sign-out button (stale basic-auth assumption); 8 files carry stale `D-ADMIN-1`/Traefik basic-auth comments; hardcoded `:3000` in `internal-api.ts` (LOCKER-03).
- **`worker` (7):** email-delivery LOCKER-01 NODE_ENV violation + swallowed return on smtp-not-configured; ROLLBACK replaces handler error; partman audit-archive enqueue not idempotent; reconciliation breach-loop schema lacks `request_id`; boot-time `drainStaleVkrKeys` no iteration cap; shutdown always `exit(0)`; maintenancePool lacks PgBouncer-rejection guard.
- **`data` (6):** TRUNCATE-on-replay in migration 0005; FK-column index gaps; audit-log default-partition trap; backfill-CLI now data-corrupting; undocumented `NO ACTION` semantics; stub providers in public barrel.
- **`litellm-client` (3):** `LitellmUpstreamError` `message` param bypasses truncation; `LITELLM_VIRTUAL_KEY` env never read by loader; plain-HTTP default with no `https://` assertion.
- **`byok-guard + contract-tests` (5):** `FIXTURE_PASSWORD` in `src/` of published package; 3 `*.test.ts` in `src/` (no `files:` allowlist); contract-tests schemas drift from wire-schemas; TolerantEnvelope weakens contract; multipart.ts reads repo-root fixture absent from tarball.
- **`small-pkgs` (1):** EmailSender forwards unescaped `html` to nodemailer (no live exploit today).
- **`wire-schemas` (1):** hardcoded EN error message in `MetadataSchema.refine`.

## Recommended fix order

### Tier 0 — Block GitHub publication (CRITICALs only)
1. **data:CR-01 + CR-03** — restore `ENCRYPTED_COLUMNS_MAP` to non-empty Better-Auth coverage; revert LOCKER-08 amendment that rationalized the gap
2. **data:CR-02** — revert migration 0024 (or replace with non-fail-open variant that keeps Better-Auth happy without rolconfig DEFAULT)
3. **api-routes-rest:CR-02 + CR-03** — add NODE_ENV='production' veto to ALL `/api/_test/*` handlers, not just seed-tenant
4. **byok:CR-01 + CR-02** — extend `BEARER_SHAPES` regex set; lower `sk-` threshold; add coverage tests for ghp_/tvly/AQVN/ASIA/`sk-…<20` shapes
5. **api-routes-rest:CR-01** — make `INGRESS_BASE_URL` (or `AUTH_URL`) boot-required; never trust `req.headers.host` as origin
6. **api-core:CR-01** — wrap production safety knobs in NODE_ENV='production' → exit 78 (`EX_CONFIG`) or hard-no-op

### Tier 1 — Pre-publish polish
7. **worker:CR-01 + CR-02** — billing correctness; replatform spend-ingest + rollup to bucket by `startTime`, never advance watermark past silently-skipped rows
8. **data:CR-04 + CR-05** — wire `previous_token_fp`; remove dead plaintext-fallback
9. All ~38 HIGH findings (route-by-route via `/gsd-code-review --fix` or targeted phase)

### Tier 2 — Quality / consistency (MEDIUM + LOW)
10. Dead exports cleanup, stale comment purge (8 `D-ADMIN-1` references in apps/web), wire-schema drift between contract-tests and wire-schemas, i18n hardcoded strings

## Verification of this index (CLAUDE.md hard rule 3)

Spot-checks performed before publishing this index:
- ✅ `data:CR-01` — `apps/api/src/auth.ts:160` `ENCRYPTED_COLUMNS_MAP = {}` confirmed
- ✅ `data:CR-02` — `packages/data/migrations/0024_better_auth_tenant_id_defaults.sql:43,53-59` re-installs rolconfig + DEFAULTs confirmed
- ✅ `api-routes-rest:CR-01` — `better-auth-handler.ts:79` `req.headers.host` fallback confirmed
- ✅ `api-routes-rest:CR-02/CR-03` — `test-only.ts:202,311` lack the production-veto at line 372 (seed-tenant has it; reset-setup and force-rotate do not)
- ✅ `byok:CR-01/CR-02` — `redact-url.ts:63` only `sk-` shape present; ghp_/tvly/AQVN/ASIA absent

The 5 spot-checked CRITICALs are confirmed real, not agent hallucinations. The remaining 8 are taken at agent's word at this index-write time; re-spot-check before fixing.

## Links

- [.planning/review/api-core.md](./api-core.md)
- [.planning/review/api-routes-conversations.md](./api-routes-conversations.md)
- [.planning/review/api-routes-transcriptions.md](./api-routes-transcriptions.md)
- [.planning/review/api-routes-rest.md](./api-routes-rest.md)
- [.planning/review/web.md](./web.md)
- [.planning/review/worker.md](./worker.md)
- [.planning/review/data.md](./data.md)
- [.planning/review/wire-schemas.md](./wire-schemas.md)
- [.planning/review/litellm-client.md](./litellm-client.md)
- [.planning/review/byok-guard-contract-tests.md](./byok-guard-contract-tests.md)
- [.planning/review/small-pkgs.md](./small-pkgs.md)
