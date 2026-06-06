# OpenWhispr Server — v1 Wire Contract

Authoritative reference for the v1 implemented wire surface, v2-deferred
surface, and known v1 limitations. Source of truth: upstream
`SELF_HOSTING.md` / `BACKEND_SPEC.md` / `OAUTH_SPEC.md` (1556 lines)
cross-referenced against the implemented Phase 2-5 plans in this repo.

For envelope shape conventions (D-33 / D-34 / D-35) see
`docs/conventions.md`.

For the regression net asserting envelope conformance across the whole
surface, see `packages/contract-tests/src/negative-matrix.test.ts`
(CONTRACT-01 negative matrix; Pitfall #6 enumeration sanity at
`packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts`).

---

## v1 Implemented (Phase 2-5)

### Phase 2 — Auth + Wire Skeleton (WIRE-01..04, WIRE-17..20, AUTH-01..07)

| Route                                       | Method  | Auth         | Notes |
| ------------------------------------------- | ------- | ------------ | ----- |
| `/api/health`                               | GET     | none         | WIRE-04, rateLimit:false |
| `/api/check-user`                           | POST    | none         | WIRE-01 |
| `/api/auth/verification-status?email=`      | GET     | cookie-only  | WIRE-02 |
| `/api/auth/delete-account`                  | DELETE  | cookie-only  | WIRE-03; cascading delete + audit |
| `/api/auth/*` (Better Auth universal)       | ALL     | varies       | sign-in / sign-out / verify-email / etc. |
| `/api/desktop-signin/:provider`             | GET     | none         | AUTH-02; OAuth shim w/ scheme allow-list |
| `/api/auth/desktop-callback/:provider`      | GET     | none         | AUTH-02; protocol redirect w/ bearer mint |

### Phase 3 — LiteLLM-backed AI Plane (WIRE-05..06, LITELLM-01..07, PROVIDER-01)

| Route                            | Method | Auth   | Notes |
| -------------------------------- | ------ | ------ | ----- |
| `/api/transcribe`                | POST   | bearer | multipart audio → Whisper via LiteLLM |
| `/api/reason`                    | POST   | bearer | LLM completion; shape-keyed prompt + model routing (R33) |
| `/v1/realtime`                   | WSS    | bearer | OpenAI Realtime / Speaches reverse-proxy |

#### `/api/reason` — prompt selection + model routing (R33)

`/api/reason` serves two request classes off the SAME body schema; the
server selects the persona and model from the request **shape** alone —
the immutable desktop client sends no `systemPrompt` on the cloud
cleanup path.

**Cleanup shape** — `agentName` absent (`null`/missing) AND `systemPrompt`
absent AND `model` empty/absent (`null`, missing, or `""`). This is the
dictation-cleanup path. The server:

- prepends a **cleanup system message** chosen by a two-tier precedence:
  1. `body.customPrompt` when non-empty (`trim().length > 0`) — the
     user's Prompt-Studio cleanup override, used **verbatim**;
  2. else the **localized server default** `prompts.cleanupPrompt`
     (from `apps/api/src/i18n/locales/{en,ru}.json`; locale resolved from
     `body.language` → `body.locale` → request `Accept-Language` → `en`).
  A blank/whitespace `customPrompt` falls through to the localized
  default — it never sends an empty system message. The `{{agentName}}`
  token inside the localized prompt is intentionally a literal
  (anti-injection framing), not interpolated;
- routes to the operator-owned **cleanup-class model**
  (`REASONING_CLEANUP_MODEL`, bundled default `qwen3.6-cleanup`);
- disables reasoning/thinking by sending
  `extra_body.chat_template_kwargs.enable_thinking: false` in the
  upstream chat-completions **request body** (Qwen3 chat-template kwarg —
  it is NOT a `litellm_config.yaml` setting).

**Agent shape** — `agentName` set OR `systemPrompt` provided OR `model`
non-empty. Conversational behaviour: `systemPrompt` (when present) is the
system message, an `agentName`-only request sends no system message,
the model is `body.model` → `LITELLM_DEFAULT_CHAT_MODEL` →
`DEFAULT_CHAT_MODEL`, and **no** thinking-off field is sent.

An explicit non-empty `body.model` always wins in both shapes. The
response shape (`text`/`model`/`provider`/`promptMode`/`matchType`) is
unchanged — `promptMode`/`matchType` remain the constant `"default"`
echo (R23).

### Phase 4 — Streaming + Token Mints (WIRE-07, WIRE-13..15, SCALE-05)

| Route                              | Method | Auth   | Notes |
| ---------------------------------- | ------ | ------ | ----- |
| `/api/agent/stream`                | POST   | bearer | NDJSON; chunk vocab `content` / `tool_call` / `done` (R32 — matches the desktop client's cloud stream consumer; `tool_call.arguments` is a raw JSON string; tools execute client-side so no `tool_result` is emitted) |
| `/api/streaming-token`             | POST   | bearer | AssemblyAI v3 ephemeral token |
| `/api/deepgram-streaming-token`    | POST   | bearer | Deepgram ephemeral token |
| `/api/openai-realtime-token`       | POST   | bearer | OpenAI Realtime ephemeral client_secret |

### Phase 15 — Public locale negotiation (TD-15.g)

| Route          | Method | Auth | Notes |
| -------------- | ------ | ---- | ----- |
| `/api/locale`  | GET    | none | Read-only locale negotiation; honors `Accept-Language` |

`GET /api/locale` is a public, read-only endpoint that returns the
locale negotiated by `i18next-http-middleware` from the request's
`Accept-Language` header. It exists for two callers:

1. The desktop client / web app reads it on first load (before the
   user's language preference cookie exists) to render the initial
   shell in the correct locale.
2. The Phase 13 `@cjm-6.2` and Phase 15 `@cjm-traefik-host-split`
   Gherkin oracles assert it as proof that `api.localhost` host-split
   routing reaches the Fastify API container (not the Next.js web
   container).

**Method + path:** `GET /api/locale`

**Auth:** none (public, exposed at the public edge).

**Request:**

- Headers:
  - `Accept-Language: <RFC 9110 language-priority list>` (optional;
    `i18next-http-middleware` reads this and selects the best match
    from `supportedLngs: ['en','ru']`). If absent, the response is
    `{"locale":"en"}` (the configured `fallbackLng`).

**Response (always 200 OK):**

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"locale":"en"}
```

or, when `Accept-Language: ru` (or `ru-RU`, etc.) is supplied:

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"locale":"ru"}
```

**Response body schema (info-leak gate, unit-tested):** the JSON object
contains EXACTLY one key, `locale`, whose value is one of `"en"` or
`"ru"`. Adding a field requires extending the unit test at
`apps/api/tests/unit/routes/__tests__/locale.test.ts` that asserts the
exact key set.

**Status codes:** `200 OK` only (no error paths — the handler never
throws on valid HTTP framing).

**Rate limit:** `60 requests / minute / IP`, matching `/api/auth/providers`
(the other unauthenticated discovery endpoint exposed at the public
edge). Enforced by `@fastify/rate-limit` via the route's
`config.rateLimit` block (`apps/api/src/routes/locale.ts:72`).

**Cache directives:** `cache-control: no-store` — the negotiated locale
depends entirely on the per-request `Accept-Language` header; caching
would poison clients behind shared upstream proxies. Body is tiny so
cache hits would save negligible bytes.

**Wire-compat note:** introduced in Phase 15 / Plan 02 / Task 1 as the
TD-15.g closure (public locale negotiation endpoint). Source:
`apps/api/src/routes/locale.ts`. The route ships unconditionally
(wired in `apps/api/src/routes/index.ts:236-240`); there is no feature
flag. Because the endpoint is read-only and stateless, future
extensions (e.g. exposing the resolved `supportedLngs` set) MUST add
new keys rather than renaming `locale`.

---

### Phase 5 — Operational Endpoints + CRUD Families (WIRE-08..12, WIRE-16, WIRE-22..29)

| Route                                 | Method      | Auth    | WIRE | Notes |
| ------------------------------------- | ----------- | ------- | ---- | ----- |
| `/api/streaming-usage`                | POST        | bearer  | 09   | idempotent ledger insert |
| `/api/usage`                          | GET         | bearer  | 10   | SUM aggregator; response `{wordsUsed, wordsRemaining, plan:"unlimited", limitReached:false, isSubscribed:true, isTrial:false}` — R34: `isSubscribed`/`isTrial` are read by the desktop useUsage hook, `canSync()` gates cloud sync on `isSubscribed` |
| `/api/agent/web-search`               | POST        | bearer  | 08   | Tavily + Yandex adapters (D-02 boot-fatal on unknown provider) |
| `/api/stt-config`                     | GET         | bearer  | 11   | user_settings → tenant_settings → env defaults |
| `/api/note-recording-config`          | GET         | bearer  | 12   | same resolution chain |
| `/api/notes/create`                   | POST        | bearer  | 22   | client_note_id idempotency |
| `/api/notes/batch-create`             | POST        | bearer  | 22   | 500-item cap |
| `/api/notes/update`                   | PATCH       | bearer  | 22   |       |
| `/api/notes/delete`                   | DELETE      | bearer  | 22   | soft-delete |
| `/api/notes/delete-all`               | DELETE      | bearer  | 22   | 1000-row inline cap (>1000 → 400) |
| `/api/notes/list`                     | GET         | bearer  | 22   | keyset pagination |
| `/api/notes/search`                   | POST        | bearer  | 22   | `websearch_to_tsquery('simple', ...)` |
| `/api/folders/{create,batch-create,update,delete,list}` | POST/PATCH/DELETE/GET | bearer | 23 | mirrors notes pattern; no search, no delete-all |
| `/api/conversations/{create,update,delete,list,search}` | POST/PATCH/DELETE/GET | bearer | 24 |  |
| `/api/conversations/messages`         | POST + GET  | bearer  | 25   | dual-method; 4 KiB metadata cap |
| `/api/transcriptions/{create,batch-create,list,delete,batch-delete}` | POST/GET/DELETE | bearer | 26 | storage-only, NO ledger writes |
| `/api/v1/keys/list`                   | GET         | bearer  | 27   | `{data: {keys: [...]}}` envelope (D-28) |
| `/api/v1/keys/create`                 | POST        | bearer  | 27   | `{data: {...key, key: "pak_..."}}` — clear-text returned ONCE |
| `/api/v1/keys/:id/revoke`             | POST        | bearer  | 27   | idempotent soft-revoke |

WIRE-16 (envelope passthrough invariant) is asserted by
`packages/contract-tests/src/negative-matrix.test.ts`. WIRE-28
(tenant_settings + user_settings storage) is exercised by Plans 01 + 04.
WIRE-29 (negative-matrix CONTRACT-01 extension) is the regression net
proving WIRE-16 holds across the entire surface.

#### Sync-endpoint INPUT contract — lenient input, strict output (R35)

The immutable desktop client stores rows in local SQLite. Two of its
field shapes do not match the strict RFC-3339 / enum forms the server
emits, so the cloud-sync POST endpoints accept a deliberately **lenient
INPUT** while the `Cloud*` **RESPONSE** schemas remain **strict**. The
input/output asymmetry is intentional and load-bearing.

- **`created_at` / `updated_at` (transcription / note / conversation
  INPUT).** Accepted in BOTH RFC-3339 `T`-form (`"2026-05-22T16:05:11Z"`)
  AND the SQLite space form `"YYYY-MM-DD HH:MM:SS"`
  (`"2026-05-22 16:05:11"`), optionally with fractional seconds and/or a
  `Z`/`±HH:MM` offset. The value is normalized server-side to canonical
  RFC-3339 (`packages/wire-schemas/src/input-datetime.ts` —
  `INPUT_DATETIME`). Structurally-invalid strings and impossible calendar
  dates (`"2026-02-30 ..."`, month 13) are still rejected with 400.
  `folders` has no datetime INPUT field. Note: the sync routes today let
  Postgres apply the column default for these timestamps; the client
  string is validated then discarded.
- **`status` (transcription INPUT only).** Accepted as any string ≤ 256
  chars (the client's local SQLite `status` is unconstrained free text).
  An unknown value is mapped server-side to a canonical
  `TranscriptionStatus` (`pending|processing|completed|failed`, fallback
  `completed`) before the row is stored — see `normalizeTranscriptionStatus()`
  in `apps/api/src/routes/transcriptions/shape.ts`.
- **`messages[].metadata` (conversation INPUT) — R36.** Accepted as
  absent, an explicit `null`, OR a populated metadata object
  (`MetadataSchema.nullish()`). The immutable client's `SyncService`
  maps every message `metadata: m.metadata ? (...) : null`, so a message
  without metadata carries an explicit `null`; `.optional()` alone
  rejected it and 400'd every conversation sync.
- **`note_type` (note INPUT) — R37.** Accepted as any string ≤ 1024
  chars (the client's local SQLite `note_type` is unconstrained free
  text `TEXT NOT NULL DEFAULT 'personal'` — it can hold values outside
  the canonical enum, e.g. `"note"`). An unknown value is mapped
  server-side to a canonical `NoteType` (`personal|meeting|upload`,
  fallback `personal`) before the row is stored — see
  `normalizeNoteType()` in `apps/api/src/routes/notes/shape.ts`. The
  `CloudNote` RESPONSE `note_type` stays the strict enum.
- **`Cloud*` RESPONSE schemas stay strict.** `CloudTranscription`,
  `CloudNote`, `CloudConversation`, `CloudMessage`, `CloudFolder` and
  `SearchResult` keep `z.string().datetime({ offset: true })` for every
  datetime and the 4-value `TranscriptionStatusSchema` enum for status.
  The server never emits the SQLite space form or a non-enum status.

---

## v2 Deferred

The following endpoints exist in the upstream client's
`cloud-api-request` passthrough but are NOT implemented in v1. They
surface today as **HTTP 404 with the canonical
`{error: "Not Found"}` envelope** via Phase 2's
`setNotFoundHandler` (D-35). The CONTRACT-01 negative matrix asserts
this behavior (T-OUT-OF-SCOPE-LEAK mitigation).

### Stripe billing

Upstream `~/openwhispr/docs/BACKEND_SPEC.md:567-700` documents Stripe
billing endpoints. The desktop client gates each on a feature flag
that defaults to "self-hosted-without-billing", so 404 is the right
operator UX in v1.

| Route                         | Method | Status today |
| ----------------------------- | ------ | ------------ |
| `/api/stripe/checkout`        | POST   | 404 + envelope (v2-deferred) |
| `/api/stripe/portal`          | POST   | 404 + envelope (v2-deferred) |
| `/api/stripe/switch-plan`     | POST   | 404 + envelope (v2-deferred) |
| `/api/stripe/preview-switch`  | POST   | 404 + envelope (v2-deferred) |

### Referrals

Upstream `BACKEND_SPEC.md:700-720`. Same posture as Stripe.

| Route                       | Method | Status today |
| --------------------------- | ------ | ------------ |
| `/api/referrals/stats`      | GET    | 404 + envelope (v2-deferred) |
| `/api/referrals/invite`     | POST   | 404 + envelope (v2-deferred) |
| `/api/referrals/invites`    | GET    | 404 + envelope (v2-deferred) |

---

## Known v1 Limitations

These are intentional v1 tradeoffs documented for operator transparency
and for the verifier agent's gap-tracking. Each has a planned
remediation phase.

### Search: no en/ru morphological stemming

Notes and conversations search uses the `'simple'` tsvector
configuration (Pitfall #9, accepted). Queries match exact word forms
only — Russian inflection (e.g. "vstrecha" (RU "meeting") ↔ "vstrechi" (RU plural)) and English
plurals (e.g. "note" ↔ "notes") are NOT matched.

**Remediation:** revisit at v1.x when per-tenant locale config lands;
candidates are `'russian'` and `'english'` Postgres configurations
(swap-in is migration-only, no API surface change).

### `notes/delete-all` inline 1000-row cap

`DELETE /api/notes/delete-all` performs the delete inline in the
request transaction. For users with > 1000 notes the route returns
`400 {"error":"too many notes; bulk delete must be queued"}`.

**Remediation:** Phase 6 wires a BullMQ-backed async path
(`delete-all-job`) that the route enqueues and returns 202 + a
job-status URL.

### `Bearer pak_*` API key middleware deferred

`/api/v1/keys/*` ships the CRUD (issuance + list + revoke) in Phase 5,
but the middleware that accepts `Authorization: Bearer pak_*` for
programmatic-access keys is not wired yet. Issuing a key and using it
in v1 will fail with 401 — the routes prepare for Phase 6 enablement
(D-29 / Open Q#3).

**Remediation:** Phase 6 wires the `pak_*` prefix middleware between
the existing dual-auth hook (cookie + Better Auth bearer) and the
route handler. The Argon2id hash format and lookup are already in
place.

### 100-message-per-conversation cap on `?include=messages`

`GET /api/conversations/list?include=messages` returns at most 100
messages per conversation in the response. The cap is enforced
server-side to bound the response payload; a separate
`GET /api/conversations/messages?conversation_id=...&before=...`
keyset-paginated endpoint serves the long tail.

**Remediation:** Open Q#2 — Phase 8 load probe will validate the
100-cap against real-world conversation lengths; raise or lower with
production data.

### Yandex Search adapter — live reference pending

Plan 03 Task 1 wired both the Tavily and Yandex adapters; Tavily is
verified end-to-end. The Yandex adapter is structurally complete but
its live response shape is asserted against documented schema rather
than a captured reference response (vendor sandbox access pending —
keys due 2026-05-12 per memory).

**Remediation:** once a live Yandex reference is captured, the
adapter's response-parsing test flips from doc-shape to byte-shape.
No wire-surface change.

### Settings tables: READ-only in v1

`tenant_settings` and `user_settings` ship in Phase 5 (Plans 01 + 04)
with FORCE RLS + JSONB columns, but the v1 wire surface only exposes
**read** paths (`GET /api/stt-config`, `GET /api/note-recording-config`).
Mutation (`PUT` / `PATCH`) is deferred per D-17 — "UI will come later"
spec-driven UI" — Phase 7 UI builds the mutation endpoints
against the same schema.

**Remediation:** Phase 7 adds:

- `PUT /api/stt-config` (per-user override OR per-tenant write, gated
  by role)
- `PUT /api/note-recording-config`

The persistence layer is already in place; Phase 7 is additive at the
wire level.

---

## v2-deferred endpoints — rationale

The two v2-deferred families (Stripe + Referrals) above are intentionally
**not** present in the Phase 5 wire surface. They surface as **HTTP 404
with the canonical `{error: "Not Found"}` envelope** (D-35) for two
reasons:

1. **Operator semantics.** A self-hosted OpenWhispr installation runs
   on infrastructure the operator already pays for. Billing flows are
   conceptually external; routing them through this backend would
   add a Stripe dependency for installations that have no use for it.
2. **Wire-contract honesty.** The 404 + canonical envelope is the
   right answer from the desktop client's perspective — the upstream
   `cloud-api-request` passthrough already feature-flags these
   surfaces as "self-hosted-without-billing", so the client expects
   404 in this mode. Returning a 501 or 503 would mis-signal to the
   client that the route is temporarily unavailable.

The CONTRACT-01 negative matrix
(`packages/contract-tests/src/negative-matrix.test.ts`) asserts the
404 + envelope shape for every deferred route, so the deferral is
load-bearing on the contract test rather than relying on documentation
alone.

## Error envelope and locale (Phase 10 cross-reference)

The error envelope shape `{ error: "<message>" }` (D-35) is **English
bytes by default**. When the request carries `Accept-Language: ru` (or
the authenticated user has `users.locale = 'ru'`), the centralized
`setErrorHandler` resolves `errors.<code>` against the user's locale
via `req.i18n.t()` and serializes the localized string into the same
envelope. The envelope **shape** is wire-stable; the envelope
**string** is locale-driven.

Concretely:

```bash
# English (default)
$ curl -s -X POST http://api.example.com/api/transcribe -H 'Authorization: Bearer xxx'
{"error":"Validation failed"}

# Russian (Accept-Language)
$ curl -s -X POST http://api.example.com/api/transcribe \
    -H 'Authorization: Bearer xxx' \
    -H 'Accept-Language: ru'
{"error":"<localized Russian text from apps/api/src/i18n/locales/ru/errors.json>"}
```

This does not change the HTTP status code, the envelope key (`error`),
or the absence of an `error_code` field. Clients that need a stable
machine-readable code should pull it from the structured log
(`event=request.error, code=validation_failed`) — the wire envelope is
human-readable by design (D-35).

See [`i18n.md`](./i18n.md) for the full locale negotiation chain and
[`security.md`](./security.md) §6 for the audit-log English-only rule
(the audit log is NEVER localized, even when the envelope is).

## Wire contract change policy

Every wire-surface change MUST:

1. Land in the same commit as the matching CONTRACT-01 test update
   (`packages/contract-tests/src/<resource>.test.ts`).
2. Update the negative matrix inventory at
   `packages/contract-tests/src/negative-matrix.ts`
   (`PHASE_5_ROUTES` or future `PHASE_N_ROUTES`).
3. Append a row to this document's v1 implemented table.
4. Append a `.planning/phases/<NN>-*/<plan>-SUMMARY.md` recording the
   decision and any deviations.

The Pitfall #6 enumeration test
(`packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts`)
fails CI if step 2 is skipped — the negative matrix MUST cover every
runtime `/api/*` route.
