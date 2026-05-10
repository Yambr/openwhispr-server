---
phase: 03
slug: litellm-integration-bundled-oss-models
status: locked
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-10
updated: 2026-05-10
revision: 3-d07-revised-diarization-sync-wrapper
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Finalized by gsd-planner during plan creation (Plans 01..10).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (workspace existing) + @testcontainers/postgresql for ingest worker + @testcontainers (redis) |
| **Config file** | `vitest.config.ts` (per-package), workspace root |
| **Quick run command** | `pnpm -w test --filter <package>` |
| **Full suite command** | `pnpm -w test && make contract-test` |
| **E2E (manual / scheduled)** | `make e2e-test` (requires `.env.e2e` with real OPENROUTER_API_KEY + GROQ_API_KEY + OPENAI_API_KEY (D-12 Realtime) + PYANNOTE_API_KEY (D-07 REVISED — Fastify diarization route)) |
| **Estimated runtime** | ~120s unit/integration; ~120s contract-test profile (mock_response, no internet, includes 6 new Phase 3 tests); ~5min e2e (real APIs, including pyannote 4-step async sync-wrapper) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -w test --filter <package>` (per-file fast)
- **After every plan wave:** Run `pnpm -w test && make contract-test`
- **Before `/gsd-verify-work`:** Full suite + contract-test must be green; e2e-test smoke against fixture providers if keys available
- **Max feedback latency:** 120s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 0 | LITELLM-06 (D-09) | — | Wire-contracts doc captures upstream BACKEND_SPEC.md verbatim; no improvisation | docs lint | `pnpm exec tsx tools/lint-docs-headings.ts docs/wire-contracts-phase-3.md` | ❌ W0 | ⬜ pending |
| 03-01-T2 | 01 | 0 | LITELLM-01, LITELLM-02, LITELLM-05 (+ HIGH-1 migrate auto-create; HIGH-2 spike RESOLVED by D-07 REVISED — Option A locked, no Replicate/HF spike needed; litellm_config.yaml omits pyannote) | T-03-01-01..06 | LiteLLM v1.83.14-stable healthy; separate `litellm` DB created on BOTH fresh-init (initdb script) AND existing-volume upgrade (migrate runner auto-create — HIGH-1); bundled config parses with ≥7 models AND contains NO pyannote/pass_through_endpoints (D-07 REVISED); PYANNOTE_API_KEY forwarded to api service only, NOT litellm service | smoke + integration | `docker compose --profile default config && pnpm exec tsx -e "const y=require('yaml'); const c=y.parse(require('fs').readFileSync('compose/litellm/litellm_config.yaml','utf8')); if(c.model_list.length<7)throw 0; const s=JSON.stringify(c); if(s.includes('pyannote')||s.includes('pass_through_endpoints'))throw new Error('D-07 violation')" && pnpm --filter @openwhispr/data test packages/data/src/__tests__/migrate-litellm-db.test.ts && pnpm vitest run tests/self-tests/litellm-up.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-T1 | 02 | 0 | LITELLM-01 (CI) | T-03-02-01 | Mock contract config parses with mock_response per model | unit | `pnpm exec tsx -e "..." && docker compose --profile default --profile contract-test config` | ❌ W0 | ⬜ pending |
| 03-02-T2 | 02 | 0 | LITELLM-07 (D-08 spike) | T-03-02-02 | request_id metadata round-trip into LiteLLM_SpendLogs.metadata column | live integration | `LITELLM_BASE_URL=... pnpm vitest run apps/api/src/__tests__/litellm-spike-request-id.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-T3 | 02 | 0 | WIRE-05/06, LITELLM-03 (zod schemas) | — | Phase 3 wire schemas exported; match wire-contracts doc | unit | `pnpm --filter @openwhispr/contract-tests test packages/contract-tests/src/__tests__/schemas-phase-3.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-T4 | 02 | 0 | CLAUDE.md ≥90% (HIGH-3) | — | Per-package vitest configs author NESTED `coverage.thresholds.{lines,branches,functions,statements}=90` for apps/api, packages/litellm-client, apps/worker, packages/data | unit | `pnpm exec tsx -e "import('./apps/api/vitest.config.ts').then(m=>{const t=m.default.test.coverage.thresholds;if(t.lines!==90)throw 0})"` | ❌ W0 | ⬜ pending |
| 03-03-T1 | 03 | 1 | LITELLM-04, LITELLM-05, PROVIDER-01 | T-03-03-01..04 | litellm-client injects master key + user param + metadata; MissingProviderKeyError vs LitellmUpstreamError distinct | unit | `pnpm --filter @openwhispr/litellm-client test --run` | ❌ W0 | ⬜ pending |
| 03-03-T2 | 03 | 1 | WIRE-05/LITELLM-03 shared infra (HIGH-4) | — | @fastify/multipart registered once at buildApp (attachFieldsToBody:false, 100MB limit) — Plans 04+06 consume without re-registering, no Wave-2 collision | unit | `pnpm --filter @openwhispr/api test apps/api/src/__tests__/multipart-registered.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-T1 | 04 | 2 | WIRE-05, DATA-03, LITELLM-04 | T-03-04-01..06 | /api/transcribe streams multipart; ledger row idempotent; 503-not-401 on missing key | unit + integration | `pnpm --filter @openwhispr/api test apps/api/src/routes/transcribe.test.ts apps/api/src/lib/word-units.test.ts apps/api/src/__tests__/multipart-registered.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-T2 | 04 | 2 | WIRE-05, CONTRACT-01 | T-03-04-01..06 | Contract test against mock LiteLLM | contract | `make contract-test` | ❌ W0 | ⬜ pending |
| 03-05-T1 | 05 | 2 | WIRE-06, LITELLM-04, DATA-03 | T-03-05-01..05 | /api/reason default qwen3.6-plus; user param injected; ledger reason_tokens; 503-not-401 | unit | `pnpm --filter @openwhispr/api test apps/api/src/routes/reason.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-T2 | 05 | 2 | WIRE-06, CONTRACT-01 | T-03-05-01..05 | Contract test against mock LiteLLM | contract | `make contract-test` | ❌ W0 | ⬜ pending |
| 03-06-T1 | 06 | 2 | LITELLM-03 (diarization sync-wrapper, D-07 REVISED) | T-03-06-01..08 | pyannote-client.ts wraps pyannote.ai 4-step async API (media/input → presigned PUT → diarize → poll jobs); 4 error classes (Missing/Unavailable/Auth/BadRequest) classified correctly. Pitfall #8 honored: PyannoteAuthError → 503 (NEVER 401 to desktop). | unit | `pnpm --filter @openwhispr/api test apps/api/src/lib/__tests__/pyannote-client.test.ts --run` | ❌ W0 | ⬜ pending |
| 03-06-T2 | 06 | 2 | LITELLM-03 (idempotency) | T-03-06-03..04 | idempotency-cache.ts wraps Valkey: Stripe semantics — Idempotency-Key (or SHA-256 fallback) keyed under `diar:idem:<key>` with 24h TTL; same key + same body hash → hit (jobId reuse); same key + different hash → conflict (caller responds 409); in-flight race window handled. | unit + integration | `pnpm --filter @openwhispr/api test apps/api/src/lib/__tests__/idempotency-cache.test.ts --run` | ❌ W0 | ⬜ pending |
| 03-06-T3 | 06 | 2 | LITELLM-03 (route + contract test) | T-03-06-01..08 | Diarization route mounted at locked path; ALL 6 status codes (200/400/409/502/503/504) covered by failing-test-first. Polling 1500ms, 5min ceiling, abort-on-disconnect via AbortController. PYANNOTE_API_KEY consumed by Fastify directly (NOT LiteLLM). NO usage_ledger write (LITELLM-07 unmetered). MOCK_DIARIZATION=true short-circuit for contract-test profile. Mount path matches docs/wire-contracts-phase-3.md. | unit + contract | `pnpm --filter @openwhispr/api test apps/api/src/routes/__tests__/diarization.test.ts --run && make contract-test` | ❌ W0 | ⬜ pending |
| 03-07-T1 | 07 | 2 | LITELLM-03 (WSS), LITELLM-04 | T-03-07-01..05 | WSS proxy with auth preHandler + master-key inject + ?user query | unit | `pnpm --filter @openwhispr/api test apps/api/src/routes/realtime.test.ts` | ❌ W0 | ⬜ pending |
| 03-07-T2 | 07 | 2 | LITELLM-03 (WSS), D-12 (OpenAI Realtime upstream) | T-03-07-03..05 | Traefik 3600s timeouts on /v1/realtime; handshake test green; bundled-default upstream is OpenAI Realtime API direct (LiteLLM `gpt-realtime` mode: realtime, OPENAI_API_KEY) | contract | `docker compose --profile default config && make contract-test` | ❌ W0 | ⬜ pending |
| 03-08-T1 | 08 | 3 | LITELLM-07, SCALE-03 | T-03-08-04..06 | apps/worker package + infer-kind + pool factories tested | unit | `pnpm --filter @openwhispr/worker test --run && pnpm --filter @openwhispr/worker typecheck` | ❌ W0 | ⬜ pending |
| 03-08-T2 | 08 | 3 | LITELLM-07, DATA-03 | T-03-08-01..06 | BullMQ scheduler 30s; idempotent UPSERT; tenant resolution; SIGTERM drain | integration (testcontainers) | `pnpm --filter @openwhispr/worker test --run` | ❌ W0 | ⬜ pending |
| 03-09-T1 | 09 | 3 | LITELLM-06 | T-03-09-01..02 | docs/litellm-target-spec.md + mock-mode docs lint-clean; D-07 REVISED Diarization (Sync-Wrapper Pattern) section present with Idempotency-Key + 1500ms poll + 5min ceiling + status code matrix | docs lint | `pnpm exec tsx tools/lint-docs-headings.ts docs/litellm-target-spec.md docs/litellm-mock-mode.md && grep -q 'sync-wrapper' docs/litellm-target-spec.md && grep -q 'Idempotency-Key' docs/litellm-target-spec.md` | ❌ W0 | ⬜ pending |
| 03-09-T2 | 09 | 3 | LITELLM-05 | T-03-09-03 | make e2e-test refuses without .env.e2e or missing PYANNOTE_API_KEY (D-07 REVISED requires it for diarization sync-wrapper); README updated | unit | `make help \| grep e2e-test && grep -q 'Provider Keys' README.md && grep -q 'PYANNOTE_API_KEY' README.md` | ❌ W0 | ⬜ pending |
| 03-10-T1 | 10 | 3 | PROVIDER-01, DATA-03, CONTRACT-01 | T-03-10-01..04 | Cross-cutting: PROVIDER-01 + Pitfall #8 (503-not-401) + DATA-03 idempotency | contract + integration (testcontainers) | `pnpm --filter @openwhispr/data test packages/data/src/__tests__/usage-ledger-idempotency.test.ts && make contract-test && MISSING_KEY_TEST_MODE=1 make contract-test-missing-keys` | ❌ W0 | ⬜ pending |
| 03-10-T2 | 10 | 3 | LITELLM-05 (CI) (+ CRIT-1 step-gated secret check) | T-03-10-01..02 | nightly e2e-test job gated on secret presence via STEP-LEVEL `id: gate` env-probe (CRIT-1: GHA forbids `secrets` context in job-level `if:` — Plan 10 fixed) | yaml lint | `pnpm exec actionlint .github/workflows/ci.yml .github/workflows/nightly.yml && ! grep -E '^\s+if:\s+\$\{\{\s*secrets\.' .github/workflows/nightly.yml` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (resolved by Plans 01 + 02)

- [ ] `compose/litellm/litellm_config.yaml` — bundled-default config (Plan 01); contains NO pyannote/pass_through_endpoints (D-07 REVISED)
- [ ] `compose/litellm/litellm_config.contract.yaml` — mock_response variant (Plan 02)
- [ ] `compose/postgres/initdb/01-litellm-database.sh` — idempotent CREATE DATABASE litellm (Plan 01)
- [ ] `tests/fixtures/audio/sample-1s.wav` — multipart fixture (Plan 02)
- [ ] `tests/fixtures/audio/sample-5s.wav` — diarization E2E fixture (Plan 06 RUN_E2E mode)
- [ ] `apps/worker/` package skeleton (Plan 08, but treated as Wave 0 dep for Wave-3 worker development)
- [ ] Spike test for `x-litellm-spend-logs-metadata` header → metadata column persistence (Plan 02 Task 2 — resolves A4 / D-08)
- [ ] BACKEND_SPEC.md cross-reference for `wordsUsed` semantics + diarization mount point (Plan 01 Task 1 — resolves A5/A6 + D-09)
- [ ] `docs/wire-contracts-phase-3.md` (Plan 01 — single source of truth for endpoint plans)
- [ ] `packages/contract-tests/src/schemas.ts` extension with TranscribeRequestFields/Response, ReasonRequest/Response, DiarizationResponse (Plan 02 Task 3)

*Validation framework already installed (vitest, testcontainers) — Wave 0 is fixture + spike + schemas only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real /api/transcribe with Groq Whisper-large-v3 (D-11) | WIRE-05 | Costs real money + requires user-supplied GROQ_API_KEY | `make e2e-test`; verify `text` field populated from real audio |
| Real /api/reason with OpenRouter qwen3.6-plus | WIRE-06 | Real API call, costs money | `make e2e-test`; verify `text` non-empty, `model="qwen3.6-plus"` |
| Real /v1/audio/diarization with pyannote.ai cloud (D-07 REVISED — Fastify sync-wrapper) | LITELLM-03 | Real cost; exercises full 4-step async orchestration + idempotency cache + poll loop | `make e2e-test` with RUN_E2E=true; uses sample-5s.wav; assert 200 + duration > 0 + segments[].length > 0 within 5min ceiling |
| Realtime WSS 65-min smoke against OpenAI Realtime API direct (D-12) | LITELLM-03 | Long-lived test + costs real OPENAI_API_KEY money ($0.06/min in + $0.24/min out for `gpt-realtime`); Phase 4 scope | DEFERRED to Phase 4 per CONTEXT; bundled-default upstream confirmed live 2026-05-10 (14 OpenAI realtime models accessible) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (litellm_config files, multipart fixtures, db init, A4 spike, schemas, wire-contracts doc)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (excluding e2e and 65-min Phase 4 deferral)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved by gsd-planner 2026-05-10 — every task has an automated verify command; cross-cutting tests in Plan 10 catch contract/idempotency drift.

**Revision 3 (2026-05-10) — D-07 REVISED diarization sync-wrapper:**
- CONTEXT.md: D-07 REVISED — diarization is Fastify sync-wrapper over pyannote.ai 4-step async API, NOT via LiteLLM
- Plan 06: rewritten end-to-end. Three tasks now: T1 pyannote-client.ts, T2 idempotency-cache.ts, T3 route + tests + contract test. All 6 status codes (200/400/409/502/503/504) covered by failing-test-first. Stripe-style idempotency in Valkey (24h TTL). 1.5s poll, 5min ceiling, abort-on-disconnect.
- Plan 01: removed pyannote `pass_through_endpoints` from litellm_config.yaml; HIGH-2 spike (Replicate/HF) RESOLVED by D-07 REVISED → no spike needed; PYANNOTE_API_KEY documented as Fastify-route-consumed and explicitly NOT forwarded to litellm container env; YAML now contains a leading comment block stating diarization is owned by Fastify
- Plan 09: docs/litellm-target-spec.md "Diarization" renamed to "Diarization (Sync-Wrapper Pattern)" with full implementation contract + status code matrix + corporate-override extension note; docs/litellm-mock-mode.md "Diarization Mock" section explains MOCK_DIARIZATION=true (since LiteLLM mock_response no longer applies)
- Plan 09 Makefile: e2e-test target now requires PYANNOTE_API_KEY in .env.e2e
- VALIDATION.md: 03-06 split T1 (pyannote-client) + T2 (idempotency-cache) + T3 (route+contract); 03-01-T2 verify command extended to assert NO pyannote in litellm_config.yaml; 03-09-T1 verify command greps for "sync-wrapper" + "Idempotency-Key"; 03-09-T2 verify greps for PYANNOTE_API_KEY in README

**Revision 2 (2026-05-10) — D-12 sync (OpenAI Realtime API direct as bundled-default Realtime upstream):**
- CONTEXT.md: D-12 added (OpenAI Realtime direct, verified live, OPENAI_API_KEY required)
- Plan 01: model_list adds `gpt-realtime` / `gpt-realtime-mini` / `gpt-4o-realtime-preview` with `mode: realtime`; .env.example + litellm service env include OPENAI_API_KEY; model_list count threshold raised 4→7
- Plan 02: contract config mirrors D-12 entries; mock_response check exempts `mode: realtime` rows (LiteLLM does not honor mock_response for WSS)
- Plan 07: must_haves + objective + STRIDE + success_criteria reference D-12; downstream upstream is OpenAI direct
- Plan 09: docs/litellm-target-spec.md + README provider keys section include OPENAI_API_KEY (D-12)
- Plan 10: nightly e2e job writes OPENAI_API_KEY to .env.e2e

**Revision 1 (2026-05-10) — applied checker feedback:**
- CRIT-1: Plan 10 Task 2 GHA job-level `if: ${{ secrets.* }}` replaced with step-level env-probe gate
- HIGH-1: Plan 01 Task 2 + Plan 09 — migrate runner auto-creates `litellm` DB on every up (idempotent); `make clean-stack` workaround language removed from Plan 09 docs
- HIGH-2: Plan 01 Task 2 step 3 — diarization spike (Replicate/HF) — SUPERSEDED in Revision 3 by D-07 REVISED (Option A locked)
- HIGH-3: Plan 02 added Task 4 — per-package vitest configs author NESTED `coverage.thresholds.{lines,branches,functions,statements}=90` for apps/api, packages/litellm-client, apps/worker, packages/data; Plans 03-08 `<done>` blocks reference verifiable `pnpm --filter <pkg> test --coverage` gate
- HIGH-4: `@fastify/multipart` registration moved from Plan 04 (Wave 2) into a new Plan 03 Task 2 (Wave 1, single sibling) — eliminates Wave-2 cross-plan edit collision with Plan 06
- MEDIUM-3 (incidental): Plan 10 files_modified now includes `Makefile` + `.github/workflows/nightly.yml`
