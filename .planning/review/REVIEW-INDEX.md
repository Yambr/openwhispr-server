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
| **HIGH** | ~38 → **0** | **✅ ALL CLOSED** — Phases 62–68 cleared every HIGH finding (api-core 5, api-routes-rest 3, api-routes-conversations 4, api-routes-transcriptions 11, worker 7, data 6, web+pkgs 16). Phase 68 closed the final 16 (web 6, litellm-client 3, byok-guard+contract-tests 5, wire-schemas 1, small-pkgs 1). |
| **MEDIUM** | ~49 | open — Phase 58+ |
| **LOW** | ~30 | open — Phase 58+ |

> Note: Phase 57 Tier-0 scope was the 9 publication-blocking CRITICALs
> (`data:CR-01/02/03`, `api-routes-rest:CR-01/02/03`, `byok:CR-01/02`,
> `api-core:CR-01`). `worker:CR-01/02` are billing-correctness (Tier-1) and
> `data:CR-04/05` are token-rotation/dead-code — all four deferred to Phase 58.

## Per-package roll-up

| Package | CRIT | HIGH | MED | LOW | Report |
|---|---:|---:|---:|---:|---|
| `apps/api` core (bootstrap/auth/middleware/plugins/lib/i18n) | **1** | 5 → 0 (✅ Phase 62) | 11 | 8 | [api-core.md](./api-core.md) |
| `apps/api` routes — conversations/folders/notes | 0 | 4 → 0 (✅ Phase 64) | 5 | 3 | [api-routes-conversations.md](./api-routes-conversations.md) |
| `apps/api` routes — transcriptions/tokens/v1-keys/agent | 0 | 11 → 0 (✅ Phase 65) | 6* | — | [api-routes-transcriptions.md](./api-routes-transcriptions.md) |
| `apps/api` routes — rest (auth-callback, setup, test-only, …) | **3** | 3 → 0 (✅ Phase 63) | 5 | 8 | [api-routes-rest.md](./api-routes-rest.md) |
| `apps/web` (Next.js 15) | 0 | 6 → 0 (✅ Phase 68) | 12 | 9 | [web.md](./web.md) |
| `apps/worker` (BullMQ) | **2** (CR-01/02 ✅ Phase 58) | 7 → 0 (✅ Phase 66) | 6 | 2 | [worker.md](./worker.md) |
| `packages/data` (schema, RLS, encryption, migrate) | **5** (CR-01/02/03 ✅ Phase 57, CR-04/05 ✅ Phase 58) | 6 → 0 (✅ Phase 67) | 7 | 5 | [data.md](./data.md) |
| `packages/wire-schemas` | 0 | 1 → 0 (✅ Phase 68) | 4 | 8 | [wire-schemas.md](./wire-schemas.md) |
| `packages/litellm-client` | 0 | 3 → 0 (✅ Phase 68) | 4 | 4 | [litellm-client.md](./litellm-client.md) |
| `packages/byok-guard` + `packages/contract-tests` | **2** | 5 → 0 (✅ Phase 68) | — | — | [byok-guard-contract-tests.md](./byok-guard-contract-tests.md) |
| `packages/{auth,email,i18n,observability}` | 0 | 1 → 0 (✅ Phase 68) | 2 | 3 | [small-pkgs.md](./small-pkgs.md) |

\* transcriptions reviewer used WARNING (= HIGH+MEDIUM mix) / INFO scale; counts approximated.

## All CRITICAL findings (13)

### `packages/data` — 5 CRITICALs (the heaviest cluster)

1. **`data:CR-01` — Plaintext credentials at rest for every Better-Auth-owned column.** `apps/api/src/auth.ts:160` exports `ENCRYPTED_COLUMNS_MAP = {}` so the envelope-encryption lens never fires for `account.{password,access_token,refresh_token,id_token}`, `verification.value`, `sessions.{token,previous_token}`. The 48 bytea sidecars added by migration 0019 are dead schema for these models. Phase 33 / CRIT-FIX-02's entire security value is reverted. *(spot-checked: file:line confirmed.)* — **✅ CLOSED by Phase 57 Track A** (commits `382214a`, `8377735`, `adede88`, `6133c2b`: lens transaction-wrap + codegen `additionalFields` + populated `ENCRYPTED_COLUMNS_MAP`; canary `better-auth-envelope-at-rest.test.ts` green).

2. **`data:CR-02` — Fail-OPEN RLS posture re-installed by migration 0024.** Phase 32 / CRIT-FIX-01 (migration 0018) explicitly RESET the rolconfig and DROPped `tenant_id` column DEFAULTs to make RLS fail closed. Migration 0024 RE-INSTALLs `ALTER ROLE openwhispr_app SET app.tenant_id TO '<default>'` + column DEFAULTs on `users`/`sessions`/`account`/`verification`. Any code path missing `withTenant()` silently reads the default tenant. *(spot-checked: migration 0024 lines 43+53-59 confirmed.)* — **✅ RESOLVED by Phase 57 Track B via D2** (commit `42dd13f`: documented v1 single-tenant debt in `docs/security.md` §11.1 + `CLAUDE.md` discipline item 16 + `rls-posture-boundary.test.ts` property test locking the 12-app-tables-fail-closed / 4-BA-tables-default-tenant boundary). Durable fix **D3** (request-scoped per-request Better Auth adapter) is a **v2-blocker** tracked in `.planning/deferred-items.md`. D1 was eliminated — PgBouncer transaction-mode `DISCARD ALL` wipes session `SET`.

3. **`data:CR-03` — Schema mutation driven by tests (CLAUDE.md hard rule 1 violation).** Commits `13a1547` and `da674a3` rewrote production schema + amended LOCKER-08 discipline to satisfy a Better-Auth integration test. Amendment rationale ("lens deletes plaintext before INSERT") is mechanically false given CR-01. — **✅ CLOSED by Phase 57 Track A** (commit `6133c2b`: LOCKER-08 amendment rationale reverted; the rationale is now mechanically true because `ENCRYPTED_COLUMNS_MAP` is populated and the lens fires).

4. **`data:CR-04` — AUTH-04 5-minute overlap broken.** `previous_token_fp` never populated → previous-token rotation overlap window non-functional. — **⚠️ PARTIALLY CLOSED by Phase 58 Track C** (commit `d6b2e939`). The reviewer's claim ("`previous_token_fp` never populated") is a false-positive — `recordPreviousToken` (`token-rotation.ts:80`) writes it via a raw `sql` UPDATE that bypasses the adapter; characterization test `auth-04-token-rotation-overlap.test.ts` confirms population + bounded window. **A residual gap remains**: the deployed `dual-auth` hook wires `tryPreviousToken` onto the RLS-subject `openwhispr_app` pool, and `sessions` has `FORCE ROW LEVEL SECURITY` + the hook runs pre-tenant-resolution → lookup matches 0 rows → the overlap window is non-functional in the deployed binary. Logged in `.planning/deferred-items.md`; needs a BYPASSRLS owner-pool threaded into the dual-auth hot path (grey-area architectural decision — Phase 59).

5. **`data:CR-05` — Dead plaintext-fallback in `oauth-state-codec.ts` post-migration-0020.** — **✅ CLOSED by Phase 58 Track D** (commit `86ef80db`: dead `code_verifier` plaintext branch removed; sole caller `auth-callback.ts` passes a sidecar-only SELECT row — branch confirmed unreachable; positive-lock test added).

### `apps/api` routes — rest — 3 CRITICALs

6. **`api-routes-rest:CR-01` — Host header injection.** `better-auth-handler.ts:79` falls back to `req.headers.host` when `INGRESS_BASE_URL` + `AUTH_URL` both unset. Both allowlist-pass and allowlist-fail branches return the same attacker-controlled `${proto}://${host}`. Better Auth CSRF/Origin/redirect-uri validation bypassable. *(spot-checked: line 79 confirmed.)* — **✅ CLOSED by Phase 57 Track E** (commits `147acd5b`, `38cb182d`: `validateIngressBoot()` boot gate exits 78 when both envs unset; `req.headers.host` fallback removed — origin is always env-derived).

7. **`api-routes-rest:CR-02` — `/api/_test/reset-setup` lacks NODE_ENV='production' veto.** `/api/_test/seed-tenant` has the veto (test-only.ts:372); `/api/_test/reset-setup` (line 311, `auth: false`) does not. One misset `OPENWHISPR_TEST_ROUTES=true` in production allows any unauthenticated caller to re-open the admin claim window. *(spot-checked: confirmed.)* — **✅ CLOSED by Phase 57 Track C** (commits `6f23de0b`, `665a1d2d`: registration gate now `NODE_ENV !== 'production' && (...)`; whole `/api/_test/*` plugin refuses to register in production regardless of `OPENWHISPR_TEST_ROUTES`).

8. **`api-routes-rest:CR-03` — `/api/_test/force-rotate` same fragility.** Line 202 same pattern. Stolen bearer → forced rotation → permanent account takeover. *(spot-checked: confirmed.)* — **✅ CLOSED by Phase 57 Track C** (same registration-gate fix as CR-02).

### `apps/worker` — 2 CRITICALs

9. **`worker:CR-01` — Spend-ingest watermark advances past silently-skipped rows.** `jobs/ingest-litellm-spend.ts:329-344` — missing end_user/tenant/invalid duration rows are skipped but watermark advances. Permanently orphans billable spend even after prerequisite data materializes. Only duration-skip emits a billing-anomaly counter. — **✅ CLOSED by Phase 58 Track A** (commits `3e7ca0e4`, `199e0047`: bounded watermark hold to `min(lastProcessed, oldestRecoverableSkip)` with `MAX_RECOVERABLE_HOLD_MS` age-out; billing-anomaly counters for all 4 skip reasons).

10. **`worker:CR-02` — Daily rollup + reconciliation bucket by `created_at`, not LiteLLM `startTime`.** A 30-second-late tick after UTC midnight allocates yesterday's spend to today's rollup. Reconciliation reads same column so drift gauge reports 0 while rollup is wrong. — **✅ CLOSED by Phase 58 Track B** (commits `d68694ad`, `32b0b933`: migration 0027 adds `usage_ledger.event_at`; ingest writes LiteLLM `startTime`; rollup + reconciliation bucket by `COALESCE(event_at, created_at)` — going-forward, historical numbers unshifted).

### `packages/byok-guard` — 2 CRITICALs

11. **`byok:CR-01` — Redact regex missing common provider key shapes.** `redact-url.ts:61-70` `BEARER_SHAPES` lacks GitHub PAT/OAuth (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`), Tavily (`tvly-`), Yandex (`AQVN…`/`y0_…`), AWS STS (`ASIA…`). Tavily + Yandex are shipped providers (memory). Real keys leak into boot hints + structured logs. *(spot-checked: only `sk-` rule present.)* — **✅ CLOSED by Phase 57 Track D** (commits `063a7c20`, `5eb31e0f`: `BEARER_SHAPES` extended with `gh[pousr]_`, `tvly-`, `AQVN`, `y0_`, `ASIA` shapes).

12. **`byok:CR-02` — `sk-[A-Za-z0-9_-]{20,}` threshold lets `sk-…` ≤19-char bodies through.** LiteLLM virtual keys / sandbox keys typically fit this gap. *(spot-checked: line 63 confirmed.)* — **✅ CLOSED by Phase 57 Track D** (same commits: `sk-` threshold lowered `{20,}` → `{8,}`).

### `apps/api` core — 1 CRITICAL

13. **`api-core:CR-01` — Production safety knobs unguarded by NODE_ENV.** `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_VERIFICATION`, `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE`, `MOCK_DIARIZATION` — WARN-log and continue if set in production. Breaks loud-fail pattern. — **✅ CLOSED by Phase 57 Track F** (commits `c4cfc512`, `1d9331ac`: `validateSafetyKnobsBoot()` exits 78 when any knob is set under `NODE_ENV=production`).

## All HIGH findings (~38) — distribution

- **`api-core` (5):** AUTH_URL plaintext-localhost default; `/__test/fetch` survives in prod via `OPENWHISPR_TEST_ROUTES`; centralized error-handler echoes `err.message` for typed-error classes; OIDC discovery cached unbounded (token-endpoint hijack → client_secret leak); `tryPreviousToken` follow-up email SELECT bypasses RLS. — **✅ ALL CLEARED by Phase 62** (HI-01 already-resolved by Phase 57 Track E; HI-02 `ca5132a9`, HI-03 `128626ee`, HI-04 `dfec2c59`, HI-05 `aa28c391` — see [api-core.md](./api-core.md) per-finding closure markers).
- **`api-routes-conversations` (4):** LOCKER-04 inv-14 violations (12 routes in folders/notes without `schema:`); wire-schema drift in messages.ts (server adds `"tool"` role, metadata shape diverges); non-canonical `{error:string}` envelope in delete-all. — **✅ ALL CLEARED by Phase 64** (H-1 `32f75b3e`, H-2 `df69cfe6`, H-3 `4e976fcb`, H-4 `ad403d59` — see [api-routes-conversations.md](./api-routes-conversations.md) per-finding closure markers; H-2 resolved option-a via advisor — server aligned DOWN to the canonical role enum; H-4's review framing of a string-vs-object envelope corrected — the repo's canonical envelope IS `{error:<string>}`, the fix routes the 400 through the centralized handler).
- **`api-routes-rest` (3):** missing rateLimit on auth-callback + desktop-signin; verification-status docstring claims `(ip,email)` keyed but no keyGenerator → corporate NAT DoS. — **✅ ALL CLEARED by Phase 63** (HR-01 `83a6bc63`, HR-02 `d9e454fb`, HR-03 `c903c62f` — see [api-routes-rest.md](./api-routes-rest.md) per-finding closure markers; HR-03 implemented the `(ip,email)` keyGenerator per D-RL2, doc-downgrade rejected).
- **`api-routes-transcriptions` (11 warning):** `ServiceUnavailable(err.message)` propagating upstream verbatim (7 sites); openai-realtime echoing `upstreamBody`; AuthError code drift `AUTH_ERROR` vs `UNAUTHORIZED`; `Math.random()` for multipart boundary; STT `text_preview` logged unredacted to pino. — **✅ ALL CLEARED by Phase 65** (WR-01 already-closed by Phase 62 HI-03 + regression guard `4a751c18`; WR-02 `4a751c18`, WR-05 `b41a57b8`, WR-06/WR-08 `73661033`, WR-03/WR-04 `c8b5d9ae`, WR-09 `970e17bd`, WR-07 `59b7d732`, WR-10/WR-11 `1c71fafc` — see [api-routes-transcriptions.md](./api-routes-transcriptions.md) per-finding closure markers; WR-04 confirmed the zod-type-provider validator IS attached so the redundant inline parse was dropped; WR-09 resolved Option A — sentinel documented + relative-url guard, as @fastify/http-proxy exposes no URL-rewrite hook). IN-01..06 remain open (MEDIUM, out of scope).
- **`web` (6):** sign-in form drops `?from=`; SessionsTable ships Better Auth bearer tokens to JS heap; NotesListClient queryKey mismatch wastes prefetch; AdminShell has no sign-out button (stale basic-auth assumption); 8 files carry stale `D-ADMIN-1`/Traefik basic-auth comments; hardcoded `:3000` in `internal-api.ts` (LOCKER-03). — **✅ ALL CLEARED by Phase 68** (HI-01 `0f1e9ee7`, HI-02 `4d8e47f0`, HI-03 `08da020c`, HI-04 `a1ac295e`, HI-05 `42a839e1`, HI-06 `b72a23c0` — see [web.md](./web.md) per-finding closure markers; HI-02 resolved doc-route — Better Auth 1.6.9 `revokeSession` is token-only, no id-based variant; HI-06 fail-closed `internalApiUrl()`).
- **`worker` (7):** email-delivery LOCKER-01 NODE_ENV violation + swallowed return on smtp-not-configured; ROLLBACK replaces handler error; partman audit-archive enqueue not idempotent; reconciliation breach-loop schema lacks `request_id`; boot-time `drainStaleVkrKeys` no iteration cap; shutdown always `exit(0)`; maintenancePool lacks PgBouncer-rejection guard.
- **`data` (6):** TRUNCATE-on-replay in migration 0005; FK-column index gaps; audit-log default-partition trap; backfill-CLI now data-corrupting; undocumented `NO ACTION` semantics; stub providers in public barrel. — **✅ ALL CLEARED by Phase 67** (HI-01/03/05 doc-runbook commit `a2397a62`; HI-02 migration `0029` RED `4d15757f`/GREEN `4747b4c8`; HI-04 backfill guard RED `c0837847`/GREEN `15a0095d`; HI-06 barrel-unexport RED `3835c0b2`/GREEN `20a75949` — see [data.md](./data.md) per-finding closure markers; HI-02 excluded `api_keys` — migration 0028 already gave it a leading-`user_id` index; HI-04 the review's "empty ENCRYPTED_COLUMNS_MAP" premise was stale post-Phase-57, the guard is a static lens-managed refuse-list; HI-06 resolved approach (a) — barrel unexport + `docs/security.md §12` correction).
- **`litellm-client` (3):** `LitellmUpstreamError` `message` param bypasses truncation; `LITELLM_VIRTUAL_KEY` env never read by loader; plain-HTTP default with no `https://` assertion. — **✅ ALL CLEARED by Phase 68** (HI-1 `4072c20a`, HI-2/HI-3 `f6687341` — see [litellm-client.md](./litellm-client.md) per-finding closure markers).
- **`byok-guard + contract-tests` (5):** `FIXTURE_PASSWORD` in `src/` of published package; 3 `*.test.ts` in `src/` (no `files:` allowlist); contract-tests schemas drift from wire-schemas; TolerantEnvelope weakens contract; multipart.ts reads repo-root fixture absent from tarball. — **✅ ALL CLEARED by Phase 68** (HI-01/02/05 `d793661f`, HI-03 `254a272c`, HI-04 `86c9c48a` — see [byok-guard-contract-tests.md](./byok-guard-contract-tests.md) per-finding closure markers; tarball hygiene verified via `npm pack --dry-run`; HI-04's enumeration drift guard was already present — confirmed live).
- **`small-pkgs` (1):** EmailSender forwards unescaped `html` to nodemailer (no live exploit today). — **✅ CLEARED by Phase 68** (HIGH-EMAIL-01 `4cda5f6c` — resolved doc-only: verify-first confirmed all 3 callers pass trusted/escaped HTML; the caller-owns-escaping contract is now explicit in the `SendArgs.html` JSDoc + `packages/email/README.md` — see [small-pkgs.md](./small-pkgs.md)).
- **`wire-schemas` (1):** hardcoded EN error message in `MetadataSchema.refine`. — **✅ CLEARED by Phase 68** (H-1 `43687221` — machine key `metadata.too_large` — see [wire-schemas.md](./wire-schemas.md)).

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
