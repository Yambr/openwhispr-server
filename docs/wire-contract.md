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
| `/api/reason`                    | POST   | bearer | LLM completion; locked vocabulary |
| `/v1/audio/diarization`          | POST   | bearer | pyannote pass-through; idempotency cache |
| `/v1/realtime`                   | WSS    | bearer | OpenAI Realtime / Speaches reverse-proxy |

### Phase 4 — Streaming + Token Mints (WIRE-07, WIRE-13..15, SCALE-05)

| Route                              | Method | Auth   | Notes |
| ---------------------------------- | ------ | ------ | ----- |
| `/api/agent/stream`                | POST   | bearer | NDJSON; v3-era chunk vocab (text-delta, tool-call, tool-result, finish) |
| `/api/streaming-token`             | POST   | bearer | AssemblyAI v3 ephemeral token |
| `/api/deepgram-streaming-token`    | POST   | bearer | Deepgram ephemeral token |
| `/api/openai-realtime-token`       | POST   | bearer | OpenAI Realtime ephemeral client_secret |

### Phase 5 — Operational Endpoints + CRUD Families (WIRE-08..12, WIRE-16, WIRE-22..29)

| Route                                 | Method      | Auth    | WIRE | Notes |
| ------------------------------------- | ----------- | ------- | ---- | ----- |
| `/api/streaming-usage`                | POST        | bearer  | 09   | idempotent ledger insert |
| `/api/usage`                          | GET         | bearer  | 10   | SUM aggregator |
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
