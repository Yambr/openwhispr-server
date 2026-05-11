---
phase: 5
slug: operational-endpoints
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: extracted from `05-RESEARCH.md` § "## Validation Architecture" (Nyquist matrix).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (present from Phase 0 in `packages/contract-tests/src/*`) |
| **Config file** | `vitest.config.ts` at repo root + per-package overrides |
| **Quick run command** | `pnpm --filter @openwhispr/api test -- --run` |
| **Full suite command** | `pnpm -r test --coverage && make contract-test && make e2e-test` |
| **Estimated runtime** | Quick ~30s · Full ~6–10 min (depends on testcontainers warm-up) |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter <package-touched> test -- --run` (must be < 30s).
- **After every plan wave:** `pnpm -r test --coverage && make contract-test`.
- **Before `/gsd-verify-work`:** Full suite must be green — `pnpm -r test --coverage && make contract-test && make e2e-test`. Per CLAUDE.md, E2E is **mandatory** for verification.
- **Nightly:** `make e2e-test` against live Tavily key when available (Yandex skip-gated until reference file moved into repo).
- **Max feedback latency:** 30 seconds (per-commit), 10 minutes (per-wave).

No 3 consecutive tasks may pass without an automated verify (Nyquist constraint).

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| WIRE-08 | web-search returns `{results:[{title,url,snippet}]}` via Tavily | contract | `pnpm --filter @openwhispr/contract-tests test src/web-search.test.ts` | ❌ W0 | ⬜ |
| WIRE-08 | web-search 503 when `TAVILY_API_KEY` missing | contract | same file, "missing-key" case | ❌ W0 | ⬜ |
| WIRE-08 | web-search 502 on upstream 5xx | unit | `pnpm --filter @openwhispr/api test apps/api/src/lib/web-search/__tests__/tavily.test.ts` | ❌ W0 | ⬜ |
| WIRE-08 | web-search Yandex snippet normalization | unit | `apps/api/src/lib/web-search/__tests__/yandex.test.ts` | ❌ W0 | ⬜ |
| WIRE-08 | web-search registry boots fatally on unknown `WEB_SEARCH_PROVIDER` | unit | `apps/api/src/lib/web-search/__tests__/registry.test.ts` | ❌ W0 | ⬜ |
| WIRE-08 | usage_ledger row inserted per call with `kind=web-search.<provider>` | integration | `apps/api/src/routes/__tests__/web-search.integration.test.ts` (testcontainer pg+pgbouncer) | ❌ W0 | ⬜ |
| WIRE-08 | rate-limit 30/min/user via Valkey | integration | same file + Valkey container | ❌ W0 | ⬜ |
| WIRE-08 | E2E: end-to-end via real Traefik with `TAVILY_API_KEY` | e2e | `make e2e-test` Phase 5 spec | ❌ W0 | ⬜ |
| WIRE-09 | streaming-usage idempotent on `sessionId` (200 not 409 on retry) | integration | `apps/api/src/routes/__tests__/streaming-usage.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-09 | streaming-usage logs SHA-256 + 200-char preview (`sendLogs=false`) | unit | `apps/api/src/routes/__tests__/streaming-usage.test.ts` (log-capture) | ❌ W0 | ⬜ |
| WIRE-09 | streaming-usage logs 1000-char preview when `sendLogs=true` | unit | same file | ❌ W0 | ⬜ |
| WIRE-09 | wire shape accepts 14 fields per `BACKEND_SPEC.md:377` | contract | `packages/contract-tests/src/streaming-usage.test.ts` | ❌ W0 | ⬜ |
| WIRE-10 | `/api/usage` returns `{wordsUsed, wordsRemaining:999999999, plan:"unlimited", limitReached:false}` | contract | `packages/contract-tests/src/usage.test.ts` | ❌ W0 | ⬜ |
| WIRE-10 | `wordsUsed = SUM(units)` across all kinds | integration | `apps/api/src/routes/__tests__/usage.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-11 | stt-config resolution chain user→tenant→env | unit + integration | `apps/api/src/routes/__tests__/stt-config.test.ts` | ❌ W0 | ⬜ |
| WIRE-11 | `availableProviders` computed from env at request time | unit | same file | ❌ W0 | ⬜ |
| WIRE-12 | note-recording-config defaults + override layering | unit + integration | `apps/api/src/routes/__tests__/note-recording-config.test.ts` | ❌ W0 | ⬜ |
| WIRE-16 | cloud-api-request envelope passthrough on every 4xx/5xx | contract (negative matrix) | `packages/contract-tests/src/negative-matrix.test.ts` | ❌ W0 | ⬜ |
| WIRE-22 | notes CRUD round-trip | integration | `apps/api/src/routes/notes/__tests__/crud.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-22 | notes search (tsvector) returns ranked `SearchResult` with `score` | integration | `apps/api/src/routes/notes/__tests__/search.integration.test.ts` (real PG) | ❌ W0 | ⬜ |
| WIRE-22 | notes batch-create idempotent on `client_note_id` | integration | `apps/api/src/routes/notes/__tests__/batch-create.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-22 | notes keyset list correctly paginates with `before`/`since` | integration | `apps/api/src/routes/notes/__tests__/list.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-22 | notes delete-all caps at 1000 inline | integration | `apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-22 | notes soft-delete `deleted_at` not returned in list | integration | same | ❌ W0 | ⬜ |
| WIRE-22 | notes contract conformance | contract | `packages/contract-tests/src/notes.test.ts` | ❌ W0 | ⬜ |
| WIRE-23 | folders CRUD + batch + list w/ `since` | integration + contract | `apps/api/src/routes/folders/__tests__/`, `packages/contract-tests/src/folders.test.ts` | ❌ W0 | ⬜ |
| WIRE-24 | conversations CRUD + list `include=messages` + search | integration + contract | `apps/api/src/routes/conversations/__tests__/`, contract file | ❌ W0 | ⬜ |
| WIRE-25 | conversations messages add + list keyset | integration | `apps/api/src/routes/conversations/__tests__/messages.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-26 | transcriptions CRUD + batch-create + batch-delete | integration + contract | files in `apps/api/src/routes/transcriptions/__tests__/` + `packages/contract-tests/src/transcriptions.test.ts` | ❌ W0 | ⬜ |
| WIRE-26 | transcriptions create idempotent on `client_transcription_id` | integration | same | ❌ W0 | ⬜ |
| WIRE-27 | api-keys create returns clear-text once + `{data:T}` envelope | contract | `packages/contract-tests/src/api-keys.test.ts` | ❌ W0 | ⬜ |
| WIRE-27 | api-keys list returns `key_prefix` only (no key, no hash) | contract | same | ❌ W0 | ⬜ |
| WIRE-27 | api-keys Argon2id hash format `$argon2id$v=19$m=65536` | unit | `apps/api/src/lib/__tests__/argon2-keys.test.ts` | ❌ W0 | ⬜ |
| WIRE-27 | api-keys revoke sets `revoked_at` and key cannot be verified | integration | `apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts` | ❌ W0 | ⬜ |
| WIRE-28 | `tenant_settings` + `user_settings` tables with RLS + FORCE RLS | integration (testcontainer) | `packages/data/src/__tests__/settings-rls.test.ts` | ❌ W0 | ⬜ |
| WIRE-28 | AFTER INSERT trigger seeds `tenant_settings` on tenant create | integration | same | ❌ W0 | ⬜ |
| WIRE-28 | backfill INSERT during migration touches every existing tenant | integration | `packages/data/src/__tests__/migration-0006-backfill.test.ts` | ❌ W0 | ⬜ |
| WIRE-29 | negative matrix: every route + synthetic 404 returns envelope | contract | `packages/contract-tests/src/negative-matrix.test.ts` | ❌ W0 | ⬜ |
| WIRE-29 | matrix enumeration uses `fastify.printRoutes()` not hardcoded list | unit | same | ❌ W0 | ⬜ |
| Cross-cutting | RLS isolation property test (every new table) | property (fast-check 100 pairs) | extend `packages/data/src/__tests__/rls-property.test.ts` | ✓ extend | ⬜ |
| Cross-cutting | usage-ledger idempotency property (streaming-usage + web-search) | property | `apps/api/src/routes/__tests__/ledger-idempotency.property.test.ts` | ❌ W0 | ⬜ |
| Cross-cutting | error envelope on every 4xx/5xx (covered by WIRE-29) | contract | see negative matrix | ❌ W0 | ⬜ |
| Cross-cutting | rate-limit envelope conformance | integration | `apps/api/src/routes/__tests__/web-search-ratelimit.integration.test.ts` | ❌ W0 | ⬜ |
| Cross-cutting | observability — OTel span attrs on streaming-usage rich metadata | unit (log + span capture) | `apps/api/src/routes/__tests__/streaming-usage-observability.test.ts` | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (Failing-RED First)

Per CLAUDE.md TDD discipline, Wave 0 (Plan 01) installs all failing-RED test files **before** any production code lands.

- [ ] `packages/wire-schemas/src/{notes,folders,conversations,transcriptions,api-keys,streaming-usage,web-search}.ts` — Zod schemas
- [ ] `packages/contract-tests/src/{notes,folders,conversations,transcriptions,api-keys,streaming-usage,usage,stt-config,note-recording-config,web-search,negative-matrix}.test.ts` — 11 contract test files
- [ ] `apps/api/src/routes/**/__tests__/*.test.ts` — per-route unit + integration
- [ ] `apps/api/src/lib/__tests__/{argon2-keys,keyset-pagination,soft-delete,client-id-upsert}.test.ts` — helper tests
- [ ] `apps/api/src/lib/web-search/__tests__/{tavily,yandex,registry}.test.ts` — adapter tests
- [ ] `packages/data/src/__tests__/{settings-rls,migration-0006-backfill,migration-0007..0010-rls}.test.ts` — DB-side
- [ ] Extend `packages/data/src/__tests__/rls-property.test.ts` to cover 8 new tables (fast-check 100 pairs each)
- [ ] Extend `packages/data/src/seed/conformance.ts` to seed every new resource with deterministic IDs for CONTRACT-01
- [ ] `tests/e2e/phase-05-*.spec.ts` — e2e flows: full CRUD round-trip per resource, web-search live-Tavily gating, streaming-usage idempotency under retry

**Framework install:** None needed — Vitest 4, fast-check, testcontainers, undici all present from Phases 0–4.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Yandex Search live snippet quality with mixed-language / RTL queries | WIRE-08 | Yandex AI Studio v2 docs are CAPTCHA-blocked from automated test fetch; live key issuance is per-operator | Operator sets `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID`, runs `curl -X POST /api/agent/web-search -d '{"query":"тест mixed english","numResults":3}'`, inspects normalized `snippet` field quality |

All other phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command or Wave 0 dependencies declared
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ W0` references above
- [ ] No watch-mode flags (`--watch`) in commands
- [ ] Feedback latency < 30s per-commit, < 10min per-wave
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 lands and per-task verify map is wired

**Approval:** pending
