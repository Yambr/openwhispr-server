# Phase 41: Residual HIGH sweep — Context

**Source:** ROADMAP Phase 41 + `.planning/review/REVIEW-INDEX.md` HIGH findings + `31-08-DEFERRED.md` + `32-DEFERRED.md`
**Closes:** HIGH-FIX-API-CORE, AGENT-STREAM, WEB, WORKER, DATA, LITELLM, SMALL
**Mode:** AUTONOMOUS — user offline; advisor-researcher for grey-area

## Phase 32 lessons re-applied (pre-flight)

- Migration sequence: 0019 was taken by Phase 33; **next is 0020** (drop-plaintext, also Phase 33). Sub-plan 41.e UPSERT migration is **0021**.
- RLS pattern: any new tenant-scoped table operations inherit `NULLIF(...)::uuid` pattern.
- Better Auth encryption (Phase 33) wraps `account.{access_token, refresh_token, password, ...}` via lens. 41.e's `expires_at` TTL check belongs at the **application layer**, not in SQL — credential value is bytea ciphertext now.

## 7 sub-plans

### 41.a — api-core HIGH cluster (HIGH-FIX-API-CORE)

Source: `.planning/review/api-core.md` HI-01..03.

- `apps/api/src/auth.ts:330, 380` — replace hardcoded `"00000000-0000-0000-0000-000000000000"` with `resolveDefaultTenantId()` (existing helper per review). Password-reset / verification emails attribute to correct tenant.
- `apps/api/src/placeholder.ts` — delete (phase-0 dead code; no Stryker config justifies keeping it — verified during Phase 38).
- Residual bootstrap concerns from api-core review HI-03.

### 41.b — agent-stream HIGH cluster (HIGH-FIX-AGENT-STREAM)

Source: `.planning/review/api-routes-transcriptions.md` HI-01..03.

- `apps/api/src/routes/agent/stream.ts` — read `DEFAULT_AGENT_MODEL` from `compose/litellm/litellm_config.yaml` at boot (not hardcoded; closes `qwen/qwen3.6-plus` vs `qwen3.6-plus` drift).
- Add zod body validation: new schema `AgentStreamRequest` in `packages/wire-schemas` (Phase 31 LOCKER-04 catches this gap).
- Add per-user `config: { rateLimit: { max, timeWindow } }` to the route.

### 41.c — web HIGH cluster (HIGH-FIX-WEB)

Source: `.planning/review/web.md` HI-1, HI-2.

- `apps/web/src/app/(admin)/layout.tsx` — add app-level role-check RSC guard (read role from session; redirect to `/sign-in` or 403 if not admin). Defense-in-depth on top of Traefik basic-auth.
- Remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only env branches from 5 production RSC pages (the 5 cited in review: `app/(auth)/app/page.tsx:36`, `notes/page.tsx:23`, `transcriptions/page.tsx:23`, `conversations/page.tsx:23`, `conversations/[id]/page.tsx:26`). Phase 31 LOCKER-01 (`lint-no-env-branches`) catches future regressions.

### 41.d — worker HIGH cluster (HIGH-FIX-WORKER)

Source: `.planning/review/worker.md` HI-1..4.

- `apps/worker/src/index.ts` + `apps/worker/src/jobs/ingest-litellm-spend.ts` — replace bare `pino()` with shared redact factory from `packages/observability` (PII leak closed).
- `apps/worker/src/jobs/reconciliation-daily-check.ts` — loop bound corrected to iterate over tenants (not distinct users).
- Module-level OTel gauge callbacks — refactor so observers read fresh `driftStore` (no 23h-stale alerts).
- `apps/worker/src/jobs/ingest-litellm-spend.ts:142-216` — validate `metadata.duration` is numeric on minutes-priced models; warn-log + counter metric on non-numeric; closes silent zero-billing.

### 41.e — data HIGH cluster (HIGH-FIX-DATA)

Source: `.planning/review/data.md` HI-01..04 (HI-04 already closed by Phase 32).

- `packages/data/src/migrate.ts` — LiteLLM-init idempotency (re-runs are safe).
- Migration `0021_*.sql` — replace 0005's destructive `TRUNCATE TABLE` with idempotent UPSERT.
- Account-token `expires_at` enforcement at the application layer (Phase 33 made the value bytea; TTL check belongs in `apps/api/src/auth.ts` or the Better Auth lens layer).

### 41.f — litellm-client HIGH cluster (HIGH-FIX-LITELLM)

Source: `.planning/review/litellm-client.md` HI-1..4.

- Add `headersTimeout` + `bodyTimeout` + REQUIRED `AbortSignal` to `chatCompletions`, `audioTranscriptions`, `passthrough` (3 methods).
- Module-load assertion: throw if `getGlobalDispatcher()` is not the wrapped SSRF Agent (catches worker/CLI bypass).
- Read model alias map from `compose/litellm/litellm_config.yaml` (single source of truth).
- Refactor `streamOptions` so callers can opt OUT of `include_usage`.

### 41.g — small-pkgs HIGH cluster (HIGH-FIX-SMALL)

Source: `.planning/review/small-pkgs.md` HI-01..03.

- `packages/i18n/` — decision branch:
  - If Phase 10's en+ru bundles already provide full i18n coverage → rename `@openwhispr/i18n` → `@openwhispr/i18n-stub` (mirror Phase 38) and document deprecation.
  - Otherwise → ship real en + ru bundles in this package.
  - Decision recorded in `41-g-DECISIONS.md`.
- CI parity test between `byok-guard` provider list and `observability/redact.ts` provider list. Drift = test failure.
- `packages/email/src/EmailSender.ts:115` — `SMTP_SECURE` parser accepts `1`/`true`/`yes`/`on` case-insensitive (currently only literal `"true"`; silent TLS downgrade closure).

## Plus: deferred-from-earlier-phases catch-up

### Fix 11 Phase-32 DEFERRED tests

`.planning/phases/32-rls-fail-closed/32-DEFERRED.md` cataloged 11 pre-existing test failures broken by RLS fail-closed. Per category-A: 5 were replaced/deleted by Phase 33-05's atomic closure. Remaining 6 (category-B/C) still need updating to assert the new posture. Plan 41 closure includes these fixes.

### LOCKER-04 BLOCKING flip (FINAL ACT)

After all 47 route bulkfix entries are addressed (via 41.b + 41.a + downstream route updates from 41.c..g + 47-route catch-up if needed), the closing commit:
- Removes all 47 route entries from `tools/lint-prod-readiness.allowlist.txt`
- Drops `--warn-only` from `package.json` `lint:prod-readiness` script → BLOCKING
- Updates DISCIPLINE Rule 14 prose: "BLOCKING since Phase 41" replaces "WARN-only pending Phase 41 closure"
- Mirrors to CLAUDE.md

**Decision branch:** If 47-route bulkfix turns out too large to land in Phase 41 (>8h of work for any single sub-plan), the LOCKER-04 BLOCKING flip is deferred to a v2.3 phase. Phase 41 still closes — sub-plans 41.a..g are independent.

## Approach

Sub-plans 41.a..g are **independent** (different file scopes). Can ship sequentially or in parallel via gsd-executor wave logic. Each its own RED→GREEN atomic commit pair (or pair-bundled). ≥ 90/90/90/90 coverage per diff.

Sequential recommended due to: phase 32 DEFERRED test fixes touch shared schema test surface; LOCKER-04 flip requires all route allowlist drops to land first.

## Scope (out)

- New features.
- Phase 11 (Cloud Profile Refactor — v2 milestone).
- Phase 18 (LDAP SSO — v2 deferred).
- Any item not explicitly in `.planning/review/REVIEW-INDEX.md` HIGH set.

## v2.2 milestone closure criterion

After Phase 41 lands: re-run the 11-agent pre-publication review against main. Expect ≤ 5 residual HIGH + 0 CRITICAL. Anything else → milestone remains open and additional phases inserted.
