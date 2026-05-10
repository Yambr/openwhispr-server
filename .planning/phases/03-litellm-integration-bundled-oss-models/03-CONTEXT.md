---
phase: 03
status: locked
date: 2026-05-10
mode: research-first
---

# Phase 03 — CONTEXT

## Goal

Bundle a bare-bones **LiteLLM Proxy v1.83.7-stable+** as the single AI plane in default `docker-compose.yml`. **No bundled local AI models** (no Speaches, no Ollama, no faster-whisper, no GPU images). Default config wires LiteLLM to **public API providers** via `.env` keys. Corporate operator overrides `LITELLM_BASE_URL` (+ их собственный provider config) to point at internal LiteLLM (AWS Bedrock proxy, internal vLLM, on-prem) without code changes.

Same wire surface for `/api/transcribe`, `/api/reason`, audio routes, regardless of which LiteLLM the operator runs.

## Locked Decisions

### D-01 — Bundled-default LiteLLM provider set: OpenRouter + pyannote + OpenAI Whisper

`compose/litellm/litellm_config.yaml` model_list shipped in the repo:
- LLMs (для /api/reason) → OpenRouter (`api_key: os.environ/OPENROUTER_API_KEY`)
- Transcription (для /api/transcribe) → OpenAI `whisper-1` (`api_key: os.environ/OPENAI_API_KEY`)
- Diarization (для /api/diarization) → pyannote.ai cloud via `pass_through_endpoints` (`api_key: os.environ/PYANNOTE_API_KEY`)

Если соответствующий ключ отсутствует — endpoint отвечает 503 с явным сообщением "set OPENROUTER_API_KEY in .env" (no silent failure).

**Why:** OpenRouter — десятки LLM через 1 ключ (Anthropic, OpenAI, Llama, Qwen, Mistral). OpenAI Whisper — most reliable transcription API. pyannote.ai cloud — единственный production-grade diarization SaaS.

### D-02 — Spend-log ingestion: Postgres co-tenant read

LiteLLM пишет в `LiteLLM_SpendLogs` таблицу в том же Postgres кластере (отдельная database — `litellm`). BullMQ repeatable job (`ingest-litellm-spend`, cron every 30s) читает за watermark, mirrors selected rows в `usage_ledger` с idempotent UPSERT по `request_id`. PROJECT.md preferred подход.

**Why:** Authoritative source без polling-lag и без LiteLLM API rate-limit. LiteLLM уже Postgres-bound — 2-я database в том же кластере, инфра не плодится.

### D-03 — NO virtual key minting per user. Use OpenAI-compatible `user` parameter

API использует **один LITELLM_MASTER_KEY** для аутентификации в LiteLLM. В каждом request body передаём `user: "<userId>"` (стандартный OpenAI-compatible field). LiteLLM сохраняет `end_user_id` в spend logs автоматически — мы получаем per-user attribution в `LiteLLM_SpendLogs.end_user` без mint-логики, без encrypted column, без rotation, без БД таблицы.

**Why:** Plain LiteLLM/OpenAI feature, нулевая код-логика. PROJECT.md упоминал per-user virtual keys как один из возможных подходов — `user` parameter решает ту же проблему (per-user spend attribution) проще и без storage.

**Что меняется в спецификации:**
- LITELLM-04 переинтерпретируем: вместо "mint per-user virtual key via /key/generate" → "pass `user: <userId>` in each LiteLLM request, no per-user key minting in v1"
- Никаких изменений в `users` schema (litellm_virtual_key column не добавляется)
- Никакой mint логики в Fastify handlers

### D-04 — Realtime WSS topology: Fastify wsUpstream proxy

`WSS /v1/realtime` подключение: **Traefik → Fastify (auth + LITELLM_MASTER_KEY inject + `user` query) → LiteLLM**. Используем `@fastify/http-proxy` `wsUpstream` (упомянут в PROJECT.md tech-stack §1).

**Why:** Сохраняет opaque-bearer контракт (desktop client никогда не видит LiteLLM master key). +1 hop латенси приемлемо — realtime сессии long-lived (минуты/часы), per-frame overhead negligible.

### D-05 — Contract-test двухрежимная стратегия: mocks для CI + real-keys для E2E

**Режим A (CI / `make contract-test`):** docker-compose contract-test profile поднимает LiteLLM с `compose/litellm/litellm_config.contract.yaml` где КАЖДАЯ модель имеет `mock_response: "<hardcoded JSON shape>"`. Тесты не зависят от интернета, не жгут квоты, всегда детерминированы. Native LiteLLM feature — zero custom infra.

**Режим B (E2E manual / `make e2e-test`):** оператор кладёт OPENROUTER_API_KEY + OPENAI_API_KEY + PYANNOTE_API_KEY в `.env.e2e`, тесты бьют реальные API через дефолтный `litellm_config.yaml`. User даст ключи. Запускается локально или в nightly CI scheduled job.

**Why:** CI должен быть быстрым/детерминированным — mocks. Real wire correctness против реальных провайдеров — отдельный режим, чтобы не флакать main CI.

### D-06 — Default LLM model для /api/reason: qwen3.6-plus (revised post-OpenRouter API verification)

Когда desktop client не передаёт `model` в request body, default = `qwen/qwen3.6-plus` через OpenRouter.

**Why:** User-specified, verified live via `curl https://openrouter.ai/api/v1/models` 2026-05-10. Qwen 3.6 Plus имеет 1M context, $0.33/1M prompt + $1.95/1M completion — strong reasoning + long context. Старый `qwen3.5-plus` устарел, заменён на 3.6.

## STILL TO INVESTIGATE (advisor research in plan-phase)

Следующие технические детали оставлены для advisor research в `/gsd-plan-phase 3 --research`:

- Точная схема `litellm_config.yaml` для bundled-default
- LiteLLM `LiteLLM_SpendLogs` schema и watermark стратегия для idempotent ingest
- Migration shape для создания `litellm` database (Postgres CREATE DATABASE outside transaction caveats)
- Fastify `wsUpstream` config для `/v1/realtime` с auth pre-handler
- Concrete error envelope shapes для 503 missing-API-key responses
- BullMQ job retry/backoff config для spend-ingest
- `.env.example` финальный shape (все новые переменные)

## RESEARCH-ROUND-2 LOCKED DECISIONS (post 03-RESEARCH.md, 2026-05-10)

### D-07 — Diarization через LiteLLM pass_through_endpoints (NOT Fastify-direct)

User направление: "у людей через конфиг который указан" — то есть mirror pattern из `speaches-audio.md` где LiteLLM `pass_through_endpoints` указывает на корпоративный pyannote endpoint (за nginx).

**Implication:** Bundled-default НЕ может использовать pyannote.ai cloud двухшаговый API (LiteLLM pass_through это single-hop). Вариант: использовать **pyannote-compatible single-hop endpoint** в качестве bundled-default. Кандидаты для researcher round 2:
- pyannote.audio self-hosted REST wrapper (locally not bundled per CONTEXT — operator-supplied)
- Replicate.com pyannote endpoint (single-hop, requires REPLICATE_API_TOKEN)
- HuggingFace inference endpoint (single-hop)

**Default behavior без PYANNOTE keys:** /api/diarization → 503 envelope с message "Configure DIARIZATION_API_KEY + DIARIZATION_BASE_URL or set LITELLM_BASE_URL to your corporate LiteLLM with diarization pass_through".

**Why:** Сохраняем architectural symmetry с corporate operators (которые уже имеют single-hop pyannote endpoint за их LiteLLM pass_through). Bundled-default = same pattern с public single-hop provider.

**Planner action:** spike в plan 01 — investigate какой single-hop pyannote-compatible cloud endpoint доступен. Если ни один не подходит, fall back на 503-only diarization для bundled-default + документировать что operator должен предоставить single-hop endpoint.

### D-08 — request_id propagation: Wave 0 spike (verify live)

Wave 0 task в первом plan'e: spike test — POST chat completion с `x-litellm-spend-logs-metadata: {"openwhispr_request_id":"..."}` header, query `LiteLLM_SpendLogs.metadata` column, confirm shape. Реальное поведение docs могут не отражать.

**Why:** Дешевле сейчас чем rework spend-ingest worker позже. Spike result определяет точную shape ingest job query.

### D-09 — Wire shape source-of-truth: upstream BACKEND_SPEC.md (no improvisation)

User направление: "идём строго по схеме клиента, минимальные правки в клиенте". Wave 0 task: read upstream `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` (1556 lines, mentioned в CLAUDE.md как authoritative spec), extract:
- `wordsUsed` semantics (минуты vs слова)
- Diarization mount point (`/api/diarization` vs `/v1/audio/diarization` vs both)
- Все остальные поля response shapes для `/api/transcribe`, `/api/reason`, audio routes

**Planner action:** plan 02 имеет dedicated spike задачу "extract wire contracts from BACKEND_SPEC.md → write to docs/wire-contracts-phase-3.md". Все subsequent plans бьют по этому документу as source-of-truth.

**Why:** Desktop клиент готовый и не правится без необходимости. Нельзя угадывать схему — один источник истины.

### D-10 — OpenRouter model lineup: 3 модели (revised post-API verification)

Verified live via `curl https://openrouter.ai/api/v1/models` 2026-05-10. `compose/litellm/litellm_config.yaml` `model_list` для LLMs:

| LiteLLM alias | OpenRouter model id | Pricing $/1M (in/out) | Context | Role |
|---|---|---|---|---|
| `qwen3.6-plus` (default) | `qwen/qwen3.6-plus` | $0.33 / $1.95 | 1M | Default reasoning |
| `gemini-3-flash` | `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | 1M | Cheap fast |
| `gpt-4o-mini` | `openai/gpt-4o-mini` | $0.15 / $0.60 | 128k | Cheapest |

Все через OPENROUTER_API_KEY (один ключ). Operator может расширить yaml дополнительными моделями (поддерживаются claude, gemini-pro, qwen-max и др — всё через OpenRouter).

**Why:** User-selected "minimum 3 models". qwen3.5-plus устарел, qwen/qwen3.6-plus актуальный. gemini-3.0-flash не существует на OpenRouter, ближайший stable = gemini-3.1-flash-lite. gpt-4o-mini остался корректным.

### D-11 — STT provider: Groq Whisper-large-v3 (NOT OpenAI direct)

OpenRouter не проксирует Whisper API. Используем **Groq Whisper-large-v3** напрямую (OpenAI-compatible endpoint, free tier, $0.04/hr audio в paid).

`compose/litellm/litellm_config.yaml` model_list для STT:
- `whisper-large-v3` — Groq endpoint (`api_base: https://api.groq.com/openai/v1`, `model: whisper-large-v3`), `api_key: os.environ/GROQ_API_KEY`

User должен предоставить **GROQ_API_KEY**. Без него `/api/transcribe` → 503 envelope.

**Why:** Groq быстрее и дешевле OpenAI direct, OpenAI-compatible (zero LiteLLM config quirks), free tier для smoke-тестов. Replicate медленнее (cold-start GPU). OpenAI direct требовал бы дополнительный ключ + дороже без выигрыша.

**.env.example update:** добавить `GROQ_API_KEY=` (помимо OPENROUTER_API_KEY, PYANNOTE_API_KEY, LITELLM_MASTER_KEY).

**Out of scope:** OPENAI_API_KEY больше не нужен в Phase 3 (всё через OpenRouter + Groq). Если корпоративный оператор хочет OpenAI Whisper direct — они переопределяют свой LiteLLM config (LITELLM_BASE_URL).

## Files (likely affected)

- `docker-compose.yml` — `litellm` service + new `postgres` db init для litellm database
- `compose/litellm/litellm_config.yaml` (new) — bundled-default model_list
- `compose/litellm/litellm_config.contract.yaml` (new) — mock_response variant для CI
- `apps/api/src/routes/transcribe.ts` (new) — multipart → LiteLLM `/v1/audio/transcriptions`
- `apps/api/src/routes/reason.ts` (new) — JSON → LiteLLM `/v1/chat/completions` с `user: <userId>`
- `apps/api/src/routes/diarization.ts` (new) — multipart pass-through
- `apps/api/src/routes/realtime.ts` (new) — Fastify wsUpstream proxy
- `packages/litellm-client/src/index.ts` — replace placeholder with real client (chat completions, audio transcriptions, http-proxy adapter)
- `apps/worker/` (new package или внутри apps/api) — BullMQ worker process с `ingest-litellm-spend` job
- `packages/data/migrations/0006_litellm_database.sql` (new) — `CREATE DATABASE litellm` (outside tx)
- `packages/data/migrations/0007_*.sql` — usage_ledger дополнения если нужны (probably none — schema готова)
- `docs/litellm-target-spec.md` (new) — derived from speaches-audio.md, generalized for bundled+override modes
- `docs/litellm-mock-mode.md` (new) — CI mock_response режим explained
- `.env.example` — добавить OPENROUTER_API_KEY, OPENAI_API_KEY, PYANNOTE_API_KEY, LITELLM_MASTER_KEY, LITELLM_BASE_URL (override hint), LITELLM_DATABASE_URL
- `Makefile` — добавить `make e2e-test` target
- `packages/contract-tests/src/transcribe.test.ts` (new), `reason.test.ts` (new), `diarization.test.ts` (new), `realtime.test.ts` (new)

## Out of Scope

- Bundled local AI models (Speaches, Ollama, faster-whisper containers, GPU profile) — REJECTED per user
- Per-user virtual key minting / rotation / encrypted storage — REJECTED per D-03
- Streaming NDJSON `/api/agent/stream` — Phase 4 (WIRE-07)
- WSS first-line latency benchmark — Phase 4
- Streaming-token mints (AssemblyAI/Deepgram/OpenAI Realtime tokens) — Phase 4 (WIRE-13/14/15)
- web-search tool — Phase 5
- Audit log for key issuance — DATA-04 in Phase 6

## Acceptance Gate

1. ✅ All 6 gray areas (D-01..D-06) have explicit user-locked decisions
2. ✅ CONTEXT.md saved as final (not -DRAFT)
3. Ready for `/gsd-plan-phase 3 --research`
