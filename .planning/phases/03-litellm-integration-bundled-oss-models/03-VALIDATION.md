---
phase: 03
slug: litellm-integration-bundled-oss-models
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-10
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from RESEARCH.md §10 (Validation Architecture) — to be finalized by gsd-planner during plan creation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (workspace existing) + testcontainers-postgresql for ingest worker |
| **Config file** | `vitest.config.ts` (per-package), workspace root |
| **Quick run command** | `pnpm -w test --filter <package>` |
| **Full suite command** | `pnpm -w test && make contract-test` |
| **E2E (manual / scheduled)** | `make e2e-test` (requires .env.e2e with real OPENROUTER_API_KEY + OPENAI_API_KEY + PYANNOTE_API_KEY) |
| **Estimated runtime** | ~120s unit/integration; ~90s contract-test profile (mock_response, no internet); ~5min e2e (real APIs) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -w test --filter <package>` (per-file fast)
- **After every plan wave:** Run `pnpm -w test && make contract-test`
- **Before `/gsd-verify-work`:** Full suite + contract-test must be green; e2e-test smoke against fixture providers if keys available
- **Max feedback latency:** 120s

---

## Per-Task Verification Map

> To be filled by gsd-planner per-plan during plan creation. Skeleton:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-XX | 01 spike | 0 | LITELLM-01 | — | LiteLLM container starts; /health returns 200 | integration | `pnpm -w test --filter spike-litellm` | ❌ W0 | ⬜ pending |
| 03-02-XX | 02 schema | 0 | LITELLM-07 | — | `litellm` database created idempotently | integration | `pnpm -w test --filter migrate` | ❌ W0 | ⬜ pending |
| 03-03-XX | 03 transcribe | 1 | WIRE-05 | T-03-01 (multipart upload bypass) | Bearer auth required; multipart streamed without buffering | unit+contract | `pnpm -w test apps/api/src/routes/transcribe` + `make contract-test` | ❌ W0 | ⬜ pending |
| 03-04-XX | 04 reason | 1 | WIRE-06 | T-03-02 (prompt injection via metadata) | `user: <userId>` injected; LITELLM_MASTER_KEY never leaks | unit+contract | `pnpm -w test apps/api/src/routes/reason` | ❌ W0 | ⬜ pending |
| 03-05-XX | 05 diarization | 1 | LITELLM-03 | T-03-03 (file upload abuse) | File size limit; bearer auth | unit+contract | `pnpm -w test apps/api/src/routes/diarization` | ❌ W0 | ⬜ pending |
| 03-06-XX | 06 realtime | 1 | LITELLM-03 (WSS) | T-03-04 (WS auth bypass) | bearer-auth in upgrade preHandler; master key not exposed | unit+contract | `pnpm -w test apps/api/src/routes/realtime` | ❌ W0 | ⬜ pending |
| 03-07-XX | 07 spend ingest | 2 | LITELLM-07, DATA-03 | T-03-05 (idempotency replay) | UPSERT idempotent on request_id | integration (testcontainer) | `pnpm -w test apps/worker/src/jobs/ingest-spend` | ❌ W0 | ⬜ pending |
| 03-08-XX | 08 docs | 2 | LITELLM-06 | — | docs/litellm-target-spec.md exists, references both modes | docs lint | `markdown-link-check docs/litellm-target-spec.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `compose/litellm/litellm_config.contract.yaml` — mock_response variant for CI
- [ ] `compose/litellm/litellm_config.yaml` — bundled-default config
- [ ] `compose/postgres/initdb/01-litellm-database.sh` (or migration) — idempotent CREATE DATABASE litellm
- [ ] `apps/api/src/routes/__tests__/` shared multipart fixture (small wav file)
- [ ] `apps/worker/` package skeleton OR worker entry point in apps/api (decision in plan)
- [ ] Spike test for `x-litellm-spend-logs-metadata` header → metadata column persistence (resolves RESEARCH open question A4)
- [ ] BACKEND_SPEC.md cross-reference for `wordsUsed` semantics (resolves RESEARCH open question)

*Validation framework already installed (vitest, testcontainers) — Wave 0 is fixture-creation only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real /api/transcribe with OpenAI Whisper | WIRE-05 | Costs real money + requires user-supplied key | `make e2e-test`; verify `text` field populated from real audio |
| Real /api/reason with OpenRouter qwen3.5-plus | WIRE-06 | Real API call, costs money | `make e2e-test`; verify `text` non-empty, `model="qwen3.5-plus"` |
| Real /api/diarization with pyannote.ai | LITELLM-03 | Two-step pyannote API + real cost | `make e2e-test`; verify segments[] returned |
| Realtime WSS 65-min smoke | LITELLM-03 | Long-lived test, runs in scheduled CI not main | `make e2e-realtime-soak` (deferred to Phase 4 per CONTEXT) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (litellm_config files, multipart fixture, db init, A4 spike)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (planner sets after Per-Task map filled)

**Approval:** pending — to be approved by gsd-planner after PLAN.md files created and per-task map populated
