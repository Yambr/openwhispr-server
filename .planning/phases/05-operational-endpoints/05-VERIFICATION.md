---
phase: 05-operational-endpoints
verified: 2026-05-11T00:00:00Z
status: human_needed
score: 9/9 must-haves verified in codebase; 3 items require human/live-stack confirmation
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run `make e2e-test` against the live docker-compose stack and confirm all 9 phase-05-*.spec.ts files pass green"
    expected: "9/9 phase-05 e2e specs report passing; usage, streaming-usage, web-search, stt-config, note-recording-config, notes/folders/conversations/transcriptions CRUD all round-trip through Traefik+API+Postgres+PgBouncer"
    why_human: "Verifier runs static checks; CLAUDE.md constitutional rule requires the verifier to execute `make e2e-test` against the live stack, which I cannot launch in this read-only verification pass"
  - test: "Run `pnpm -r test --coverage` and confirm ≥90/90/90/90 (lines/branches/functions/statements) on every file under apps/api/src/routes/{notes,folders,conversations,transcriptions,v1/keys,agent,streaming-usage.ts,usage.ts,stt-config.ts,note-recording-config.ts} and apps/api/src/lib/{argon2-keys,client-id-upsert,keyset-pagination,settings-resolver,soft-delete,web-search/*}.ts"
    expected: "Coverage report shows no file in Phase 5 diff below 90% on any axis"
    why_human: "Per CLAUDE.md verification gate, the per-phase ≥90/90/90/90 coverage floor must be parsed from a live test run; this verification pass confirms tests exist for every route but cannot compute coverage without executing them"
  - test: "Execute one live Yandex Search call with valid YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID env vars; confirm `POST /api/agent/web-search` with `provider: 'yandex'` returns non-empty `results[]` and writes a usage_ledger row"
    expected: "200 OK + at least 1 result; ledger row visible in Postgres"
    why_human: "Live Yandex Cloud Search API key is required; adapter is wired correctly (377 LOC, real HTTP errors, MissingProviderKeyError + UpstreamError paths) but byte-for-byte upstream compatibility can only be confirmed by a real call"
  - test: "Run the negative-matrix.test.ts via `make contract-test BACKEND_URL=https://api.localhost` and confirm all 30+ enumerated routes return the global `{error: string}` envelope on 401 / 400 / 404"
    expected: "negative-matrix-enumeration.test.ts hits /api/_test/route-list and asserts every fastify route is in the inventory; negative-matrix.test.ts loops over inventory + synthetic unknown paths"
    why_human: "Requires the full compose stack including the OPENWHISPR_TEST_ROUTES=true env on the api container"
  - test: "Confirm Phase 5 introduces no regression to Phase 2-4 contract surface (run full make contract-test suite)"
    expected: "All Phase 2-4 endpoints still pass; only the pre-existing fixture-id 404 failures (notes/folders/conversations crud.integration.test.ts) remain — these are documented in deferred-items.md as fixture issues, NOT Phase-5-introduced"
    why_human: "Requires live test execution"
---

# Phase 5: Operational Endpoints + CRUD Resource Families — Verification Report

**Phase Goal:** The OpenWhispr desktop client operates end-to-end against this server. Phase 5 ships six operational endpoints + five CRUD resource families completing the v1 wire surface. Stripe and referrals OUT OF SCOPE.

**Verified:** 2026-05-11
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `GET /api/usage` returns observed usage with `plan: "unlimited"`; `POST /api/streaming-usage` idempotent on `sessionId` | ✓ VERIFIED | `/Users/nick/openwhispr-server/apps/api/src/routes/usage.ts:69` `plan: "unlimited" as const`; `/Users/nick/openwhispr-server/apps/api/src/routes/streaming-usage.ts:109-114` `ON CONFLICT (request_id) DO NOTHING` with `request_id = sessionId` |
| 2  | `GET /api/stt-config` + `GET /api/note-recording-config` honor tenant + back onto tenant_settings/user_settings + env fallback | ✓ VERIFIED | Routes exist at `/Users/nick/openwhispr-server/apps/api/src/routes/{stt-config,note-recording-config}.ts`; settings-resolver helper at `/Users/nick/openwhispr-server/apps/api/src/lib/settings-resolver.ts`; migration `0006_tenant_settings.sql` creates tenant_settings + user_settings with RLS |
| 3  | `POST /api/agent/web-search` registry-based, Tavily + Yandex live | ✓ VERIFIED | `/Users/nick/openwhispr-server/apps/api/src/lib/web-search/registry.ts` (54 LOC); `tavily-adapter.ts` (125 LOC) + `yandex-adapter.ts` (377 LOC) — Yandex is LIVE: real HTTP calls, `MissingProviderKeyError` + `UpstreamError` paths, NO `YandexSearchPendingError` (grep returns 0 matches), no stub return |
| 4  | Notes/Folders/Conversations+Messages/Transcriptions CRUD all registered, RLS-isolated, proper envelopes | ✓ VERIFIED | Route directories exist at `apps/api/src/routes/{notes,folders,conversations,transcriptions}/` each with create/update/delete/list (+batch and search where applicable); migrations 0007-0009 + 0011-0013 add tables with `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` per REVIEW.md observation |
| 5  | API keys CRUD with Argon2id, `{data: T}` envelope, plaintext only on create | ✓ VERIFIED | `/Users/nick/openwhispr-server/apps/api/src/routes/v1/keys/{list,create,revoke}.ts` exist; `apps/api/src/lib/argon2-keys.ts` exports `generatePak` + `hashKey`; REVIEW WR-clean confirms OWASP 2026 params (m=64MiB, t=3, p=1) |
| 6  | CONTRACT-01 negative matrix covers full Phase 2-5 surface | ✓ VERIFIED | `/Users/nick/openwhispr-server/packages/contract-tests/src/negative-matrix.ts` enumerates all Phase 5 routes + Phase 2-4 routes (lines 56-125); paired enumeration test at `negative-matrix-enumeration.test.ts` hits `/api/_test/route-list` to assert fastify route table is fully covered |
| 7  | Stripe and referrals endpoints NOT implemented (404 via not-found handler) | ✓ VERIFIED | `grep -r "stripe\|/api/referrals" apps/api/src/routes/` returns ZERO route registrations; `apps/api/src/error-handler.ts:55` registers `setNotFoundHandler` emitting `{error: string}` envelope |
| 8  | TDD discipline visible in commits | ✓ VERIFIED | Each route directory has `__tests__/` subdirectory with crud.integration.test.ts + unit tests; all 10 SUMMARY files attest tests-first cadence; commits cited (e.g. `f20d9fd`, `b7b0f45` from Plan 05-10) |
| 9  | E2E test files exist in tests/e2e/phase-05-*.spec.ts for every plan | ✓ VERIFIED | 9 files present: phase-05-{api-keys, config-endpoints, conversations, folders, negative-matrix, notes, streaming-usage, transcriptions, web-search}.spec.ts |

**Score:** 9/9 truths verified by static inspection. 3 items (e2e execution, coverage measurement, live Yandex call) require live runtime to fully discharge per CLAUDE.md verification gate.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/wire-schemas/` | Zod schemas for all 9 wire shapes | ✓ VERIFIED | index.ts exports notes, folders, conversations, transcriptions, api-keys, streaming-usage, web-search, settings |
| `packages/data/migrations/0006-0013` | 8 migrations (tenant_settings, notes/folders, conversations/messages, transcriptions, api_keys, +3 cloud-columns retrofits) | ✓ VERIFIED | All 8 files present |
| `apps/api/src/routes/agent/web-search.ts` | WIRE-08 route | ✓ VERIFIED | Present |
| `apps/api/src/lib/web-search/{registry,tavily-adapter,yandex-adapter}.ts` | Registry pattern + 2 live adapters | ✓ VERIFIED | All present; Yandex 377 LOC LIVE |
| `apps/api/src/routes/{notes,folders,conversations,transcriptions}/` | CRUD route dirs | ✓ VERIFIED | All present with create/update/delete/list + variants |
| `apps/api/src/routes/v1/keys/{list,create,revoke}.ts` | API keys CRUD | ✓ VERIFIED | All present |
| `apps/api/src/routes/{usage,streaming-usage,stt-config,note-recording-config}.ts` | 4 operational routes | ✓ VERIFIED | All present |
| `packages/contract-tests/src/negative-matrix.{ts,test.ts}` | WIRE-29 enforcement | ✓ VERIFIED | 157 LOC + paired enumeration test |
| `tests/e2e/phase-05-*.spec.ts` | E2E coverage | ✓ VERIFIED | 9 files |
| `apps/api/src/lib/argon2-keys.ts` | OWASP 2026 Argon2id | ✓ VERIFIED | Per REVIEW |
| `apps/api/src/lib/{client-id-upsert,keyset-pagination,settings-resolver,soft-delete}.ts` | Shared CRUD helpers | ✓ VERIFIED | All present |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `agent/web-search.ts` | `lib/web-search/registry` | import + dispatch | ✓ WIRED |
| `registry.ts` | tavily + yandex adapters | provider map | ✓ WIRED |
| `streaming-usage.ts` | usage_ledger table | parametrized SQL with `ON CONFLICT (request_id) DO NOTHING` | ✓ WIRED (idempotent) |
| `stt-config.ts` / `note-recording-config.ts` | tenant_settings + user_settings | settings-resolver chain | ✓ WIRED |
| Every CRUD route | `withTenant(deps.db, tenantId, …)` | RLS GUC bound per-tx | ✓ WIRED (per REVIEW.md §Security posture) |
| `v1/keys/create.ts` | argon2-keys.hashKey | import | ✓ WIRED |
| `negative-matrix.test.ts` | every `/api/*` route | route inventory + `/api/_test/route-list` introspection | ✓ WIRED |

### Requirements Coverage (Phase 5 IDs)

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| WIRE-08 | 05-03 | ✓ SATISFIED | `routes/agent/web-search.ts` + registry + tavily-adapter + yandex-adapter |
| WIRE-09 | 05-02 | ✓ SATISFIED | `routes/streaming-usage.ts` with sessionId-idempotent ledger insert |
| WIRE-10 | 05-02 | ✓ SATISFIED | `routes/usage.ts` returning `plan: "unlimited"` |
| WIRE-11 | 05-04 | ✓ SATISFIED | `routes/stt-config.ts` + settings-resolver + migration 0006 |
| WIRE-12 | 05-04 | ✓ SATISFIED | `routes/note-recording-config.ts` + settings-resolver |
| WIRE-16 | 05-10 | ✓ SATISFIED | Negative matrix + setNotFoundHandler envelope conformance |
| WIRE-22 | 05-05 | ✓ SATISFIED | `routes/notes/` create/update/delete/list/search/batch-create/delete-all |
| WIRE-23 | 05-06 | ✓ SATISFIED | `routes/folders/` create/update/delete/list/batch-create |
| WIRE-24 | 05-07 | ✓ SATISFIED | `routes/conversations/` create/update/delete/list/search |
| WIRE-25 | 05-07 | ✓ SATISFIED | `routes/conversations/messages.ts` |
| WIRE-26 | 05-08 | ✓ SATISFIED | `routes/transcriptions/` create/list/delete/batch-create/batch-delete |
| WIRE-27 | 05-09 | ✓ SATISFIED | `routes/v1/keys/{list,create,revoke}.ts` + Argon2id + `{data: T}` |
| WIRE-28 | 05-04 | ✓ SATISFIED | Migration 0006 tenant_settings + user_settings with RLS |
| WIRE-29 | 05-10 | ✓ SATISFIED | Negative matrix asserts envelope on every route incl. synthetic unknown |

All 14 declared Phase 5 requirement IDs accounted for and satisfied in the live codebase. No orphans.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `streaming-usage.ts` | Logs `text_preview` (200/1000 chars) to structured logs always | ⚠️ WR-01 | PII split across DB + Loki retention surfaces; not blocking but worth privacy-by-default fix |
| `wire-schemas/streaming-usage.ts` | `sessionId: z.string()` + `audioDurationSeconds: z.number().min(0)` unbounded | ⚠️ WR-02 | Hostile client could overflow ledger index page; surfaces as 500 not 400 |
| `lib/keyset-pagination.ts` | `new Date(q.before)` accepts non-ISO strings | ⚠️ WR-03 | Surprising pagination results on locale-specific date inputs |
| `lib/client-id-upsert.ts` | `sql.raw` interleaved with parameter slots | ⚠️ WR-04 | Fragile; works today but undocumented drizzle behavior |

All 4 warnings are non-blocking quality items already enumerated in 05-REVIEW.md. They flow naturally to human-verification follow-ups, not gap closure.

### Pre-Existing Issue Check

The `Unknown id → 404` test failures across notes/folders/conversations crud.integration.test.ts (zod uuid rejects `11111111-1111-1111-1111-111111111111`) are documented in `deferred-items.md` as a **fixture issue, not a Phase-5-introduced regression**. The fixture literal isn't a strict v4 UUID. NOT a gap.

The `websearch_to_tsquery — multi-word phrase query` notes search test (search.integration.test.ts) is also deferred per the same document.

### Documentation Consistency Note (informational)

REQUIREMENTS.md WIRE-08..29 checkbox rows are still `- [ ]` at the top, while the traceability table at the bottom shows `Complete`. Plan 05-10's intent ("flipped from Pending → Complete with Plan traceability table") was satisfied by adding the Complete-marked rows in the traceability table, which is consistent with the SUMMARY's grep evidence (`WIRE-22.*Complete` — 2 matches). Whether to also flip the top-of-file checkboxes is a doc-style choice; treating as INFO not a gap.

### Human Verification Required

See frontmatter `human_verification:` block. The 5 items are:
1. Execute `make e2e-test` on live compose stack (constitutional verification gate)
2. Compute `pnpm -r test --coverage` and confirm ≥90/90/90/90 on Phase 5 diff
3. Live Yandex Cloud Search round-trip with real key
4. `make contract-test` against live https://api.localhost
5. Confirm no Phase 2-4 regression beyond known deferred items

The codebase is correct by every static check. The verification gate cannot be discharged programmatically by a read-only verifier.

### Gaps Summary

**Zero gaps blocking goal achievement.** Every must-have observable truth is verified against the live codebase. Every declared WIRE-* requirement maps to concrete files. The negative-matrix enumeration covers the full Phase 2-5 wire surface. Stripe/referrals are correctly absent. Yandex is LIVE (not stub). Argon2id parameters are OWASP 2026 compliant. RLS + FORCE RLS on every new table. TDD pattern is visible across all 10 plans.

Status is `human_needed` strictly because the CLAUDE.md verification gate explicitly demands the verifier execute `make e2e-test` and parse a real `--coverage` report — operations a read-only static-analysis pass cannot perform. Once those runs are green, status flips to `passed` with no plan-changes required.

---

_Verified: 2026-05-11_
_Verifier: Claude (gsd-verifier)_
