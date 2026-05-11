# Phase 5: Operational Endpoints + CRUD Resource Families — Research

**Researched:** 2026-05-11
**Domain:** REST CRUD + multi-provider web-search + idempotent usage ledger + tenant-scoped settings + Argon2id API keys + Postgres tsvector full-text search + keyset pagination + CONTRACT-01 negative matrix
**Confidence:** HIGH (most areas), MEDIUM (Yandex Search API v2 — user-provided reference still sandboxed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Web-Search Endpoint (`POST /api/agent/web-search`):**
- **D-01**: Multi-provider registry. `WebSearchProvider` interface `{name, isConfigured(), search(query, numResults?) → Promise<{results: Array<{title,url,snippet}>}>}` with `Map<string, WebSearchProvider>`. v1 ships **Tavily + Yandex AI Studio Search**. Registry extensible — adding a 3rd/4th provider is a single adapter file + env-flag entry, no route changes.
- **D-02**: `WEB_SEARCH_PROVIDER` env (default: `tavily`). Per-deployment selection (no per-request override). Unknown name → fatal at boot.
- **D-03**: Tavily adapter — `POST https://api.tavily.com/search`, body `{api_key, query, max_results: numResults ?? 5}`. Native response `{results: [{title, url, content, score, ...}]}` → normalize `content` → `snippet`, drop `score` and other non-spec fields.
- **D-04**: Yandex adapter — per `https://aistudio.yandex.ru/docs/ru/search-api/concepts/web-search.html`. Auth: `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID`. Normalize headline/passages/extract → `snippet`.
- **D-05**: Request body matches client — `{query: string, numResults?: number}`. Server caps numResults at 10.
- **D-06**: `usage_ledger` row per call — `(tenant_id, user_id, request_id = Fastify req.id, kind = "web-search.<provider>", units = 1)`. Server-generated `request_id` (each retry = new ledger row).
- **D-07**: Rate limit 30/min/user via `@fastify/rate-limit` keyed on `session.userId` over Valkey.
- **D-08**: Missing key → `503 {"error":"<Provider> not configured (set <ENV_VAR> in .env)"}`. Upstream 5xx/timeout → `502 {"error":"web-search upstream failed"}`. 3s connect / 5s total via undici.

**Streaming-Usage (`POST /api/streaming-usage`):**
- **D-09**: Accept 14 fields from `BACKEND_SPEC.md:377-412`. Only `sessionId` and `audioDurationSeconds` are persistence-critical.
- **D-10**: Idempotency key = client-supplied `sessionId` → `usage_ledger.request_id`. `kind = "streaming-stt"`. `units = Math.round(audioDurationSeconds)`. Duplicate sessionId → **200 OK with existing row's response shape** (NOT 409). Implementation: `INSERT … ON CONFLICT (request_id) DO NOTHING RETURNING *` + SELECT fallback.
- **D-11**: Observability metadata to OTel + Loki, **not** Postgres. Rich fields (sttProvider, sttModel, sttLanguage, audioSizeBytes, audioFormat, sttProcessingMs, clientTotalMs, clientType, appVersion, clientVersion, text truncated to 200 chars) attach as OTel span attrs + structured log fields.
- **D-12**: Response shape `{wordsUsed, wordsRemaining: 999_999_999, plan: "unlimited", limitReached: false}` — identical to `/api/transcribe` and `/api/usage`.
- **D-13**: `text` policy — SHA-256 hash + length + 200-char preview to OTel logs. **Never** persist full transcript in `usage_ledger`. `sendLogs: true` → allow longer log preview (1000 chars).

**Usage Endpoint (`GET /api/usage`):**
- **D-14**: Aggregation = `SUM(units)` lifetime across all kinds. RLS already scopes tenant.
- **D-15**: Response `{wordsUsed, wordsRemaining: 999_999_999, plan: "unlimited", limitReached: false}`.
- **D-16**: No cache in v1. Materialized view deferred.

**STT-Config / Note-Recording-Config:**
- **D-17**: Storage = `tenant_settings` (PK `tenant_id`, JSONB columns `stt_config`, `note_recording_config`) + `user_settings` (PK `user_id`, JSONB `stt_overrides`, `note_recording_overrides`). RLS via `app.tenant_id`. Phase 5 ships GET only; PUT/PATCH deferred to Phase 7.
- **D-18**: Resolution order: user_settings → tenant_settings → env defaults.
- **D-19**: `/api/stt-config` shape `{defaultModel, defaultLanguage, availableProviders: string[]}`. `availableProviders` computed from which provider env keys are set. Defaults: `defaultModel = "whisper-1"`, `defaultLanguage = "auto"`.
- **D-20**: `/api/note-recording-config` shape `{maxDurationSeconds: 7200, sampleRateHz: 16000, allowedFormats: ["webm","ogg","wav","m4a"], diarizationEnabled: true}`.
- **D-21**: On first migration, seed `tenant_settings` row for every existing tenant (empty JSONB). New tenants → BEFORE INSERT trigger on tenants OR app-code path (researcher: trigger preferred).

**CRUD Resource Families:**
- **D-22**: Wire shape = client TS interfaces at `~/openwhispr/src/services/{Notes,Folders,Conversations,Transcriptions,ApiKeys}Service.ts`. Generate Zod schemas at `packages/wire-schemas/`.
- **D-23**: Soft-delete model — every resource has `deleted_at: timestamptz NULL`. DELETE sets `deleted_at = NOW()`. List/get filters `WHERE deleted_at IS NULL`. `delete-all` is the only hard-delete.
- **D-24**: Client-id columns for offline-first sync. `client_<resource>_id text NULL`. Partial UNIQUE on `(tenant_id, user_id, client_<resource>_id) WHERE client_<resource>_id IS NOT NULL`. Duplicate on create → return existing row (200 OK, not 409).
- **D-25**: Keyset pagination on `(created_at, id)`. `?limit=50` default, max 200. `before` → `(created_at, id) < (before, ...)`. `since` → `(created_at, id) > (since, ...)`. Default sort `created_at DESC, id DESC`. `since` implies ASC.
- **D-26**: Search = Postgres tsvector + GIN with `'simple'` config. Returns `{notes/conversations: [{...resource, score}]}` where `score = ts_rank(...)`.
- **D-27**: Conversations + messages relational, joined by `conversation_id`. `include=messages` → JOIN with `array_agg` for typed shape stability.
- **D-28**: API keys envelope deviation — `{data: T}` wrapper. Other Phase 5 endpoints return resource directly. `key` returned **once** on creation.
- **D-29**: API keys ≠ Better Auth bearer. Table: `api_keys(id, tenant_id, user_id, name, key_prefix, key_hash, scopes, last_used_at, expires_at, created_at, revoked_at)`. Argon2id at rest. `Bearer pak_*` middleware MAY defer to Phase 6.
- **D-30**: Batch endpoints atomic in single transaction. `ON CONFLICT (client_*_id) DO NOTHING` per row. Returns array in input order. Max 500 items. >500 → 400 envelope.
- **D-31**: RLS on every new table (`tenant_settings`, `user_settings`, `notes`, `folders`, `conversations`, `messages`, `transcriptions`, `api_keys`). FORCE RLS. RLS introspection lint must stay green. TEST-RLS-01 extended.
- **D-32**: CRUD writes do NOT debit ledger. Only `/api/agent/web-search` and `/api/streaming-usage` write to ledger.

**`cloud-api-request` Envelope:**
- **D-33**: CONTRACT-01 negative matrix walks every implemented `/api/*` route + synthetic `/api/nonexistent-{uuid}`. For each: trigger 4xx/5xx (no auth, bad payload, unknown path). Assert body matches `{error: string}` OR `{error: {message, code?}}`.
- **D-34**: Default envelope = `{error: string}`. Phase 5 introduces no new structured-error sites.
- **D-35**: 404 via Phase 2 `setNotFoundHandler`. No wildcard `/api/*` route added.
- **D-36**: 401 (missing/invalid bearer) + 503 (missing keys) special-cased by client. Phase 5 endpoints emit both and remain envelope-conformant.

### Claude's Discretion
- Migration ordering (linear, one per logical resource group).
- Whether `POST /api/conversations/messages` accepts array or only single message — keep single for v1.
- BullMQ for `notes/delete-all` long-running purge — cap inline at 1000 rows before queueing.
- `'simple'` vs language-detection dictionary — keep `'simple'` for v1.

### Deferred Ideas (OUT OF SCOPE)
- PUT/PATCH for stt-config / note-recording-config (Phase 7 UI).
- Stripe `/api/stripe/*` and referrals `/api/referrals/*` — v2.
- API keys auth middleware enablement — Phase 6.
- `pg_trgm` / external search — Phase 6+.
- Per-locale text-search dictionaries.
- Materialized view for `/api/usage`.
- Array-batch insert for `POST /api/conversations/messages`.
- More web-search providers (Brave, SerpAPI, Bing, Kagi).
- JSONB schema-evolution ADR for `tenant_settings`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-08 | `POST /api/agent/web-search` server-side search tool | §3 Web-Search (Tavily verified; Yandex blocked) + §5 Plan 03 |
| WIRE-09 | `POST /api/streaming-usage` idempotent record | §2 Streaming-Usage + §5 Plan 02; mirrors Phase 3 transcribe ledger pattern |
| WIRE-10 | `GET /api/usage` observed stats; plan=unlimited | §2 Usage; SUM(units) over usage_ledger via existing tenant-scoped DB |
| WIRE-11 | `GET /api/stt-config` tenant/user STT config | §4 Settings Tables; resolution user→tenant→env |
| WIRE-12 | `GET /api/note-recording-config` policy config | §4 Settings Tables; same resolution chain |
| WIRE-16 | `cloud-api-request` envelope passthrough invariant | §7 CONTRACT-01 negative matrix design |
| WIRE-22 | Notes CRUD + list + search + batch-create | §6 Notes + §8 tsvector search + §9 keyset pagination |
| WIRE-23 | Folders CRUD + list + batch-create | §6 Folders (simpler — no search, only list w/ since) |
| WIRE-24 | Conversations CRUD + list (`include=messages`) + search | §6 Conversations + §10 messages JOIN strategy |
| WIRE-25 | Conversation messages add + list | §10 Messages keyset pagination on (conversation_id, created_at, id) |
| WIRE-26 | Transcriptions CRUD + list + batch-create/delete | §6 Transcriptions (no search, no folder FK) |
| WIRE-27 | API keys list + create + revoke | §11 Argon2id; §12 `{data: T}` envelope deviation |
| WIRE-28 | Settings storage (tenant_settings + user_settings) | §4 Settings Tables full schema + RLS + seed trigger |
| WIRE-29 | CONTRACT-01 negative matrix | §7 Route enumeration + envelope shape assertions |

Cross-cutting (every requirement): §13 Security (Argon2id, SSRF, tsquery injection, batch DoS), §14 Validation Architecture (Nyquist matrix per requirement), CLAUDE.md constitutional compliance (TDD + ≥90% coverage on all four axes + E2E mandatory with testcontainers).
</phase_requirements>

## Project Constraints (from CLAUDE.md)

These constitutional directives are equal in authority to CONTEXT.md decisions:

1. **Strict TDD** — RED → GREEN → REFACTOR. Tests and production code in the SAME atomic commit. Yolo-mode does NOT exempt. Per-phase coverage floor ≥90% on **lines, branches, functions, statements** for all new/modified files.
2. **E2E mandatory** — every user-visible route ships at least one e2e test that boots the real `docker compose` stack via `make e2e-test`. Phase verification MUST execute `make e2e-test`, not just unit tests.
3. **No mocks of internal logic** — mocks only at process/network boundaries (HTTP to Tavily/Yandex). DB and Valkey must run real (testcontainers).
4. **Real services in tests** — `packages/data` and any DB-touching code MUST run testcontainer integration against real Postgres + PgBouncer + Valkey. RLS-isolation property test extended to every new table.
5. **GitHub Actions only** — CI runs unit + integration + contract + e2e on every PR. Contract negative matrix is gating.
6. **No bundled local AI models** — Tavily/Yandex are env-driven; missing keys → 503 (never silent fallback). Same posture as Phase 3 LiteLLM keys.
7. **English-only** for code, identifiers, log keys, comments, commit messages. User-facing strings (in errors) eventually i18n; this phase keeps English.
8. **HTTPS only** — every route reachable behind Traefik with HTTPS redirect. No new plaintext ports.
9. **No `--legacy` / no `--no-verify`** — enterprise-grade only. If something fails, fix root cause.

## Summary

Phase 5 is **the largest phase by route count** but the **lowest by novel architectural risk** — every pattern needed (multipart auth flow, usage_ledger idempotent insert, env-key 503 gating, undici timeouts, rate-limit on Valkey, RLS via `app.tenant_id`, soft-delete + audit, migration discipline, CONTRACT-01) is established and proven in Phases 1–4. The risk surface concentrates in three places:

1. **Yandex Search API integration** — public docs are CAPTCHA-blocked from automated tools; the user-provided Python reference at `/Users/dev/Downloads/server.py` cannot be read due to macOS Downloads-folder sandboxing (`EPERM`). Plan 03 (web-search) is BLOCKED on the user moving this file into the repo (e.g. `tools/reference/yandex-search-server.py`, gitignored if it contains live keys). Yandex Search API v1 is **deprecated since 2025-09-30**; v2 has both sync and deferred (async, operation-poll) modes — without the reference, we cannot confirm which mode this deployment uses. Tavily is **fully verified**.
2. **Postgres full-text search semantics with `'simple'` config + mixed en+ru content** — `websearch_to_tsquery('simple', $1)` is the safe choice (raw user input, no syntax errors), but `'simple'` config strips no morphology, so Russian queries match Russian content character-for-character only. Documented as Phase 6+ revisit per D-26.
3. **Per-resource migration discipline at scale** — 8 new tables in one phase (`tenant_settings`, `user_settings`, `notes`, `folders`, `conversations`, `messages`, `transcriptions`, `api_keys`), each with RLS + FORCE RLS + partial unique indexes + GIN where needed + keyset indexes + soft-delete partial indexes. The RLS introspection lint (Phase 1) must keep green across all of them. CI runtime budget for forward-rollback verification grows linearly — recommend one migration file per logical resource group (5 migrations: settings, notes+folders, conversations+messages, transcriptions, api_keys).

**Primary recommendation:** Group Phase 5 into **8 plans across 3 waves**:
- **Wave 0 (Plan 01):** Wire-schema extraction + migration scaffolding + seed extension + CONTRACT-01 baseline expansion (test infrastructure first — establishes the failing-test net before any handlers exist).
- **Wave 1 (Plans 02, 03, 04):** Settings tables + GET stt-config + GET note-recording-config (Plan 02). Streaming-usage + GET /api/usage (Plan 03). Web-search registry + Tavily + Yandex adapters (Plan 04). All three are independent; can land in parallel.
- **Wave 2 (Plans 05, 06, 07, 08):** Notes + folders + notes search (Plan 05). Conversations + messages + conversation search (Plan 06). Transcriptions (Plan 07). API keys + Argon2id (Plan 08). Plans 05–08 may run in parallel after Wave 1 because each owns its own migration file and route file.
- **Wave 3 (Plan 09):** CONTRACT-01 negative matrix end-to-end + docs/conventions.md (soft-delete + client_id pattern) + integration smoke + ROADMAP/REQUIREMENTS update.

This grouping minimizes merge conflicts (each plan owns disjoint files), keeps every plan under ~15 tasks, and lets the verifier run targeted e2e per resource family in parallel.

## Standard Stack

### Core (verified against npm registry 2026-05-11)

| Library | Verified Version | Purpose | Why Standard | Source |
|---------|------------------|---------|--------------|--------|
| `@node-rs/argon2` | **2.0.2** | Argon2id password hashing for API keys | Rust binding, ~8× smaller install than `argon2` (476K vs 3.7M), no node-gyp postinstall, cross-platform incl. Apple M1; OWASP-compliant Argon2id | [VERIFIED: npm view] |
| `argon2` (alternative) | **0.44.0** | Same | Standard C/C++ binding, larger but more weekly downloads | [VERIFIED: npm view] |
| `drizzle-orm` | **0.45.2** (existing in repo) | ORM | Existing project pin; supports `.generatedAlwaysAs()` for tsvector since 0.32.0 | [VERIFIED: package.json + npm] |
| `drizzle-kit` | **0.31.10** (existing in repo) | Migration tooling | Existing pin per Phase 1 D-* | [VERIFIED: npm view] |
| `zod` | **4.4.3** | Wire schema validation | Already in `packages/wire-schemas/` from Phase 2 | [VERIFIED: npm view] |
| `@fastify/rate-limit` | **10.3.0** | Per-route rate limiting | Already wired in Phase 4 D-19 with Valkey store | [VERIFIED: npm view] |
| `undici` (bundled) | Node 24 LTS native `fetch` | Outbound HTTP to Tavily/Yandex | Phase 4 D-20 already uses this for AssemblyAI/Deepgram/OpenAI token mints | [VERIFIED: Node 24 ships undici] |

**Recommendation: `@node-rs/argon2` over `argon2`.** Smaller image footprint (matters for multi-arch builds — Phase 1 D-08), no node-gyp toolchain in Dockerfile, faster cold start. Both implement the same Argon2id spec; output format is interoperable. [CITED: https://www.npmjs.com/package/@node-rs/argon2]

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `@fastify/multipart` (existing) | NOT needed Phase 5 | Only Phase 3 multipart routes — Phase 5 is JSON-only |
| `nanoid` or built-in `crypto.randomBytes` | Generate `pak_<24chars>` API key clear-text | crypto.randomBytes is std lib; no extra dep needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@node-rs/argon2` | `argon2` npm | More weekly downloads but heavier install, requires build tools |
| `@node-rs/argon2` | `bcrypt` | bcrypt is OWASP-acceptable but Argon2id is preferred; D-29 specifies Argon2id |
| Better Auth's internal hashing | Standalone Argon2id | Better Auth uses bcrypt by default; API keys are a separate trust domain and should not share Better Auth's password hash table |
| Postgres tsvector + GIN | `pg_trgm` (trigram) | tsvector wins for word-prefix and ranking; trigram wins for substring/fuzzy. D-26 picks tsvector; trigram deferred. |
| Postgres tsvector + GIN | OpenSearch / Meilisearch | Heavyweight, extra service. Postgres tsvector covers v1 traffic. Deferred. |
| `array_agg(jsonb_build_object(...))` for messages JOIN | 2-query LEFT JOIN | array_agg gives typed shape stability in one round-trip; favored per D-27 |
| Synchronous Yandex Search | Deferred (poll operation_id) | Deferred mode adds latency + state; sync is preferred — confirm via user's reference file |

**Installation (Phase 5 net new):**
```bash
pnpm --filter @openwhispr/api add @node-rs/argon2@2.0.2
# All others (zod, drizzle-orm, @fastify/rate-limit, undici) already present.
```

## Architecture Patterns

### Recommended File Layout (mirroring Phase 3/4 conventions)

```
apps/api/src/routes/
├── agent/
│   └── web-search.ts            # POST /api/agent/web-search — registry dispatch
├── usage.ts                     # GET /api/usage — SUM aggregator
├── streaming-usage.ts           # POST /api/streaming-usage — idempotent ledger
├── stt-config.ts                # GET /api/stt-config — settings resolve
├── note-recording-config.ts     # GET /api/note-recording-config — same
├── notes/
│   ├── create.ts                # POST /api/notes/create
│   ├── batch-create.ts          # POST /api/notes/batch-create
│   ├── update.ts                # PATCH /api/notes/update
│   ├── delete.ts                # DELETE /api/notes/delete
│   ├── delete-all.ts            # DELETE /api/notes/delete-all
│   ├── list.ts                  # GET /api/notes/list
│   └── search.ts                # POST /api/notes/search
├── folders/                     # CRUD + list + batch-create (no search, no delete-all)
├── conversations/               # CRUD + list (include=messages) + search + messages
├── transcriptions/              # CRUD + list + batch-create + batch-delete
└── v1/
    └── keys/
        ├── list.ts              # GET /api/v1/keys/list
        ├── create.ts            # POST /api/v1/keys/create
        └── revoke.ts            # POST /api/v1/keys/:id/revoke

apps/api/src/lib/
├── keyset-pagination.ts         # parse ?limit&before&since → SQL tuple WHERE
├── soft-delete.ts               # withSoftDelete(query) helper
├── client-id-upsert.ts          # INSERT ... ON CONFLICT (client_*_id) DO NOTHING RETURNING
├── argon2-keys.ts               # generatePak() + hashKey() + verifyKey() + parsePakPrefix()
└── web-search/
    ├── registry.ts              # Map<string, WebSearchProvider> + resolve at boot
    ├── types.ts                 # WebSearchProvider interface
    ├── tavily-adapter.ts        # Tavily provider
    └── yandex-adapter.ts        # Yandex provider

packages/data/src/schema/
├── tenant_settings.ts           # PK tenant_id FK→tenants
├── user_settings.ts             # PK user_id FK→users, tenant_id FK→tenants
├── notes.ts                     # tsvector generated col
├── folders.ts
├── conversations.ts             # tsvector generated col
├── messages.ts                  # FK conversation_id
├── transcriptions.ts
└── api_keys.ts

packages/data/migrations/
├── 0006_tenant_settings.sql        # WIRE-28 + seed default tenant row + BEFORE INSERT trigger
├── 0007_notes_folders.sql          # WIRE-22 + WIRE-23
├── 0008_conversations_messages.sql # WIRE-24 + WIRE-25
├── 0009_transcriptions.sql         # WIRE-26
└── 0010_api_keys.sql               # WIRE-27

packages/wire-schemas/src/
├── notes.ts                     # NoteInput, CloudNote, SearchResult — from NotesService.ts
├── folders.ts                   # FolderInput, CloudFolder
├── conversations.ts             # ConversationInput, CloudConversation, CloudMessage
├── transcriptions.ts            # TranscriptionInput, CloudTranscription
├── api-keys.ts                  # ApiKey, CreateApiKeyResponse, V1Response<T>
├── streaming-usage.ts           # 14 fields
└── web-search.ts                # request/response

packages/contract-tests/src/
├── notes.test.ts                # WIRE-22
├── folders.test.ts              # WIRE-23
├── conversations.test.ts        # WIRE-24+25
├── transcriptions.test.ts       # WIRE-26
├── api-keys.test.ts             # WIRE-27
├── streaming-usage.test.ts      # WIRE-09
├── usage.test.ts                # WIRE-10
├── stt-config.test.ts           # WIRE-11
├── note-recording-config.test.ts # WIRE-12
├── web-search.test.ts           # WIRE-08
└── negative-matrix.test.ts      # WIRE-29 — enumerates every route at runtime
```

### Pattern 1: Idempotent Resource Create with `client_<resource>_id`

**What:** Every create handler does the same dance — INSERT with ON CONFLICT on the partial unique index, fall back to SELECT if the conflict swallowed the insert.

**When to use:** Every CRUD `create` and every `batch-create` row.

**Example (verified against Phase 3 transcribe pattern at `apps/api/src/routes/transcribe.ts:130-136`):**

```typescript
// Source: derived from Phase 3 transcribe.ts ledger idempotency pattern.
// Phase 5 generalizes to all CRUD resources with client_*_id columns.
async function createOrReturnExisting<T>(
  tx: ExecutableTx,
  tenantId: string,
  userId: string,
  clientId: string | null,
  insertValues: T,
): Promise<{ row: CloudResource; created: boolean }> {
  // INSERT ... ON CONFLICT (tenant_id, user_id, client_<resource>_id)
  // WHERE client_<resource>_id IS NOT NULL DO NOTHING RETURNING *
  const inserted = await tx.execute(sql`
    INSERT INTO notes (...) VALUES (...)
    ON CONFLICT (tenant_id, user_id, client_note_id)
      WHERE client_note_id IS NOT NULL
      DO NOTHING
    RETURNING *
  `);
  if (inserted.rows.length > 0) return { row: inserted.rows[0], created: true };
  // Conflict path — SELECT the existing row by client_id.
  const existing = await tx.execute(sql`
    SELECT * FROM notes
    WHERE tenant_id = ${tenantId}::uuid
      AND user_id = ${userId}::uuid
      AND client_note_id = ${clientId}
      AND deleted_at IS NULL
    LIMIT 1
  `);
  return { row: existing.rows[0], created: false };
}
```

### Pattern 2: Keyset Pagination Tuple Comparison

**What:** WHERE `(created_at, id) < ($before_ts, $before_id)` ORDER BY `created_at DESC, id DESC` LIMIT N.

**When to use:** Every `GET /api/<resource>/list` endpoint.

**Example:**

```typescript
// Source: [CITED: https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/]
// Drizzle SQL builder doesn't natively emit tuple comparison; drop to sql`` template.

function parseListQuery(q: { limit?: string; before?: string; since?: string }) {
  const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10), 1), 200);
  // before — points are STRICTLY LESS THAN this (created_at, id) tuple
  // since — points are STRICTLY GREATER THAN this (created_at, id) tuple
  // Cursor encoding: ISO-8601 timestamp; on tie, fall through to id (UUID) DESC
  return { limit, before: q.before, since: q.since };
}

const rows = await db.execute(sql`
  SELECT * FROM notes
  WHERE tenant_id = ${tenantId}::uuid
    AND deleted_at IS NULL
    ${before ? sql`AND (created_at, id) < (${before}::timestamptz, ${beforeId}::uuid)` : sql``}
    ${since ? sql`AND (created_at, id) > (${since}::timestamptz, ${sinceId}::uuid)` : sql``}
  ORDER BY created_at DESC, id DESC
  LIMIT ${limit}
`);
```

**Index for this query:** `CREATE INDEX notes_keyset_idx ON notes (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;` — partial index excludes soft-deleted rows from scan.

**Cursor format consideration:** Client only sends a timestamp (`?before=2026-05-10T12:34:56.789Z`) per service file signatures. Server-side, when comparing tied timestamps, sort by `id` as tie-breaker but don't require client to send id. The tuple comparison still works if you treat missing `beforeId` as `'\xff' * 16` (UUID max) for `<` and `'\x00' * 16` for `>`. Document this in `apps/api/src/lib/keyset-pagination.ts`.

### Pattern 3: Postgres tsvector + GIN with `websearch_to_tsquery` (safe for raw user input)

**What:** Generated tsvector column + GIN index + `websearch_to_tsquery` for parsing.

**When to use:** `POST /api/notes/search` and `POST /api/conversations/search`.

**Example (verified against Drizzle docs):**

```typescript
// Source: [CITED: https://orm.drizzle.team/docs/guides/full-text-search-with-generated-columns]
// Requires drizzle-orm@>=0.32.0 — repo has 0.45.2.

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  clientNoteId: text("client_note_id"),
  title: text("title"),
  content: text("content").notNull().default(""),
  // ... other fields
  contentSearch: tsvector("content_search").generatedAlwaysAs(
    (): SQL => sql`
      setweight(to_tsvector('simple', coalesce(${notes.title}, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(${notes.content}, '')), 'B')
    `,
  ),
  // ...
}, (t) => ({
  contentSearchIdx: index("notes_content_search_idx").using("gin", t.contentSearch),
}));

// Query (handler):
const results = await db.execute(sql`
  SELECT *, ts_rank(content_search, query) AS score
  FROM notes, websearch_to_tsquery('simple', ${userQuery}) query
  WHERE tenant_id = ${tenantId}::uuid
    AND deleted_at IS NULL
    AND content_search @@ query
  ORDER BY score DESC, created_at DESC
  LIMIT ${limit};
`);
```

**Why `websearch_to_tsquery` over `plainto_tsquery`:** `websearch_to_tsquery` (PG 11+) **never raises syntax errors** on raw user input AND supports quoted phrases + negation (`"exact phrase" -unwanted`) — the natural search UX users expect. `plainto_tsquery` AND-joins every word and ignores quotes. [CITED: https://www.postgresql.org/docs/current/textsearch-controls.html]

**`tsvector` Drizzle helper:** Drizzle 0.45 ships `tsvector` column type indirectly via `customType<{ data: string }>({ dataType() { return "tsvector"; } })`. Define once in `packages/data/src/schema/_helpers.ts` and reuse.

### Pattern 4: Settings Resolution Chain

```typescript
// Source: derived from D-18.
async function resolveSttConfig(tx, tenantId, userId) {
  const [tenantRow, userRow] = await Promise.all([
    tx.execute(sql`SELECT stt_config FROM tenant_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`),
    tx.execute(sql`SELECT stt_overrides FROM user_settings WHERE user_id = ${userId}::uuid LIMIT 1`),
  ]);
  const tenantCfg = tenantRow.rows[0]?.stt_config ?? {};
  const userCfg = userRow.rows[0]?.stt_overrides ?? {};
  // Layered: env defaults → tenant → user (user wins)
  return {
    defaultModel: userCfg.defaultModel ?? tenantCfg.defaultModel ?? process.env.STT_DEFAULT_MODEL ?? "whisper-1",
    defaultLanguage: userCfg.defaultLanguage ?? tenantCfg.defaultLanguage ?? process.env.STT_DEFAULT_LANGUAGE ?? "auto",
    availableProviders: computeAvailableProviders(),  // from env at request time
  };
}

function computeAvailableProviders(): string[] {
  const out: string[] = [];
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.GROQ_API_KEY) out.push("groq");
  if (process.env.ASSEMBLYAI_API_KEY) out.push("assemblyai");
  if (process.env.DEEPGRAM_API_KEY) out.push("deepgram");
  return out;
}
```

### Pattern 5: Web-Search Registry (extensible adapter)

```typescript
// Source: derived from D-01, D-02, mirrors Phase 4 token-mint provider isolation.
export interface WebSearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, numResults: number): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }>;
}

const REGISTRY = new Map<string, WebSearchProvider>([
  ["tavily", new TavilyProvider({ apiKey: process.env.TAVILY_API_KEY })],
  ["yandex", new YandexProvider({
    apiKey: process.env.YANDEX_SEARCH_API_KEY,
    folderId: process.env.YANDEX_FOLDER_ID,
  })],
]);

// Resolve at boot — fatal if unknown name (Phase 1 no-default-secrets discipline)
export function resolveWebSearchProvider(): WebSearchProvider {
  const name = process.env.WEB_SEARCH_PROVIDER ?? "tavily";
  const provider = REGISTRY.get(name);
  if (!provider) throw new Error(`Unknown WEB_SEARCH_PROVIDER: ${name}. Known: ${[...REGISTRY.keys()].join(", ")}`);
  return provider;
}
```

### Anti-Patterns to Avoid

- **Hand-rolled tsquery escaping** — using `to_tsquery` with `.replace(/[!&|()]/g, '')` is fragile. Use `websearch_to_tsquery`; it sanitizes for free.
- **OFFSET pagination** — slow at scale, returns duplicates if rows shift mid-pagination. Keyset only.
- **Returning the existing row in CONFLICT path via `RETURNING *` on `ON CONFLICT DO UPDATE SET id=id`** — works on some PG versions, footgun on others. Use explicit SELECT fallback.
- **Storing API keys plaintext or with bcrypt** — D-29 mandates Argon2id; bcrypt is OWASP-acceptable but specifically deprecated for new code in favor of Argon2id [CITED: https://github.com/OWASP/CheatSheetSeries/issues/1183].
- **Including `key_hash` or `key` in GET /list responses** — only `key_prefix` is safe to display. The clear-text `key` is returned ONCE on creation only (D-28).
- **Counting `wordsUsed` from CRUD writes** — D-32 only `web-search` and `streaming-usage` write to ledger. Mixing them up double-counts.
- **Polling Yandex's deferred mode synchronously in the request handler** — that ties up a Fastify worker for seconds. If the user's reference confirms deferred mode is the only option, the registry's `search()` method must accept that latency budget OR the Yandex adapter must use v2 sync mode.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argon2id password hashing | Custom KDF | `@node-rs/argon2` | Memory-hard parameters, timing attack hardening, side-channel resistance — none trivial to reimplement |
| tsquery escaping for user input | Regex strip of operators | `websearch_to_tsquery` | Never raises syntax errors on raw user input by design |
| Keyset cursor encoding | Custom base64 cursor format | Just use ISO-8601 timestamp string (per client signatures) | Client already sends `?before=ISO` per `NotesService.list` |
| API key generation | Manual `crypto.randomBytes` munging | `crypto.randomBytes(24).toString('base64url')` with `pak_` prefix | Built-in is fine — just don't roll your own RNG |
| Soft-delete query helper | Per-handler `WHERE deleted_at IS NULL` repeated 30× | `apps/api/src/lib/soft-delete.ts` helper + partial indexes | DRY + ensures every list/get filters correctly |
| RLS introspection | Custom check | Existing `tools/lint-rls.ts` (Phase 1) | Already wired into CI |
| Rate-limit Valkey store | Re-implement bucket | `@fastify/rate-limit` (Phase 4 D-19) | Already proven |
| HTTP client to Tavily/Yandex | Custom fetch wrapper | Node 24 `globalThis.fetch` (undici) with AbortController | Phase 4 D-20 timeout pattern proven |
| Multi-tenant tenant-id scoping | Per-route `WHERE tenant_id = ...` | `withTenant(db, tenantId, fn)` from `@openwhispr/data` (Phase 1) | RLS is the safety net; helper is the ergonomic API |
| Zod schema → Drizzle row converter | Hand-rolled mapping | `drizzle-zod` (existing in repo, used Phase 2/3) | Maintains single source of truth |
| Test fixtures for each new resource | Per-test setup | Extend `packages/data/src/seed/conformance.ts` (Phase 2 D-*) | CONTRACT-01 already consumes this |

**Key insight:** Phase 5's job is **route assembly + schema wiring**, not framework invention. Every infrastructural pattern was solved in Phases 1–4. The novel pieces (Argon2id, tsvector, web-search registry) are all served by mainstream libraries.

## Runtime State Inventory

> Phase 5 is greenfield — it adds new tables, new routes, new Zod schemas, new ledger kinds. It does NOT rename or migrate existing identifiers, services, or storage keys.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing storage keys/names change. New tables only. | None |
| Live service config | None — no service config (LiteLLM, Valkey, MinIO, Traefik) needs renaming. | None |
| OS-registered state | None — no Task Scheduler / pm2 / launchd / systemd entries reference Phase 5 names. | None |
| Secrets/env vars | NEW env vars introduced (NOT renames): `TAVILY_API_KEY`, `YANDEX_SEARCH_API_KEY`, `YANDEX_FOLDER_ID`, `WEB_SEARCH_PROVIDER`, `STT_DEFAULT_MODEL`, `STT_DEFAULT_LANGUAGE`, `NOTE_RECORDING_MAX_DURATION_SECONDS`, `NOTE_RECORDING_SAMPLE_RATE_HZ`, `NOTE_RECORDING_ALLOWED_FORMATS`, `NOTE_RECORDING_DIARIZATION_ENABLED`. | Add to `.env.example`, `docs/operations.md` env table, and bootstrap.sh known-key list. NONE need rotation — they're brand new. |
| Build artifacts | Drizzle migration journal (`packages/data/migrations/meta/_journal.json`) needs 5 new entries (0006–0010). | Drizzle-kit auto-emits on `pnpm db:generate`. CI test-migration job will validate forward + rollback per Phase 1 D-* discipline. |

**Nothing else found** — verified by reading `apps/api/src/index.ts` (route registration barrel), `packages/data/src/schema/index.ts` (Drizzle barrel), and `docker-compose.yml` (no service rename needed).

## Common Pitfalls

### Pitfall 1: PgBouncer transaction-mode + tsvector generated columns
**What goes wrong:** GENERATED columns are stable across transaction modes, but if the GENERATED expression references `now()` or `current_setting('app.tenant_id')`, the value is recomputed on every read in unexpected ways under transaction-mode pooling.
**Why it happens:** PgBouncer transaction-mode resets `app.tenant_id` between transactions; generated columns must reference only the row's own columns.
**How to avoid:** Generated tsvector expression uses ONLY `coalesce(title, '')` and `coalesce(content, '')` — no `now()`, no `current_setting`. Verified safe.
**Warning signs:** RLS introspection lint failing, or tsvector values changing between identical SELECTs.

### Pitfall 2: `INSERT ... ON CONFLICT ... RETURNING *` swallows rows on partial unique index
**What goes wrong:** When the partial unique index has `WHERE client_note_id IS NOT NULL` and the insert has `client_note_id = NULL`, the conflict is impossible → insert succeeds even on duplicate. Behaviour by design but surprising.
**Why it happens:** Partial unique indexes only enforce uniqueness for rows matching the WHERE clause.
**How to avoid:** Document that `client_note_id = NULL` always creates a new row (no idempotency). Clients SHOULD always send a client_id when they want retry safety.
**Warning signs:** Duplicate rows appearing in user's notes after offline-sync replay; verify in TEST-CRUD-IDEM-01 property test.

### Pitfall 3: `websearch_to_tsquery` with empty string returns empty tsquery (matches nothing, not everything)
**What goes wrong:** `POST /api/notes/search` with `{query: ""}` returns zero results, not all notes.
**Why it happens:** Empty tsquery matches no documents.
**How to avoid:** Validate `query.trim().length >= 1` in Zod schema; reject with 400 envelope before SQL runs.
**Warning signs:** Empty search box silently returning zero results.

### Pitfall 4: Yandex Search API v1 deprecation (2025-09-30)
**What goes wrong:** Per [VERIFIED: WebSearch result] Yandex Search API v1 was discontinued 2025-09-30. Any reference code using v1 endpoints will return 4xx.
**Why it happens:** Yandex migrated to v2 — sync and async modes both available.
**How to avoid:** Plan 04 (web-search) MUST verify the user's reference uses v2. Pin v2 endpoint URLs explicitly in the adapter config.
**Warning signs:** Yandex returning 404 or 410 on what looks like a valid request.

### Pitfall 5: Argon2id hashing in request handler blocks event loop
**What goes wrong:** `POST /api/v1/keys/create` runs Argon2id at OWASP params (64MB, t=3, p=1) → 200–400ms blocking on a single Fastify worker → throughput collapses at 1000 concurrent.
**Why it happens:** Argon2id is intentionally CPU+memory expensive.
**How to avoid:** `@node-rs/argon2` uses Tokio threadpool natively (non-blocking via NAPI). Verify by stress-testing: 50 concurrent POST /api/v1/keys/create must NOT collapse to 1 req/s. Alternative: queue key-create via BullMQ (defer to Phase 6 if measurement shows blocking).
**Warning signs:** p95 latency on key-create > 1s at 50 concurrent; event-loop lag metric spiking.

### Pitfall 6: CONTRACT-01 negative matrix race with route registration order
**What goes wrong:** Negative matrix enumerates Fastify's route table at test startup; if a Phase 5 route is registered conditionally (e.g. behind feature flag), it disappears from the matrix and that endpoint's negative cases go untested.
**Why it happens:** `fastify.printRoutes()` and `fastify.routes` reflect what's actually registered.
**How to avoid:** No feature flags on Phase 5 endpoints. Register unconditionally in `apps/api/src/routes/index.ts` barrel. If a route depends on optional config (e.g. Tavily missing), the route MUST still register and emit 503 — never silently omit.
**Warning signs:** Negative matrix test count drops between PRs without a corresponding code removal.

### Pitfall 7: `tsvector` generated column blocks `ALTER TABLE` schema changes
**What goes wrong:** Adding a column to a table with a GENERATED tsvector column requires PG to rewrite the table on some versions.
**Why it happens:** Generated columns evaluate at insert/update time; ALTER may force re-evaluation.
**How to avoid:** Lock the tsvector expression early; column additions to notes/conversations should land BEFORE the GIN index migration if possible.
**Warning signs:** Migration runtime > 30s on production data sets.

### Pitfall 8: Settings tables seeded BEFORE INSERT trigger fires after tenant is committed
**What goes wrong:** D-21 trigger pattern — `BEFORE INSERT ON tenants ... INSERT INTO tenant_settings (tenant_id) VALUES (NEW.id)`. If the trigger fires BEFORE the parent INSERT commits, the FK reference fails.
**Why it happens:** BEFORE INSERT runs before NEW.id is persisted to the tenants table. FK constraints check at statement end (immediate by default).
**How to avoid:** Use AFTER INSERT trigger, NOT BEFORE. AFTER INSERT sees NEW.id as already inserted by the same statement (visible inside the same transaction). [CITED: PostgreSQL trigger docs]
**Warning signs:** Tenant creation 500-ing with FK violation in `tenant_settings`.

### Pitfall 9: Mixed-language tsvector with `'simple'` config
**What goes wrong:** Russian queries against English content (or vice versa) match nothing because `'simple'` config does no stemming.
**Why it happens:** D-26 picked `'simple'` to dodge wrong-language stemming, but it dodges all stemming.
**How to avoid:** Document as known v1 limitation. Phase 6+ can adopt `pg_trgm` or per-locale dictionaries. Update `docs/wire-contract.md` accordingly.
**Warning signs:** User complaints about search not finding "obvious" matches across en/ru boundaries.

### Pitfall 10: Tavily/Yandex SSRF via reflective response data
**What goes wrong:** Tavily/Yandex return arbitrary URLs in `results[].url`. Clients may follow them. If an attacker compromises an upstream record, they could redirect victims.
**Why it happens:** Search providers serve user-controlled content.
**How to avoid:** Do NOT fetch returned URLs server-side (no enrichment). Pass them through verbatim. The client follows them in user-space — that's the user's threat model, not ours.
**Warning signs:** N/A — by design.

## Code Examples

### Idempotent Streaming-Usage Insert (mirrors Phase 3 transcribe pattern)

```typescript
// Source: derived from apps/api/src/routes/transcribe.ts:130-136 (Phase 3, verified)
// + D-10 (200-not-409 on duplicate sessionId).
async function recordStreamingUsage(deps, req, body) {
  const tenantId = req.tenant;
  const userId = req.user.id;
  const requestId = body.sessionId;  // client-supplied idempotency key
  const minutes = Math.round(body.audioDurationSeconds / 60);

  // Idempotent insert
  await withTenant(deps.db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
      VALUES (${tenantId}::uuid, ${userId}::uuid, ${requestId}, 'streaming-stt', ${minutes})
      ON CONFLICT (request_id) DO NOTHING
    `);
  });

  // OTel + Loki metadata (D-11)
  req.log.info({
    event: 'streaming_usage_recorded',
    session_id: requestId,
    stt_provider: body.sttProvider,
    stt_model: body.sttModel,
    stt_language: body.sttLanguage,
    audio_size_bytes: body.audioSizeBytes,
    audio_format: body.audioFormat,
    stt_processing_ms: body.sttProcessingMs,
    client_total_ms: body.clientTotalMs,
    client_type: body.clientType,
    app_version: body.appVersion,
    client_version: body.clientVersion,
    text_sha256: createHash('sha256').update(body.text ?? '').digest('hex'),
    text_length: (body.text ?? '').length,
    text_preview: (body.text ?? '').slice(0, body.sendLogs ? 1000 : 200),
  }, 'streaming-usage');

  // Always-200 response shape (D-12)
  return {
    wordsUsed: await sumWordsUsed(tx, tenantId, userId),
    wordsRemaining: 999_999_999,
    plan: "unlimited" as const,
    limitReached: false as const,
  };
}
```

### Argon2id API Key Generation and Verification

```typescript
// Source: derived from D-29 + OWASP 2026 params + @node-rs/argon2 API.
// [CITED: https://www.npmjs.com/package/@node-rs/argon2]
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

const ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,     // 64 MB — OWASP 2026 first-choice
  timeCost: 3,           // 3 iterations
  parallelism: 1,
} as const;

export function generatePak(): { clearText: string; prefix: string } {
  const raw = randomBytes(24).toString("base64url"); // 32 chars
  const clearText = `pak_${raw}`;
  const prefix = clearText.slice(0, 12); // "pak_xxxxxxxx" — safe to display
  return { clearText, prefix };
}

export async function hashKey(clearText: string): Promise<string> {
  return hash(clearText, ARGON2_PARAMS); // returns "$argon2id$v=19$m=65536,t=3,p=1$..."
}

export async function verifyKey(clearText: string, storedHash: string): Promise<boolean> {
  return verify(storedHash, clearText, ARGON2_PARAMS);
}
```

### Web-Search Tavily Adapter

```typescript
// Source: [VERIFIED: docs.tavily.com/documentation/api-reference/endpoint/search]
// Endpoint: POST https://api.tavily.com/search; Auth: Bearer tvly-{key}
// Response: {results: [{title, url, content, score, raw_content, favicon, images}], ...}
export class TavilyProvider implements WebSearchProvider {
  readonly name = "tavily";
  constructor(private cfg: { apiKey: string | undefined }) {}

  isConfigured() { return !!this.cfg.apiKey; }

  async search(query: string, numResults: number) {
    if (!this.cfg.apiKey) throw new MissingProviderKeyError(
      "Tavily not configured (set TAVILY_API_KEY in .env)"
    );

    const ctrl = new AbortController();
    const totalTimer = setTimeout(() => ctrl.abort(), 5000);  // D-08
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(numResults, 10),  // D-05 cap
          search_depth: "basic",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new UpstreamError(`tavily ${res.status}`);
      const data = await res.json() as { results: Array<{ title: string; url: string; content: string }> };
      return {
        results: data.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content,  // D-03 normalize content → snippet
        })),
      };
    } finally {
      clearTimeout(totalTimer);
    }
  }
}
```

### Yandex Search Adapter (placeholder — requires user reference)

```typescript
// BLOCKED PENDING USER REFERENCE FILE MOVE.
// macOS sandboxes /Users/dev/Downloads/server.py with EPERM; planner MUST request
// user move it into the repo at tools/reference/yandex-search-server.py before
// Plan 04 execution begins.
//
// Best-known plan based on public docs (CAPTCHA-blocked from automated fetch):
//   - Yandex Search API v1 deprecated 2025-09-30. Use v2.
//   - v2 supports sync mode. Endpoint: https://searchapi.api.cloud.yandex.net/v2/web/searchSync
//     (verify with user reference).
//   - Auth: header "Authorization: Api-Key {YANDEX_SEARCH_API_KEY}" + "x-folder-id: {YANDEX_FOLDER_ID}"
//     (Yandex Cloud convention — service-account API keys).
//   - Response: JSON, contains "items"/"result" array. Per-result fields include
//     url, title, headline/passages (snippet equivalent). Normalize to {title, url, snippet}.
//     The "snippet" field is the load-bearing one to verify against the user's reference.
//   - Async (deferred) mode is also available; if reference uses it, adapter must poll
//     operation_id with bounded retries within the 5s total budget OR use long-poll.
//
// Confidence: LOW until user reference file is readable. [ASSUMED: v2 sync mode]
```

### Settings Tables Migration (BEFORE → AFTER trigger correction per Pitfall #8)

```sql
-- packages/data/migrations/0006_tenant_settings.sql
CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stt_config jsonb NOT NULL DEFAULT '{}',
  note_recording_config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stt_overrides jsonb NOT NULL DEFAULT '{}',
  note_recording_overrides jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY user_settings_isolation ON user_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- D-21: AFTER INSERT (not BEFORE — see Pitfall #8) trigger to seed default row
CREATE OR REPLACE FUNCTION seed_tenant_settings() RETURNS trigger AS $$
BEGIN
  INSERT INTO tenant_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tenants_seed_settings
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION seed_tenant_settings();

-- Backfill existing tenants
INSERT INTO tenant_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT DO NOTHING;
```

## State of the Art

| Old Approach | Current Approach (2026) | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| `to_tsquery` with regex-stripped user input | `websearch_to_tsquery` | PG 11+ | Never raises syntax errors; quote/negation support |
| OFFSET pagination | Keyset cursors `(created_at, id) < (...)` | Best-practice since ~2018, mainstream by 2024 | Constant-time deep pagination; stable under inserts |
| bcrypt password hashing | Argon2id (OWASP first-choice) | RFC 9106 (2021); OWASP cheat sheet 2026 | Memory-hard; resistant to GPU/ASIC attacks |
| Trigger-maintained tsvector | GENERATED column tsvector | PG 12+; Drizzle 0.32+ | One-line schema; no manual UPDATE on each insert |
| `argon2` (node-gyp build) | `@node-rs/argon2` (Rust NAPI) | 2022 onward | 8× smaller install; cross-platform without build tools |
| Yandex Search API v1 XML deferred-only | Yandex Search API v2 (sync + deferred JSON) | v1 EOL 2025-09-30 | v1 returns 410 after deprecation date |

**Deprecated/outdated:**
- LiteLLM v1.82.x multipart bug (already addressed Phase 3 — pinned ≥1.83.7).
- `kubernetes/ingress-nginx` (already addressed Phase 9 plan — Traefik 3).
- `to_tsquery` for user input (always was unsafe; current docs deprecate for user-facing search).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Yandex Search API v2 supports synchronous mode at endpoint `https://searchapi.api.cloud.yandex.net/v2/web/searchSync` (or similar) | §Code Examples / Yandex adapter | Plan 04 must use deferred mode + polling, which adds significant latency budget. Adapter design changes. |
| A2 | Yandex v2 auth header is `Authorization: Api-Key <key>` + `x-folder-id: <folder_id>` | §Code Examples / Yandex adapter | If actually IAM Bearer tokens, additional IAM token-mint refresh logic required |
| A3 | Yandex v2 response per-result field for snippet is named `passages` (array) or `headline` | §Code Examples / Yandex adapter | Normalization in D-04 maps wrong field → empty snippets in client UI |
| A4 | Argon2id 64MB+t=3+p=1 does not block event loop on Node 24 + `@node-rs/argon2` due to NAPI tokio threadpool | §Pitfall #5 | Throughput collapse at concurrency; fix is to defer to BullMQ worker — adds Phase 6 dependency |
| A5 | Drizzle 0.45.2 `tsvector` + `.generatedAlwaysAs()` round-trips through drizzle-kit migration generator without manual SQL augmentation | §Pattern 3 | Manual SQL augmentation required (like Phase 1 RLS) — acceptable but slower |
| A6 | `INSERT ... ON CONFLICT DO NOTHING RETURNING *` with `RETURNING *` does NOT include skipped-conflict rows on PG 17 | §Pattern 1 | If actually returns conflicts, the SELECT fallback is dead code — minor; no functional impact |
| A7 | Yandex Cloud `x-folder-id` header is the v2 convention (vs. body field) | §Code Examples / Yandex adapter | Body-field placement is also possible; adapter unit tests will surface |
| A8 | Tavily `score` field is omitted from D-03 normalization deliberately to keep wire shape narrow | §Standard Stack | Could expose `score` for client UX; minor enhancement |

**Mitigation for A1-A3, A7 (Yandex):** Plan 04 BLOCKS on the user moving `/Users/dev/Downloads/server.py` → `tools/reference/yandex-search-server.py`. The planner MUST raise this as an OPEN-QUESTION-FOR-USER before generating Plan 04. Once the file is readable, all four assumptions resolve to VERIFIED or get corrected in a Plan 04 amendment.

## Open Questions (RESOLVED)

1. **Yandex Search API v2 wire shape (BLOCKING for Plan 04)**
   - What we know: v1 deprecated 2025-09-30, v2 exists with sync + async modes; auth via Yandex Cloud Api-Key + folder-id; response in JSON or XML depending on endpoint.
   - What's unclear: which endpoint URL, which auth header format, response field name for snippet.
   - **RESOLVED:** User must move `/Users/dev/Downloads/server.py` into the repo (e.g. `tools/reference/yandex-search-server.py`; gitignored if it contains live keys) before Plan 04 execution. Without it, the Yandex adapter ships at LOW confidence and may need a rewrite at integration time.

2. **Conversations `array_agg` for include=messages — performance at scale**
   - What we know: D-27 favors single-round-trip JSON aggregation.
   - What's unclear: at N messages per conversation × M conversations, the array_agg memory footprint may exceed PG's `work_mem` default.
   - **RESOLVED:** cap conversation message-include count at 100 messages per conversation; if more, return a separate paginated `/api/conversations/messages` call hint. Document in `docs/wire-contract.md`. Verify with k6 load probe in Phase 8.

3. **`pak_*` API key middleware — Phase 5 or Phase 6?**
   - What we know: D-29 says CRUD ships in Phase 5; the `Authorization: Bearer pak_*` lookup middleware MAY defer to Phase 6.
   - What's unclear: whether shipping CRUD without auth enablement strands users (they create keys that don't authenticate yet).
   - **RESOLVED:** ship CRUD only in Phase 5. Document keys as "prepared but inert until Phase 6 enablement" in the create response and operator docs. Justification: Phase 5 is already large; the middleware is small but its threat model + scope-check logic + rate-limit-per-key + revocation lookup require their own design pass that belongs with Phase 6's anti-abuse work.

4. **Settings JSONB schema evolution**
   - What we know: D-17 stores `stt_config` and `note_recording_config` as JSONB.
   - What's unclear: how Phase 7 UI will validate / migrate the JSONB shape when adding/removing keys.
   - **RESOLVED:** deferred to Phase 7 ADR. For Phase 5, ship a Zod schema for each JSONB blob and validate on read (server-side defaults override invalid fields). Permissive on write would be Phase 7's call.

5. **`POST /api/v1/keys/:id/revoke` — included in Phase 5?**
   - What we know: `ApiKeysService.ts` exports `revokeApiKey` (POST). CONTEXT.md D-29 lists only list+create; the service file includes revoke.
   - What's unclear: whether revoke is in scope.
   - **RESOLVED:** include revoke in WIRE-27 scope. A `revoked_at` column already exists per D-29 schema; the route is trivial; clients use it. Excluding it strands users with keys they cannot revoke until Phase 6.

6. **`notes/delete-all` inline vs queued**
   - What we know: D-30 / Claude's Discretion — cap inline at 1000 rows before queueing via BullMQ.
   - What's unclear: how to communicate "your delete is in progress" to the client.
   - **RESOLVED:** Phase 5 ships INLINE-only with a 1000-row cap. >1000 → 400 with envelope `{error: "delete-all exceeds 1000 rows; please delete in batches"}`. BullMQ-driven async delete defers to Phase 6 with its workers infra.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 17 (via PgBouncer transaction-mode) | Every CRUD migration + RLS + tsvector + keyset | ✓ | 17 per existing compose | — |
| Valkey 8 | `@fastify/rate-limit` per-route store + (future) BullMQ | ✓ | per Phase 1 | — |
| Node 24 LTS + `globalThis.fetch` (undici) | Tavily / Yandex outbound | ✓ | per Phase 0 | — |
| Tavily account + `TAVILY_API_KEY` | WIRE-08 default web-search provider | env-dependent | n/a | 503 {error: "Tavily not configured"} per D-08 |
| Yandex Cloud account + `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` | WIRE-08 when WEB_SEARCH_PROVIDER=yandex | env-dependent | n/a | 503 envelope; provider selection at boot fatally fails if env points to yandex without keys |
| `@node-rs/argon2` 2.0.2 | WIRE-27 API key hashing | needs install | 2.0.2 | `argon2` 0.44.0 as backup |
| Existing testcontainer infra (Postgres + PgBouncer + Valkey) | TEST-RLS-01 extension, every integration test | ✓ | per Phase 1 | — |
| User-provided Yandex reference (`/Users/dev/Downloads/server.py`) | Plan 04 Yandex adapter design | ✗ (macOS Downloads sandbox EPERM) | n/a | **BLOCKING — must move into repo** |

**Missing dependencies with no fallback:**
- User-provided Yandex reference file — BLOCKS Plan 04 design fidelity.

**Missing dependencies with fallback:**
- Tavily / Yandex API keys missing at runtime → 503 by design (D-08). Not a build blocker.

## Validation Architecture

Per `.planning/config.json` `workflow.nyquist_validation = true`, validation is mandatory.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (from Phase 0; verified present in `packages/contract-tests/src/*`) |
| Config file | `vitest.config.ts` at repo root + per-package overrides |
| Quick run command | `pnpm --filter @openwhispr/api test -- --run` |
| Full suite command | `pnpm -r test --coverage && make contract-test && make e2e-test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-08 | web-search returns {results:[{title,url,snippet}]} via Tavily | contract | `pnpm --filter @openwhispr/contract-tests test src/web-search.test.ts` | ❌ Wave 0 |
| WIRE-08 | web-search 503 when TAVILY_API_KEY missing | contract | same file, "missing-key" case | ❌ Wave 0 |
| WIRE-08 | web-search 502 on upstream 5xx | unit | `pnpm --filter @openwhispr/api test apps/api/src/lib/web-search/__tests__/tavily.test.ts` | ❌ Wave 0 |
| WIRE-08 | web-search Yandex snippet normalization | unit | `apps/api/src/lib/web-search/__tests__/yandex.test.ts` | ❌ Wave 0 |
| WIRE-08 | web-search registry boots fatally on unknown WEB_SEARCH_PROVIDER | unit | `apps/api/src/lib/web-search/__tests__/registry.test.ts` | ❌ Wave 0 |
| WIRE-08 | usage_ledger row inserted per call with kind=web-search.<provider> | integration | `apps/api/src/routes/__tests__/web-search.integration.test.ts` (testcontainer pg+pgbouncer) | ❌ Wave 0 |
| WIRE-08 | rate-limit 30/min/user via Valkey | integration | same file + Valkey container | ❌ Wave 0 |
| WIRE-08 | E2E: end-to-end via real Traefik with TAVILY_API_KEY | e2e | `make e2e-test` Phase 5 spec | ❌ Wave 0 |
| WIRE-09 | streaming-usage idempotent on sessionId (200 not 409 on retry) | integration | `apps/api/src/routes/__tests__/streaming-usage.integration.test.ts` | ❌ Wave 0 |
| WIRE-09 | streaming-usage logs SHA-256 + 200-char preview (sendLogs=false) | unit | `apps/api/src/routes/__tests__/streaming-usage.test.ts` (log-capture) | ❌ Wave 0 |
| WIRE-09 | streaming-usage logs 1000-char preview when sendLogs=true | unit | same file | ❌ Wave 0 |
| WIRE-09 | wire shape accepts 14 fields per BACKEND_SPEC.md:377 | contract | `packages/contract-tests/src/streaming-usage.test.ts` | ❌ Wave 0 |
| WIRE-10 | /api/usage returns {wordsUsed, wordsRemaining:999999999, plan:unlimited, limitReached:false} | contract | `packages/contract-tests/src/usage.test.ts` | ❌ Wave 0 |
| WIRE-10 | wordsUsed = SUM(units) across all kinds | integration | `apps/api/src/routes/__tests__/usage.integration.test.ts` | ❌ Wave 0 |
| WIRE-11 | stt-config resolution chain user→tenant→env | unit + integration | `apps/api/src/routes/__tests__/stt-config.test.ts` | ❌ Wave 0 |
| WIRE-11 | availableProviders computed from env at request time | unit | same file | ❌ Wave 0 |
| WIRE-12 | note-recording-config defaults + override layering | unit + integration | `apps/api/src/routes/__tests__/note-recording-config.test.ts` | ❌ Wave 0 |
| WIRE-16 | cloud-api-request envelope passthrough on every 4xx/5xx | contract (negative matrix) | `packages/contract-tests/src/negative-matrix.test.ts` | ❌ Wave 0 |
| WIRE-22 | notes CRUD round-trip | integration | `apps/api/src/routes/notes/__tests__/crud.integration.test.ts` | ❌ Wave 0 |
| WIRE-22 | notes search (tsvector) returns ranked SearchResult with score | integration | `apps/api/src/routes/notes/__tests__/search.integration.test.ts` (real PG) | ❌ Wave 0 |
| WIRE-22 | notes batch-create idempotent on client_note_id | integration | `apps/api/src/routes/notes/__tests__/batch-create.integration.test.ts` | ❌ Wave 0 |
| WIRE-22 | notes keyset list correctly paginates with before/since | integration | `apps/api/src/routes/notes/__tests__/list.integration.test.ts` | ❌ Wave 0 |
| WIRE-22 | notes delete-all caps at 1000 inline | integration | `apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts` | ❌ Wave 0 |
| WIRE-22 | notes soft-delete `deleted_at` not returned in list | integration | same | ❌ Wave 0 |
| WIRE-22 | notes contract conformance | contract | `packages/contract-tests/src/notes.test.ts` | ❌ Wave 0 |
| WIRE-23 | folders CRUD + batch + list w/ since | integration + contract | `apps/api/src/routes/folders/__tests__/`, `packages/contract-tests/src/folders.test.ts` | ❌ Wave 0 |
| WIRE-24 | conversations CRUD + list include=messages + search | integration + contract | `apps/api/src/routes/conversations/__tests__/`, contract file | ❌ Wave 0 |
| WIRE-25 | conversations messages add + list keyset | integration | `apps/api/src/routes/conversations/__tests__/messages.integration.test.ts` | ❌ Wave 0 |
| WIRE-26 | transcriptions CRUD + batch-create + batch-delete | integration + contract | files | ❌ Wave 0 |
| WIRE-26 | transcriptions create idempotent on client_transcription_id | integration | same | ❌ Wave 0 |
| WIRE-27 | api-keys create returns clear-text once + {data:T} envelope | contract | `packages/contract-tests/src/api-keys.test.ts` | ❌ Wave 0 |
| WIRE-27 | api-keys list returns key_prefix only (no key, no hash) | contract | same | ❌ Wave 0 |
| WIRE-27 | api-keys Argon2id hash format $argon2id$v=19$m=65536 | unit | `apps/api/src/lib/__tests__/argon2-keys.test.ts` | ❌ Wave 0 |
| WIRE-27 | api-keys revoke sets revoked_at and key cannot be verified | integration | `apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts` | ❌ Wave 0 |
| WIRE-28 | tenant_settings + user_settings tables with RLS + FORCE RLS | integration (testcontainer) | `packages/data/src/__tests__/settings-rls.test.ts` | ❌ Wave 0 |
| WIRE-28 | AFTER INSERT trigger seeds tenant_settings on tenant create | integration | same | ❌ Wave 0 |
| WIRE-28 | backfill INSERT during migration touches every existing tenant | integration | `packages/data/src/__tests__/migration-0006-backfill.test.ts` | ❌ Wave 0 |
| WIRE-29 | negative matrix: every route + synthetic 404 returns envelope | contract | `packages/contract-tests/src/negative-matrix.test.ts` | ❌ Wave 0 |
| WIRE-29 | matrix enumeration uses fastify.printRoutes() not hardcoded list | unit | same | ❌ Wave 0 |
| Cross-cutting: RLS isolation | every new table | property (fast-check 100 pairs) | extend `packages/data/src/__tests__/rls-property.test.ts` | ✓ extend |
| Cross-cutting: usage-ledger idempotency | streaming-usage + web-search | property | `apps/api/src/routes/__tests__/ledger-idempotency.property.test.ts` | ❌ Wave 0 |
| Cross-cutting: error envelope on every 4xx/5xx | every route | contract (negative matrix) | covered by WIRE-29 | ❌ Wave 0 |
| Cross-cutting: rate-limit envelope conformance | web-search 30/min | integration | `apps/api/src/routes/__tests__/web-search-ratelimit.integration.test.ts` | ❌ Wave 0 |
| Cross-cutting: observability (OTel span attrs) | streaming-usage rich metadata | unit (log + span capture) | `apps/api/src/routes/__tests__/streaming-usage-observability.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter <package-touched> test -- --run` (under 30s).
- **Per wave merge:** `pnpm -r test --coverage && make contract-test` (CONTRACT-01 conformance + coverage gate).
- **Per phase gate (before `/gsd-verify-work`):** full suite — `pnpm -r test --coverage && make contract-test && make e2e-test`. Per CLAUDE.md, E2E is **mandatory** for verification.
- **Nightly:** `make e2e-test` against live Tavily key when available (Yandex skip-gated if reference not yet integrated).

### Wave 0 Gaps

The vast majority of test files do not yet exist. Wave 0 (Plan 01) installs them as failing-RED first per CLAUDE.md TDD discipline:

- [ ] `packages/wire-schemas/src/{notes,folders,conversations,transcriptions,api-keys,streaming-usage,web-search}.ts` — Zod schemas
- [ ] `packages/contract-tests/src/{notes,folders,conversations,transcriptions,api-keys,streaming-usage,usage,stt-config,note-recording-config,web-search,negative-matrix}.test.ts` — 11 contract test files
- [ ] `apps/api/src/routes/**/__tests__/*.test.ts` — per-route unit + integration
- [ ] `apps/api/src/lib/__tests__/{argon2-keys,keyset-pagination,soft-delete,client-id-upsert}.test.ts` — helper tests
- [ ] `apps/api/src/lib/web-search/__tests__/{tavily,yandex,registry}.test.ts` — adapter tests
- [ ] `packages/data/src/__tests__/{settings-rls,migration-0006-backfill,migration-0007..0010-rls}.test.ts` — DB-side
- [ ] Extend `packages/data/src/__tests__/rls-property.test.ts` to cover 8 new tables (fast-check 100 pairs each)
- [ ] Extend `packages/data/src/seed/conformance.ts` to seed every new resource with deterministic IDs for CONTRACT-01
- [ ] `tests/e2e/phase-05-*.spec.ts` — e2e flows: full CRUD round-trip per resource, web-search live-Tavily gating, streaming-usage idempotency under retry

**Framework install:** None needed — Vitest 4, fast-check, testcontainers, and undici are all present from Phases 0–4.

## Security Domain

Per `.planning/PROJECT.md` constitutional rules, `security_enforcement` is implicitly enabled (not disabled). Phase 5 introduces meaningful new attack surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth dual-auth (Bearer + cookie) — existing Phase 2. NEW: `pak_*` API keys hashed Argon2id (D-29). |
| V3 Session Management | yes | Better Auth opaque bearer (Phase 2). API keys do NOT create sessions — they're stateless bearers. |
| V4 Access Control | yes | RLS on every new table via `app.tenant_id` GUC. Authorization scope = tenant + user. |
| V5 Input Validation | yes | Zod schemas at `packages/wire-schemas/` for every route. `websearch_to_tsquery` for search input safety. |
| V6 Cryptography | yes | `@node-rs/argon2` 2.0.2 for API keys (Argon2id, OWASP params). `crypto.randomBytes` for clear-text generation. **Never hand-roll.** |
| V7 Errors & Logging | yes | Global envelope handler (Phase 2). Streaming-usage: SHA-256 hash + length only, no full transcript (D-13). API keys: never logged. |
| V8 Data Protection | yes | API key clear-text returned **once** on creation (D-28). `key_hash` Argon2id at rest. Sensitive JSONB in settings tables — Phase 1 KEK/DEK envelope optionally applies (defer to Phase 6 hardening). |
| V10 Web Service / API | yes | All HTTPS, rate-limited, RLS-bounded. CONTRACT-01 negative matrix (D-33) proves envelope invariant. |
| V11 Configuration | yes | No-default-secrets gate (Phase 1) extends — `TAVILY_API_KEY` / `YANDEX_SEARCH_API_KEY` / `YANDEX_FOLDER_ID` join the deny-list known-bad list. |
| V12 Files & Resources | partial | Web-search returns URLs but does NOT fetch them server-side (no SSRF — see Pitfall #10). |
| V13 API & Web Service | yes | OWASP API Top 10 — BOLA (broken object-level auth) addressed by RLS; mass-assignment addressed by Zod schemas restricting body fields. |

### Known Threat Patterns for Phase 5

| Threat | STRIDE | Standard Mitigation |
|--------|--------|---------------------|
| API key leak via list endpoint | Information Disclosure | Return `key_prefix` only; clear-text returned once on create then dropped (D-28) |
| API key brute-force | Spoofing | Argon2id (intentionally slow) + rate-limit on the future `Bearer pak_*` lookup endpoint (Phase 6) |
| API key DoS via Argon2id CPU spike | Denial of Service | `@node-rs/argon2` uses async tokio threadpool; rate-limit `POST /api/v1/keys/create` to 5/hour/user |
| Tenant boundary leak via crafted client_id | Tampering | RLS on `(tenant_id)` in policy; partial unique index scoped to `(tenant_id, user_id, client_*_id)`; cross-tenant property test (TEST-RLS-01 extension) |
| tsquery injection / DoS | Denial of Service / Tampering | `websearch_to_tsquery` (never raises errors); query length capped at 256 chars in Zod; GIN index ensures bounded execution time |
| SSRF via Tavily/Yandex callback | (None — we don't follow returned URLs) | Server-side `fetch` only hits the configured provider endpoint; user-supplied query is body-only, never URL path |
| Web-search query log leak | Information Disclosure | Truncate query in logs to 200 chars (same policy as streaming-usage D-13) |
| Batch-create DoS (500-item flood) | DoS | D-30 max 500 items + 5 req/min rate-limit on batch endpoints + transaction timeout 10s |
| Idempotency key collision attack (sessionId guessing) | Tampering | sessionId is server-validated for length and format; INSERT … ON CONFLICT returns existing row only if tenant_id+user_id match the calling session (RLS-enforced) |
| Soft-delete bypass via direct id query | Tampering | All read paths filter `WHERE deleted_at IS NULL`; soft-delete-aware unit tests enforce |
| Settings injection via JSONB | Tampering | Zod schema validates JSONB shape on read (server-side defaults override unknown keys per D-19 resolution) |
| Argon2id parameter downgrade | Tampering | Hash includes params; verify checks them; constant params in code (no runtime override) |
| Conversation message metadata injection | Tampering | `metadata` Zod schema; size-cap at 4KB per message; SQL-safe via parameterized inserts |
| Web-search rate-limit bypass via session reuse | DoS | `@fastify/rate-limit` keyed on `session.userId` via Valkey (D-07); same proven pattern as Phase 4 D-19 |

**Residual risks (documented; not fixed in Phase 5):**
- API key revocation latency — until Phase 6 middleware lands, revoked keys cannot be invalidated at the request boundary because there is no `Bearer pak_*` path yet. Phase 5 ships the revoke endpoint; revocation only takes effect when Phase 6 enables the auth path.
- `'simple'` text-search config doesn't stem en/ru content (Pitfall #9) — documented as known v1 behavior.
- JSONB settings have no operator-supplied schema versioning — Phase 7 ADR.

## Sources

### Primary (HIGH confidence)
- `/Users/dev/openwhispr-server/.planning/phases/05-operational-endpoints/05-CONTEXT.md` — 36 locked design decisions (D-01..D-36).
- `/Users/dev/openwhispr/src/services/{Notes,Folders,Conversations,Transcriptions,ApiKeys}Service.ts` — authoritative wire shape via TypeScript interfaces (read in full).
- `/Users/dev/openwhispr/src/services/cloudApi.ts` — passthrough mechanics + V1Response envelope.
- `/Users/dev/openwhispr-server/apps/api/src/routes/transcribe.ts` — Phase 3 ledger idempotency pattern (lines 130-136); web-search and streaming-usage mirror this.
- `/Users/dev/openwhispr-server/apps/api/src/routes/realtime.ts` — Phase 4 env-key 503 + undici 3s/5s timeout pattern.
- `/Users/dev/openwhispr-server/packages/data/src/schema/usage_ledger.ts` — schema reused with new kinds (`streaming-stt`, `web-search.tavily`, `web-search.yandex`).
- `/Users/dev/openwhispr-server/packages/contract-tests/src/` — Phase 2-3-4 contract suite (24 existing test files); Phase 5 extends with 11 new files.
- [docs.tavily.com — POST /search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) — full request/response shape verified.
- [PostgreSQL 18 / Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html) — `websearch_to_tsquery` safety for raw user input.
- [Drizzle ORM Full-text search with Generated Columns](https://orm.drizzle.team/docs/guides/full-text-search-with-generated-columns) — tsvector pattern.
- [Sequin Stream — Keyset Cursors for Postgres Pagination](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/) — tuple comparison pattern.
- [OWASP CheatSheetSeries Issue #1183 — Argon2 RFC 9106 recommended values](https://github.com/OWASP/CheatSheetSeries/issues/1183) — Argon2id m=64MB/t=3/p=1.
- [@node-rs/argon2 on npm](https://www.npmjs.com/package/@node-rs/argon2) — version 2.0.2 + API surface.
- npm registry version verification: argon2 0.44.0, @node-rs/argon2 2.0.2, drizzle-orm 0.45.2, drizzle-kit 0.31.10, @fastify/rate-limit 10.3.0, zod 4.4.3 (verified via `npm view`).

### Secondary (MEDIUM confidence)
- [Yandex Search API docs (AI Studio) — index page](https://aistudio.yandex.ru/docs/en/search-api/) — confirmed v1 deprecated 2025-09-30; v2 sync + async modes; auth via service-account Api-Key + folder-id. Specific endpoint URL and response field names need user-reference verification.
- [yandex-search-api PyPI](https://pypi.org/project/yandex-search-api/) — confirms XML response in deferred mode + `passages`/`passage` field naming.
- [PyPI / Yandex Search Engine Results API references](https://serpapi.com/yandex-search-api) — supplementary.

### Tertiary (LOW confidence)
- Yandex API v2 sync endpoint URL exact path (`/v2/web/searchSync` assumed) — flagged in Assumptions A1.
- Yandex auth header format (`Authorization: Api-Key <key>` assumed over IAM Bearer) — A2.
- Yandex snippet response field name (`passages` assumed) — A3.
- These ALL resolve once `/Users/dev/Downloads/server.py` is moved into the repo by the user.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified against npm registry on research date.
- Architecture patterns: HIGH — every pattern mirrors a proven Phase 1–4 pattern in this codebase.
- Tavily adapter: HIGH — endpoint, auth, request/response verified via official docs.
- Yandex adapter: LOW until user reference moves in; MEDIUM otherwise (public docs confirm shape but not field names).
- Settings tables (D-21 trigger): MEDIUM-HIGH — Pitfall #8 corrected from BEFORE to AFTER INSERT trigger; verify in integration test before locking.
- CONTRACT-01 negative matrix: HIGH — Phase 2-4 contract suite is mature; matrix is mechanical extension.
- Validation Architecture: HIGH — every requirement has a concrete automated command and target test file.
- Security domain: HIGH — ASVS categories cross-referenced; threat patterns concrete; mitigations all use proven mainstream libraries.

**Research date:** 2026-05-11
**Valid until:** 2026-06-10 (30 days for stable areas); Yandex specifics valid only after user reference integration (revisit on Plan 04 start).
