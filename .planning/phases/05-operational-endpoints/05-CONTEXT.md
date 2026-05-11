# Phase 5: Operational Endpoints - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Scope status:** EXPANDED beyond original ROADMAP.md/REQUIREMENTS.md — user-confirmed during discussion. ROADMAP.md and REQUIREMENTS.md MUST be updated before /gsd-plan-phase 5 runs.

<domain>
## Phase Boundary

Phase 5 completes the v1 wire surface the OpenWhispr desktop client needs to operate end-to-end against this self-hosted server. It delivers:

**Originally scoped (REQUIREMENTS.md WIRE-08..16):**
1. `POST /api/agent/web-search` — server-side web-search tool for the agent (multi-provider: Tavily + Yandex, registry pluggable for future providers)
2. `POST /api/streaming-usage` — accept-and-record streaming-session usage (idempotent on `sessionId`)
3. `GET /api/usage` — observed usage stats (v1 always reports `plan: "unlimited"`)
4. `GET /api/stt-config` — server-side STT configuration (tenant-scoped, env-derived defaults, mutable in future UI phase)
5. `GET /api/note-recording-config` — note-recording policy configuration (tenant-scoped, same model as stt-config)
6. `cloud-api-request` envelope guarantee — CONTRACT-01 negative-matrix proving every implemented route AND synthetic unknown paths emit a compliant `{error: ...}` envelope on non-2xx

**Scope-expansion locked in this discussion (NOT in original REQUIREMENTS.md WIRE table — to be added):**
The OpenWhispr desktop client (authoritative reference: `~/openwhispr/src/services/*.ts`) calls **5 full CRUD resource families** via the `cloud-api-request` passthrough channel — these are functionally required for the client to operate, even though the upstream `BACKEND_SPEC.md` does not pin their wire shape byte-for-byte. User direction (2026-05-11): "Расширить Phase 5 на все CRUD endpoints клиента".

7. **Notes CRUD + list + search + batch-create** — `POST /api/notes/create`, `POST /api/notes/batch-create`, `PATCH /api/notes/update`, `DELETE /api/notes/delete`, `DELETE /api/notes/delete-all`, `GET /api/notes/list` (paginated by `limit`/`before`/`since`), `POST /api/notes/search` (full-text)
8. **Folders CRUD + list + batch-create** — `POST /api/folders/create`, `POST /api/folders/batch-create`, `PATCH /api/folders/update`, `DELETE /api/folders/delete`, `GET /api/folders/list`
9. **Conversations CRUD + list + search + messages** — `POST /api/conversations/create`, `PATCH /api/conversations/update`, `DELETE /api/conversations/delete`, `GET /api/conversations/list` (with `include=messages` join), `POST /api/conversations/search`, `POST /api/conversations/messages` (add message), `GET /api/conversations/messages?conversation_id=...` (list messages)
10. **Transcriptions CRUD + list + batch** — `POST /api/transcriptions/create`, `POST /api/transcriptions/batch-create`, `GET /api/transcriptions/list`, `DELETE /api/transcriptions/delete`, `POST /api/transcriptions/batch-delete`
11. **API Keys** — `GET /api/v1/keys/list`, `POST /api/v1/keys/create` (note: `{data: T}` envelope-wrapped responses — different convention from rest of API)

**Explicitly OUT OF SCOPE (user-confirmed 2026-05-11):**
- `/api/stripe/*` — Stripe lifecycle endpoints. No billing in v1. User: "никакого Stripe / прочая муть выпилены".
- `/api/referrals/*` — referrals lifecycle. Same reason.
- `plan` enforcement / quotas — `plan` field is hard-coded `"unlimited"`, `limitReached` always `false` in v1.

**Hard scope guardrail:** Implement only what the OpenWhispr client at `~/openwhispr/` actually calls. User: "не делай больше чем умеет приложение openwhispr". No speculative endpoints, no Stripe shims, no quota engine.

</domain>

<decisions>
## Implementation Decisions

### Web-Search Endpoint (`POST /api/agent/web-search`)

- **D-01: Multi-provider registry.** A `WebSearchProvider` interface (`{name: string; isConfigured(): boolean; search(query, numResults?): Promise<{results: Array<{title, url, snippet}>}>}`) with a `Map<string, WebSearchProvider>` registry. v1 ships TWO concrete adapters — **Tavily** and **Yandex Search** — and the registry is designed so adding a 3rd/4th provider later is a single new adapter file + env-flag entry, no route changes. User direction: "учти что провайдеров потом может быть больше" (2026-05-11).

- **D-02: Provider selection.** `WEB_SEARCH_PROVIDER` env (default: `tavily`). Selection is **per-deployment**, not per-request — the desktop client does not pass a provider preference in the current wire contract. Unknown provider name → fatal at boot (refuse-to-start, mirrors Phase 1 no-default-secrets discipline).

- **D-03: Tavily adapter.** `POST https://api.tavily.com/search` with body `{api_key: TAVILY_API_KEY, query, max_results: numResults ?? 5}`. Native response `{results: [{title, url, content, score, ...}]}` — normalize: map `content` → `snippet`, drop `score` and other non-spec fields. (Researcher: confirm current Tavily API shape against 2026 docs.)

- **D-04: Yandex Search adapter.** Per `https://aistudio.yandex.ru/docs/ru/search-api/concepts/web-search.html`. Yandex AI Studio Search API requires `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` (Yandex Cloud convention). User provided a working Python reference at `/Users/nick/Downloads/server.py` — **CRITICAL: that file is currently macOS-Downloads-sandboxed and cannot be read by the toolchain**. Researcher MUST ask the user to move it into the repo (suggest `tools/reference/yandex-search-server.py`) before planning starts. Response normalization: Yandex returns `headline` + `passages`/`extract` per result — pick the most snippet-equivalent field per docs, normalize to `snippet`. User flagged this explicitly: "формат сниппеты и туда сюда нужно будет под формат омологировать релевантные части".

- **D-05: Request body matches client.** Client wire contract (`~/openwhispr/docs/BACKEND_SPEC.md:345-373`): `{query: string, numResults?: number}` where `numResults` defaults client-side to 5. Server MUST accept `numResults` (not `maxResults`, not `max_results`). Server caps at 10 to bound provider cost.

- **D-06: usage_ledger row per call.** Insert `(tenant_id, user_id, request_id = Fastify req.id, kind = "web-search.<provider>", units = 1)`. `request_id` server-generated so retry-on-network-blip still works (each retry = new ledger row — different from `/api/streaming-usage` which uses client-supplied `sessionId`).

- **D-07: Rate limit 30/min/user.** `@fastify/rate-limit` keyed on Better Auth `session.userId` via Valkey store (Phase 4 D-19 pattern). Standard global rate-limit envelope per Phase 2 D-* (`{error: "Too many requests"}` + `Retry-After` header).

- **D-08: Error posture.** Missing API key → `503 {"error":"<Provider> not configured (set <ENV_VAR> in .env)"}` (Phase 4 D-18 pattern, no `Retry-After`). Upstream timeout/5xx → `502 {"error":"web-search upstream failed"}` (we contacted upstream — it failed; distinct from 503-no-config). 3s connect / 5s total timeout via `undici` per Phase 4 D-20.

### Streaming-Usage Endpoint (`POST /api/streaming-usage`)

- **D-09: Wire contract pinned by client.** Request body shape (from `~/openwhispr/docs/BACKEND_SPEC.md:377-412`): `{text, audioDurationSeconds, sessionId, clientType, appVersion, clientVersion, sttProvider, sttModel, sttProcessingMs, sttLanguage, audioSizeBytes, audioFormat, clientTotalMs, sendLogs}`. Accept all 14 fields; only `sessionId` and `audioDurationSeconds` are persistence-critical. The rest are observability metadata.

- **D-10: Idempotency key = client-supplied `sessionId`.** Map to `usage_ledger.request_id`. `kind = "streaming-stt"`. `units = Math.round(audioDurationSeconds)`. Duplicate `sessionId` → **200 OK with the existing ledger row's response shape** (NOT 409) — the client retries on network blips and must be safe to retry. Implementation: `INSERT … ON CONFLICT (request_id) DO NOTHING RETURNING *` + a `SELECT` fallback when nothing was returned. (Same pattern as Phase 3 transcribe ledger.)

- **D-11: Observability metadata to OTel + Loki, not Postgres.** The rich non-persistence-critical fields (`sttProvider`, `sttModel`, `sttLanguage`, `audioSizeBytes`, `audioFormat`, `sttProcessingMs`, `clientTotalMs`, `clientType`, `appVersion`, `clientVersion`, `text` (truncated to 200 chars in logs — never full transcript)) attach as OTel span attributes and structured log fields. Keeps `usage_ledger` schema stable; rich attributes queryable in Grafana/Loki without migrations.

- **D-12: Response shape pinned by client.** `{wordsUsed, wordsRemaining, plan, limitReached}` — identical to `/api/transcribe` and `/api/usage`. Compute the same numbers via the `/api/usage` aggregator (D-13) on every `/api/streaming-usage` call. `plan: "unlimited"`, `limitReached: false`, `wordsRemaining: 999999999` always in v1 (no enforcement).

- **D-13: `text.length` policy.** The client sends the final transcript `text`. Persist a SHA-256 hash + length + truncated 200-char preview to OTel logs for diagnostics. **Never** persist the full transcript in `usage_ledger` (PII isolation; transcripts belong in `transcriptions` resource D-23+). `sendLogs: false` is the v1 default — when `sendLogs: true`, allow longer log preview (1000 chars) for opt-in diagnostics.

### Usage Endpoint (`GET /api/usage`)

- **D-14: Aggregation = SUM(units) lifetime, all kinds.** `SELECT SUM(units) FROM usage_ledger WHERE user_id = current_user` (RLS already filters tenant). All `kind` values count (`transcribe`, `reason`, `streaming-stt`, `web-search.<provider>`, future kinds). User-confirmed 2026-05-11. Not last-30-days, not billing-period — there's no billing.

- **D-15: Response shape pinned by client.** `{wordsUsed: <number>, wordsRemaining: 999999999, plan: "unlimited", limitReached: false}`. `wordsRemaining` is a hard-coded large finite number (not `Infinity`, not `null`) — JSON-safe and clients reading the field as `number` won't break. `plan` is the literal string `"unlimited"`. `limitReached` is `false` always.

- **D-16: Cache strategy.** No cache in v1 — single COUNT(*) over the ledger is cheap (indexed on `tenant_id`, partition by user later). Phase 6 observability work may add a materialized view if real load shows pressure; not needed in Phase 5.

### STT-Config & Note-Recording-Config Endpoints

- **D-17: Storage = `tenant_settings` + `user_settings` tables, JSONB, RLS-enforced.** Per user direction "UI будет ... делаем все по спеке" (2026-05-11): a UI WILL eventually edit these (Phase 7 frontend), so Phase 5 lays the persistence groundwork rather than env-only. Two tables:
  - `tenant_settings(tenant_id PK FK → tenants, stt_config JSONB, note_recording_config JSONB, created_at, updated_at)` — one row per tenant, RLS via `app.tenant_id`.
  - `user_settings(user_id PK FK → users, tenant_id FK, stt_overrides JSONB, note_recording_overrides JSONB, created_at, updated_at)` — optional per-user overrides; RLS via `app.tenant_id`.
  - Phase 5 ships READ paths (GET) only. Mutations (PUT/PATCH) deferred to Phase 7 with the UI-SPEC. Tables are created in Phase 5 to lock the contract — Phase 7 doesn't need a migration to ship the UI.

- **D-18: Resolution order.** Per request: (1) `user_settings.stt_overrides`/`note_recording_overrides` if row exists, (2) fall back to `tenant_settings.stt_config`/`note_recording_config`, (3) fall back to **env-derived defaults** (`STT_DEFAULT_MODEL` / `STT_DEFAULT_LANGUAGE` / `NOTE_RECORDING_*`). Final response shape merges layers with user overrides winning.

- **D-19: `stt-config` response shape pinned by client.** Per `~/openwhispr/docs/BACKEND_SPEC.md:438-456`: `{defaultModel: string, defaultLanguage: string, availableProviders: string[]}`. `availableProviders` is **computed** at request time from which provider env keys are set on the server (e.g., `["openai", "groq"]` when `OPENAI_API_KEY` and `GROQ_API_KEY` exist) — NOT a settings-table field. Defaults: `defaultModel = "whisper-1"`, `defaultLanguage = "auto"`.

- **D-20: `note-recording-config` response shape pinned by client.** Per `~/openwhispr/docs/BACKEND_SPEC.md:460-478`: client treats body opaquely; example is `{}`. v1 ships an explicit minimum-viable shape `{maxDurationSeconds: number, sampleRateHz: number, allowedFormats: string[], diarizationEnabled: boolean}` derived from env + settings table — even though the client doesn't yet read named fields, Phase 7 UI will. Defaults: `maxDurationSeconds: 7200`, `sampleRateHz: 16000`, `allowedFormats: ["webm","ogg","wav","m4a"]`, `diarizationEnabled: true` (Phase 3 already wired diarization).

- **D-21: Bootstrap.** On first migration apply, seed a `tenant_settings` row for every existing tenant with `stt_config = {}` and `note_recording_config = {}` (empty objects — env fallback handles real values). New tenants get a row inserted by a `BEFORE INSERT` trigger on `tenants` or by application code in the tenant-create path (researcher to choose; trigger is preferred for cross-cutting consistency).

### CRUD Resource Families (Notes / Folders / Conversations / Transcriptions / API Keys)

- **D-22: Authoritative wire shape = client TypeScript interfaces.** The OpenWhispr client at `~/openwhispr/src/services/{NotesService,FoldersService,ConversationsService,TranscriptionsService,ApiKeysService}.ts` defines every request/response interface in TypeScript. These are the byte-for-byte spec for Phase 5. Researcher MUST extract each interface (NoteInput, CloudNote, FolderInput, CloudFolder, ConversationInput, CloudConversation, CloudMessage, TranscriptionInput, CloudTranscription, ApiKey, CreateApiKeyResponse) and generate Zod schemas at `packages/wire-schemas/` (canonical home per Phase 2 D-* pattern).

- **D-23: Soft-delete model.** Every CRUD resource has `deleted_at: timestamptz NULL`. `DELETE /api/<resource>/delete` sets `deleted_at = NOW()`; list/get filter `WHERE deleted_at IS NULL`. `DELETE /api/notes/delete-all` is the only hard-delete variant (idempotent purge). Matches client expectations (every `Cloud*` interface has `deleted_at`).

- **D-24: Client-id columns for offline-first sync.** Each resource has `client_<resource>_id: text NULL` (`client_note_id`, `client_folder_id`, `client_conversation_id`, `client_transcription_id`). Client supplies on `create` for idempotent retry — UNIQUE per `(tenant_id, user_id, client_<resource>_id)` (partial index `WHERE client_<resource>_id IS NOT NULL`). Duplicate `client_*_id` on create → return the existing row (200 OK, not 409). Same semantics as `streaming-usage` D-10.

- **D-25: List pagination = keyset on `created_at + id`.** `?limit=N&before=<ISO>&since=<ISO>`. Default `limit = 50`, max `limit = 200`. `before` returns rows with `(created_at, id) < (before, ...)`; `since` returns rows with `(created_at, id) > (since, ...)`. No OFFSET (page deep without N+1 cost). Sort: `created_at DESC, id DESC` for default list; `since` filter implies ASC for sync-pull use.

- **D-26: Search backend = Postgres `tsvector` + GIN.** v1 search is Postgres-native (`to_tsvector('simple', content) @@ plainto_tsquery('simple', query)`), GIN-indexed. `'simple'` config (not `'english'`) to avoid stemming issues with mixed-language content (en + ru per project i18n). Phase 6 may revisit with `pg_trgm` for prefix matching or external search if real load demands. Returns `{notes: [{...CloudNote, score: number}]}` (per `NotesService.SearchResult`) — `score = ts_rank(...)`.

- **D-27: Conversations + messages relational model.** `conversations` and `messages` tables joined by `conversation_id`. `GET /api/conversations/list?include=messages` triggers a single round-trip with a JSONB array aggregation (`array_agg(messages)`) OR a 2-query LEFT JOIN — researcher to benchmark; favor the JOIN with `array_agg` for typed shape stability. `POST /api/conversations/messages` returns the just-created `CloudMessage`; `GET /api/conversations/messages?conversation_id=...&limit=N&before=...` lists messages keyset-paginated like D-25.

- **D-28: API Keys envelope deviates — `{data: T}` wrapper.** Per `~/openwhispr/src/services/ApiKeysService.ts`: responses are `{data: {keys: [...]}}` for list and `{data: {...ApiKey, key: "..."}}` for create. **All other Phase 5 endpoints return the resource directly.** Researcher must lock this exception in the route handler and CONTRACT-01 explicitly. The `key` field is returned **once** on creation (clear-text); subsequent list calls show only `key_prefix`.

- **D-29: API Keys are NOT the same as Better Auth bearer tokens.** These are programmatic-access keys (PAT-style) that grant subset access to `/api/*` for automation. Storage: `api_keys(id PK, tenant_id, user_id, name, key_prefix, key_hash, scopes, last_used_at, expires_at, created_at, revoked_at)` — keys hashed with Argon2id at rest. Authentication path: a separate `Authorization: Bearer pak_<key>` middleware that prefixes-routes to api-keys lookup vs. Better Auth session. Phase 5 ships the CRUD endpoints; the auth-middleware integration MAY defer to Phase 6 if scope tightens (researcher decision; minimum is the issuance/list path so users can prepare for Phase 6 enablement).

- **D-30: Batch endpoints are atomic-or-nothing within a transaction.** `POST /api/notes/batch-create`, `/api/folders/batch-create`, `/api/transcriptions/batch-create`, `/api/transcriptions/batch-delete` — wrap in a single Postgres transaction; ON CONFLICT (`client_*_id`) DO NOTHING per row, return the array of created/already-existing rows in the same order as the input. Max batch size: 500 items (research/plan: bench memory + tx time). Larger requests → 400 `{error: "batch size exceeds 500 items"}`.

- **D-31: RLS on every new table.** Every resource table — `tenant_settings`, `user_settings`, `notes`, `folders`, `conversations`, `messages`, `transcriptions`, `api_keys` — has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a policy referencing `current_setting('app.tenant_id')`. RLS-introspection lint (Phase 1 D-*) MUST stay green after Phase 5 migrations. TEST-RLS-01 property test extended to cover all new tables.

- **D-32: Phase 5 ledger debits CRUD writes at zero units.** `POST /api/notes/create` does NOT debit the usage_ledger (notes are storage, not compute). `POST /api/transcriptions/create` similarly — the transcribe Phase 3 endpoint already debits at that path. Only Phase 5's new compute call (`/api/agent/web-search`) and the streaming-usage report write to `usage_ledger`. This keeps `wordsUsed` aligned to "compute work performed", not "stuff stored".

### `cloud-api-request` Envelope Guarantee

- **D-33: CONTRACT-01 negative matrix.** Phase 5 extends the CONTRACT-01 suite with a negative-matrix test that walks every implemented `/api/*` route from the Phase-2..5 surface PLUS one synthetic `/api/nonexistent-{uuid}` path; for each, it triggers a 4xx/5xx (no auth, bad payload, unknown path) and asserts the response body matches **one of two envelope shapes**: `{error: string}` (default) OR `{error: {message: string, code?: string}}` (structured — per client `~/openwhispr/docs/BACKEND_SPEC.md:745`). Both are valid; the matrix proves the invariant holds across the whole surface, not just per-handler.

- **D-34: Default envelope = simple string.** Phase 5 endpoints all return `{error: string}`. The structured `{error: {message, code}}` is permitted by the client passthrough path but **not used by new Phase 5 endpoints** — keeps the spec narrow. Phase 3's transcribe quota-limit path (if any uses structured) stays unchanged; Phase 5 does not introduce new structured-error sites.

- **D-35: 404 for unimplemented paths via the global error handler.** Phase 2 already wires Fastify's `setNotFoundHandler` to emit the global envelope. Phase 5 does NOT add a wildcard `/api/*` route — relies on Phase 2's handler. CONTRACT-01 negative matrix proves this works for synthetic unknown paths.

- **D-36: 401 / 503 special-case behavior.** Per client `~/openwhispr/docs/BACKEND_SPEC.md:745`: `cloud-api-request` "treats 401/503 the same as the dedicated handlers". Translation: clients trigger session-refresh on 401 (TS-W-07) and feature-unavailable UX on 503 (TS-W-15 / Phase 4 D-18). Phase 5 endpoints emit 401 on missing/invalid bearer and 503 on missing provider keys (web-search) or unconfigured services — both fully envelope-conformant.

### Claude's Discretion

- Exact migration ordering and which Drizzle migration files cover which tables — researcher/planner decision. Constraints: maintain `migrations/0001..N` linear sequencing; one migration per logical resource group (settings / notes-folders / conversations-messages / transcriptions / api-keys) to keep PR review tractable; every migration MUST be forward + rollback verified in CI per Phase 1 D-*.
- Whether `POST /api/conversations/messages` accepts both single-message and array-of-messages — current client signature is single; allow plain-and-simple single-message for v1 to minimize surface area.
- BullMQ jobs for `notes/delete-all` (potential long-running purge) — researcher decides if it inlines or queues; cap inline at 1000 rows before queueing.
- The plain `simple` text-search dictionary vs language-detection — defaults to `simple` per D-26; planner may add a follow-up phase to introduce per-locale dictionaries.

### Folded Todos

None — no `/gsd-add-todo` matches against Phase 5 at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative client wire contract (RECOVERY SOURCE OF TRUTH)
- `~/openwhispr/docs/BACKEND_SPEC.md` — full upstream spec; Phase-5-relevant cards: lines 345 (`/api/agent/web-search`), 377 (`/api/streaming-usage`), 416 (`/api/usage`), 438 (`/api/stt-config`), 460 (`/api/note-recording-config`), 737 (`cloud-api-request` passthrough).
- `~/openwhispr/src/services/NotesService.ts` — `NoteInput`, `CloudNote`, `SearchResult` TS interfaces; defines all `/api/notes/*` request/response shapes byte-for-byte.
- `~/openwhispr/src/services/FoldersService.ts` — `FolderInput`, `CloudFolder` interfaces; all `/api/folders/*` shapes.
- `~/openwhispr/src/services/ConversationsService.ts` — `ConversationInput`, `CloudConversation`, `CloudMessage`, `CloudConversationWithMessages` interfaces; all `/api/conversations/*` and `/api/conversations/messages` shapes.
- `~/openwhispr/src/services/TranscriptionsService.ts` — `TranscriptionInput`, `CloudTranscription` interfaces; all `/api/transcriptions/*` shapes.
- `~/openwhispr/src/services/ApiKeysService.ts` — `ApiKey`, `CreateApiKeyResponse`, `V1Response<T>` (note: `{data: T}` envelope wrapper unique to keys); `/api/v1/keys/*` shapes.
- `~/openwhispr/src/services/cloudApi.ts` — the passthrough call mechanics; clients' error-reading contract `{success, error|data}` shape coming back from the IPC handler.
- `~/openwhispr/preload.js:508` — IPC handler registration (`cloud-api-request`).

### Local project context
- `.planning/PROJECT.md` — core value, English-only source rule, plan=unlimited rebaseline, no Stripe in v1.
- `.planning/REQUIREMENTS.md` — WIRE-08..16 acceptance criteria + global wire conventions; **CRUD scope expansion (D-22..D-32) requires REQUIREMENTS.md update before planning**.
- `.planning/ROADMAP.md` lines 381+ — Phase 5 original goal & success criteria; **CRUD scope expansion requires ROADMAP.md update too**.
- `.planning/phases/03-litellm-integration-bundled-oss-models/03-CONTEXT.md` — usage_ledger + LiteLLM spend reconciliation pattern (mirrored by Phase 5 web-search ledger D-06).
- `.planning/phases/04-streaming-realtime/04-CONTEXT.md` — D-18 missing-key 503 pattern (mirrored by D-08); D-19 rate-limit pattern (mirrored by D-07); D-20 timeout pattern (mirrored by D-08).
- `.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md` — global error envelope, dual-auth (Bearer + cookie), 401-not-200, CONTRACT-01 conformance suite (Phase 5 extends matrix per D-33).
- `.planning/phases/01-core-infra-multi-tenant-data/01-CONTEXT.md` — RLS, tenant-context middleware, `app.tenant_id` GUC, RLS-introspection lint (Phase 5 D-31 extends).
- `packages/data/src/schema/usage_ledger.ts` — exact ledger schema; Phase 5 inserts use `request_id` unique idempotency (D-06, D-10).
- `apps/api/src/routes/` — existing route conventions (handlers, error handler, rate-limit setup) — Phase 5 mirrors them.

### Provider docs
- `https://aistudio.yandex.ru/docs/ru/search-api/concepts/web-search.html` — Yandex AI Studio Search API spec (Russian).
- Tavily docs — researcher to confirm current 2026 endpoint shape; expected `POST https://api.tavily.com/search` returning `{results: [{title, url, content, score, ...}]}`.

### User-provided reference materials
- `/Users/nick/Downloads/server.py` — working Yandex Search Python reference. **CURRENTLY SANDBOXED by macOS — cannot be read directly by tooling.** Researcher: ask user to move into the repo (suggested `tools/reference/yandex-search-server.py`, gitignored if it contains keys) before Yandex adapter planning begins.

### No-Stripe / No-referrals enforcement (explicit OUT-OF-SCOPE)
- `~/openwhispr/docs/BACKEND_SPEC.md` lines 567 (`/api/stripe/checkout`), 593 (`/api/stripe/portal`), 613 (`/api/stripe/switch-plan`), 641 (`/api/stripe/preview-switch`), 665 (`/api/referrals/stats`), 689 (`/api/referrals/invite`), 715 (`/api/referrals/invites`) — Phase 5 does NOT implement any of these. User direction 2026-05-11: "никакого Stripe / прочая муть выпилены".

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/routes/transcribe.ts` + `reason.ts` (Phase 3) — proven patterns for: dual-auth (Bearer + cookie), `app.tenant_id` GUC scoping, usage_ledger writes with idempotent `ON CONFLICT (request_id) DO NOTHING`, OTel span attribute attachment, structured error envelope on every non-2xx. Phase 5 endpoints copy this skeleton.
- `apps/api/src/routes/realtime.ts` + `tokens/*` (Phase 4) — proven patterns for: env-key gating (503 on missing), per-route rate-limit via `@fastify/rate-limit`, `undici` outbound with 3s/5s timeouts. Web-search adapter (D-03, D-04) follows this skeleton.
- `packages/data/src/schema/usage_ledger.ts` — existing ledger schema; Phase 5 ingests via `kind = "streaming-stt" | "web-search.<provider>"` (D-06, D-10) without schema change.
- `packages/data/src/schema/{tenants,users}.ts` — existing tenancy roots; Phase 5 tables FK to these.
- `tests/contract/*` (Phase 2-3) — CONTRACT-01 harness; Phase 5 extends with the negative matrix (D-33) and new resource conformance files.

### Established Patterns
- **Tenant context:** `app.tenant_id` GUC set per request via Fastify `onRequest` hook (Phase 1 D-* + Phase 2 D-*). Every Phase 5 DB operation runs inside this context — RLS is the safety net.
- **Error envelope:** Single global error handler emits `{error: string}` on every Fastify-thrown error (Phase 2 D-*). Phase 5 endpoints throw typed errors; the handler shapes them.
- **Rate limiting:** Valkey-backed `@fastify/rate-limit` per route; key is Better Auth `session.userId`. Phase 5 inherits the standard policy except where overridden (web-search D-07, batch endpoints which planners may add stricter limits).
- **Migration discipline:** Drizzle migrations in `packages/data/migrations/` ordered linearly; every migration is forward-and-rollback CI-verified (Phase 1 D-*). Phase 5 adds 4-6 migrations (settings tables, notes+folders, conversations+messages, transcriptions, api_keys).
- **Wire-schema home:** Zod schemas live in `packages/wire-schemas/` (Phase 2 D-*); Phase 5 adds schemas for every new resource interface (D-22).
- **Soft-delete + client-id:** No prior pattern in this codebase — Phase 5 establishes (D-23, D-24). Researcher: document in `docs/conventions.md` so future resources follow.

### Integration Points
- `apps/api/src/index.ts` — Fastify app builder; Phase 5 routes registered alongside Phase 2-4 routes.
- `apps/api/src/middleware/` — bearer-auth, tenant-context middleware; Phase 5 reuses as-is.
- `apps/api/src/error-handler.ts` — global error envelope; Phase 5 reuses. CONTRACT-01 negative matrix verifies it still covers all paths.
- `packages/data/src/schema/index.ts` — Drizzle schema barrel; Phase 5 exports new tables here.
- `packages/data/src/seed/conformance.ts` — contract-test seed fixtures (Phase 2 D-*). Phase 5 extends with seed rows for every new resource so CONTRACT-01 has stable IDs to assert against.
- `tools/lint-rls.ts` — RLS-introspection lint (Phase 1 D-*). Phase 5 migrations MUST keep it green.
- `tests/e2e/` — live e2e suite (`make e2e-test`). Phase 5 adds e2e flows covering: full CRUD round-trip per resource, web-search live-provider gating, streaming-usage idempotency under retry.

</code_context>

<specifics>
## Specific Ideas

- **OpenWhispr client is the spec.** User: "у нас в соседней папке лежит клиент опенвиспр на основе которого мы восстанавливаем Сервер". Whenever planner/researcher hits an ambiguous shape, `~/openwhispr/src/services/*.ts` interfaces are the truth. `~/openwhispr/docs/BACKEND_SPEC.md` is the truth for the WIRE-08..16 endpoints; the service files are the truth for the CRUD expansion (D-22).
- **Yandex Search live snippets need normalization.** User: "формат сниппеты и туда сюда нужно будет под формат омологировать релевантные части". The Yandex adapter's biggest engineering risk is snippet-field normalization — researcher must dedicate explicit attention to it (test with multilingual queries, RTL text, code blocks). The user-provided `server.py` example contains the field-mapping wisdom.
- **Provider extensibility is non-negotiable.** User: "учти что провайдеров потом может быть больше". A hard-coded `if (provider === "tavily") ... else if (provider === "yandex") ...` switch in the route is unacceptable. Adapter-and-registry pattern is the only acceptable design.
- **Stripe/referrals are dead code in BACKEND_SPEC for our purposes.** User: "никакого Stripe / прочая муть выпилены". The CONTRACT-01 negative matrix MUST NOT verify these paths exist; they should 404 (via Phase 2 not-found handler) without further work.
- **UI is coming.** User: "UI будет ... потом для него спеку написать". Phase 7 (already on ROADMAP.md) is the UI-SPEC phase. Phase 5 settings tables (D-17) and CRUD shapes (D-22) prepare the ground; Phase 7 builds the actual UI against them.

</specifics>

<deferred>
## Deferred Ideas

- **Per-user / per-tenant settings MUTATION endpoints** (`PUT /api/stt-config`, `PUT /api/note-recording-config`) — Phase 5 ships read paths only (D-17). Mutation belongs in Phase 7 with the UI.
- **Stripe billing endpoints** (`/api/stripe/*`) — user-killed in v1; v2 deferred per PROJECT.md rebaseline.
- **Referrals endpoints** (`/api/referrals/*`) — same as Stripe.
- **API keys auth middleware enablement** — D-29 ships the CRUD endpoints; full `Bearer pak_*` auth-path integration MAY defer to Phase 6 if scope tightens. Researcher to flag at planning.
- **`pg_trgm` / external search engine** — D-26 ships `tsvector + GIN` v1; richer fuzzy/prefix search deferred to Phase 6 or beyond.
- **Per-locale text-search dictionaries** — D-26 uses `'simple'` config to dodge stemming issues; locale-aware dictionaries deferred.
- **Materialized view for `/api/usage` aggregation** — D-16 punts; Phase 6 observability may add if hot.
- **Conversations messages: array-batch insert** — current client calls add-one-at-a-time per D-22; batch-message insert deferred until client wants it.
- **`tenant_settings` schema migration paths for adding/removing JSONB keys** — researcher to plan an ADR on JSONB schema evolution for the v1.x UI editing flow.
- **More web-search providers** (Brave, SerpAPI, Bing, Kagi, etc.) — D-01 registry is designed for extensibility; each future provider is its own adapter file added in a later decimal phase.

### Reviewed Todos (not folded)
None — `/gsd-add-todo` system did not surface relevant matches at discussion time.

</deferred>

---

## ⚠️ Required pre-planning actions

Before `/gsd-plan-phase 5` is run, the following source-of-truth files MUST be updated to reflect the scope expansion locked in this discussion:

1. **`.planning/ROADMAP.md`** — Phase 5 section (line 381+) must list the CRUD resource families (notes, folders, conversations, transcriptions, api-keys) and explicitly call out the Stripe/referrals exclusion. Update "Plans: TBD" with the resource group count (~5-7 plans expected).
2. **`.planning/REQUIREMENTS.md`** — Add new requirement entries for the CRUD scope:
   - `WIRE-22..29` (or next available IDs) for notes / folders / conversations / messages / transcriptions / api-keys CRUD + search.
   - Reference the client TS interfaces as the acceptance criteria.
   - Update the WIRE-traceability table mapping each new ID to Phase 5.
3. (Optional) **`.planning/PROJECT.md`** — minor evolution-log entry noting the scope-expansion decision rationale.

These updates can land as part of the Phase 5 plan-phase commit train, but the planner MUST verify them before generating plans — otherwise the gsd-plan-checker will (correctly) reject plans for routes not in REQUIREMENTS.md.

---

*Phase: 05-operational-endpoints*
*Context gathered: 2026-05-11*
