# Phase 5: Operational Endpoints - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 05-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 05-operational-endpoints
**Areas discussed:** Web-search provider + integration; STT/note-recording config storage; streaming-usage + GET /api/usage semantics; cloud-api-request envelope guarantee; CRUD resource families (scope-expansion area surfaced during discussion)

---

## Web-Search Provider (pre-empted by user before formal AskUserQuestion)

User volunteered the decision before the question was posed:

> "Если что нам надо будет два провайдера поддержать tavily и Yandex. Ключи дам завтра"

(Same session, user then provided keys immediately: Tavily `tvly-dev-...` and Yandex `AQVNxoye...` + key id `aje6hif712hdigjus258`.)

| Option | Description | Selected |
|--------|-------------|----------|
| Tavily only | Single OSS-default provider, simplest implementation | |
| Tavily + Yandex | Two providers, RU-region + OSS-default coverage | ✓ |
| LiteLLM-routed | Route web search through LiteLLM's `web_search` tool | |
| Operator-pluggable adapter | Single env-driven adapter; one provider per deployment | |

**User's choice:** Tavily + Yandex, with registry-based adapter pattern (extensibility requirement added later in same session).

**Notes:**
- User added later in session: "учти что провайдеров потом может быть больше" → registry pattern locked, not hard-coded.
- User provided Yandex docs URL: `https://aistudio.yandex.ru/docs/ru/search-api/concepts/web-search.html`.
- User provided working Yandex reference: `/Users/dev/Downloads/server.py` (currently macOS-sandboxed).
- User flagged snippet normalization: "формат сниппеты и туда сюда нужно будет под формат омологировать релевантные части".

---

## Gray Area Multi-Select

| Option | Description | Selected |
|--------|-------------|----------|
| STT/note-recording config storage | Where per-tenant/per-user config lives; v1 mutability | ✓ |
| streaming-usage + GET /api/usage semantics | Request body shape, idempotency, kind taxonomy, aggregation window | ✓ |
| cloud-api-request envelope guarantee | Project-wide envelope invariant; 404 vs 501 | ✓ |
| Web-search integration details | Standalone endpoint; ledger logging; rate-limit; provider selection scope | ✓ |

**User's choice:** All four areas selected (plus free-text additions providing keys, Yandex docs link, and a reminder to follow the OpenWhispr client `~/openwhispr/`).

**Notes:**
- User dropped Tavily + Yandex keys directly into the answer field — keys stored ONLY in local Claude memory (`~/.claude/projects/-Users-nick-openwhispr-server/memory/project_phase5_websearch.md`), never committed to repo.
- User said: "учти что у нас в соседней папке лежит клиент опенвиспр на основе которого мы восстанавливаем Сервер" — confirmed `~/openwhispr/` is the recovery spec source.

---

## STT/Note-Recording Config Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Env-derived, read-only (rec.) | No new tables; env defaults; UI later | |
| tenant_settings JSONB + RLS | New tables; GET-only in Phase 5; mutation deferred to Phase 7 UI | ✓ |
| JSONB blob on tenants/users | Extend existing tables; ADR-discouraged identity+settings mixing | |

**User's choice (free-text):** "UI будет не пизди тебе надо будет потом для него спеку написать, и делаем все по спеке вот для приложения /Users/dev/openwhispr/"

**Notes:**
- User overrode the env-only recommendation: a UI WILL come (Phase 7 — already in ROADMAP), so persistence groundwork makes sense now.
- Direction is explicit: spec-by-the-client-app at `~/openwhispr/`. Future UI spec will follow.
- Resolved as D-17/D-18/D-19/D-20/D-21 in 05-CONTEXT.md (tenant_settings + user_settings tables, JSONB, RLS, GET-only in v1, env-fallback layered resolution).

---

## /api/usage Aggregation

| Option | Description | Selected |
|--------|-------------|----------|
| SUM(units) lifetime, all kinds (rec.) | Most intuitive; observability-not-enforcement | ✓ |
| SUM(units) last-30-days | Rolling window; closer to billing-period thinking | |
| SUM only transcribe + streaming-stt | Literal client "words" naming; excludes reason/web-search | |

**User's choice:** SUM(units) lifetime по всем kinds.

**Notes:** Locked as D-14. Resolved as D-15/D-16 for response shape and (no-)caching.

---

## cloud-api-request Envelope Guarantee

| Option | Description | Selected |
|--------|-------------|----------|
| Wildcard /api/* notFoundHandler → 404 + envelope (rec.) | Explicit handler in Phase 5 | |
| CONTRACT-01 negative matrix (rec.) | Test-only proof of invariant across all routes | ✓ |
| Structured {error:{message,code}} for web-search rate-limit/quota | New structured envelope sites | |
| Only existing global error handler — no new spec | Rely on Phase 2 envelope; no Phase 5 change | |

**User's choice (free-text):** "CONTRACT-01 negative matrix (рек.), не делай больше чем умеет приложение openwhispr и никакой оплаты не будет stripe и прочая муть выпилены"

**Notes:**
- Only CONTRACT-01 negative matrix selected — the wildcard 404 handler was not chosen, so Phase 5 relies on Phase 2's existing not-found handler (D-35).
- Structured envelope additions explicitly de-selected — Phase 5 endpoints stay on simple string envelope (D-34).
- User reinforced the OUT-OF-SCOPE rule: "не делай больше чем умеет приложение openwhispr" + Stripe/referrals/billing dropped.
- Resolved as D-33/D-34/D-35/D-36.

---

## CRUD Resource Families (scope-expansion area, surfaced after `cloud-api-request` investigation)

After grepping `~/openwhispr/src/services/*.ts`, found 20+ CRUD endpoints invoked via `cloud-api-request` that are NOT in current REQUIREMENTS.md. Posed an explicit scope question:

| Option | Description | Selected |
|--------|-------------|----------|
| Расширить Phase 5 на все CRUD endpoints клиента | Add notes/folders/conversations/transcriptions/api-keys CRUD + search + batch | ✓ |
| Оставить Phase 5 на 6 endpoints; CRUD — Phase 5.1+ или отдельные фазы | Original scope only; CRUD deferred | |
| Stub все CRUD в Phase 5 (200 OK с empty arrays) + полные позже | Wire surface only, no persistence | |

**User's choice:** Расширить Phase 5 на все CRUD endpoints клиента.

**Notes:**
- Significant scope expansion (estimated 1.5-2x original work).
- Authoritative spec for new CRUD = client TypeScript interfaces at `~/openwhispr/src/services/*.ts`.
- Resolved as D-22 through D-32; deferred mutation surface (PUT settings) and Stripe/referrals stay out.
- Triggers REQUIREMENTS.md and ROADMAP.md updates (see CONTEXT "Required pre-planning actions").

---

## Claude's Discretion

- Migration ordering and resource grouping into Drizzle migration files.
- `pg_trgm` vs `tsvector` deeper choices for richer search (D-26 punts to `tsvector + GIN` v1).
- BullMQ queueing thresholds for `notes/delete-all` long-running purges.

## Deferred Ideas

- Settings PUT endpoints (Phase 7 UI).
- Stripe + referrals (killed in v1).
- API keys auth-middleware enablement (Phase 6 candidate).
- `pg_trgm` / external search engine (Phase 6+).
- Per-locale text-search dictionaries.
- Materialized view for `/api/usage`.
- Conversations array-message batch insert.
- More web-search providers (registry-extensible).
