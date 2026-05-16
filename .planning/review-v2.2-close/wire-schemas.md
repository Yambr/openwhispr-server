---
phase: review-v2.2-close
target: packages/wire-schemas/src/**
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/wire-schemas/src/agent.ts
  - packages/wire-schemas/src/api-keys.ts
  - packages/wire-schemas/src/check-user.ts
  - packages/wire-schemas/src/conversations.ts
  - packages/wire-schemas/src/delete-account.ts
  - packages/wire-schemas/src/diarization.ts
  - packages/wire-schemas/src/folders.ts
  - packages/wire-schemas/src/index.ts
  - packages/wire-schemas/src/notes.ts
  - packages/wire-schemas/src/reason.ts
  - packages/wire-schemas/src/settings.ts
  - packages/wire-schemas/src/streaming-usage.ts
  - packages/wire-schemas/src/transcriptions.ts
  - packages/wire-schemas/src/verification-status.ts
  - packages/wire-schemas/src/web-search.ts
original_review: .planning/review/wire-schemas.md (branch @ 1832f28)
head_sha: b830cc44b65f56ebdc2ebacd789e93df481788d8
findings:
  blocker: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Re-Review (v2.2 close): wire-schemas

**Original review:** `.planning/review/wire-schemas.md` (HEAD `1832f28`, 6 HIGH + 7 MEDIUM + 4 LOW).
**This re-review:** HEAD `b830cc4`. Same 9-category checklist + closure-delta against the prior findings.

## Closure Delta vs Original Review

Three commits touched `packages/wire-schemas/` since the original review:

- `a0ee7cb feat(39): wire-schemas HIGH sweep strict+UUID+ISO+enums+bounds`
- `8ae973e feat(40a): move route schemas from contract-tests to wire-schemas`
- `ba81769 fix(41b): strict zod validation for agent-stream request body`

### Original HIGH findings (6) — closure

| ID | Title | Status @ b830cc4 | Evidence |
|---|---|---|---|
| H-1 | No `.strict()` on input schemas | **CLOSED** | `.strict()` on `NoteInputSchema` (notes.ts:58), `FolderInputSchema` (folders.ts:21), `ConversationInputSchema` + nested message (conversations.ts:41,45), `TranscriptionInputSchema` (transcriptions.ts:31), `StreamingUsageBodySchema` (streaming-usage.ts:39), `WebSearchRequestSchema` (web-search.ts:17), `CreateApiKeyOptionsSchema` (api-keys.ts:45), `AgentStreamRequestSchema` (agent.ts:62), `CheckUserRequest` (check-user.ts:11), `ReasonRequest` (reason.ts:15), `VerificationStatusQuery` (verification-status.ts:7). |
| H-2 | Permissive `z.string()` on ids/timestamps/url | **CLOSED** | UUID/ISO-8601-offset/url refinements wired across all 9 files originally cited; e.g. `id: z.string().uuid()` (folders.ts:25, conversations.ts:49, notes.ts:62, transcriptions.ts:35, api-keys.ts:23), `ISO_DATETIME = z.string().datetime({ offset: true })` constants reused per file, `url: z.string().url().max(2048)` (web-search.ts:22). |
| H-3 | Unbounded `.string()` on persisted body fields | **CLOSED** | `.max()` caps on content (256 KB), transcript/text (5 MB), enhancement_prompt (16 KB), title (1024), short text (1024) in notes.ts:27-32, transcriptions.ts:12-13, streaming-usage.ts:14, conversations.ts:16. |
| H-4 | Unbounded `metadata` jsonb | **CLOSED** | `MetadataSchema` (conversations.ts:21-25) restricts keys to 1..64 chars, values to scalar string(≤1024)/number/boolean, and adds a `.refine` that rejects stringified payloads > 4096 bytes. Applied to both input nested messages and `CloudMessage`. |
| H-5 | `note_type` enum/output drift | **CLOSED** | `NoteTypeSchema` exported (notes.ts:19) and reused on both `NoteInputSchema.note_type` (notes.ts:41) and `CloudNoteSchema.note_type` (notes.ts:67). Symmetric. |
| H-6 | Numeric fields accept negatives/floats/NaN | **CLOSED** | `.int().nonnegative()` (and `.finite()` for non-int durations) applied to sort_order (folders.ts:19), audio_duration_seconds (notes.ts:43,70), expected_speaker_count (notes.ts:51,77 — with `.max(32)` ceiling), word_count (transcriptions.ts:39), audio_duration_ms (transcriptions.ts:27,44), sttProcessingMs/audioSizeBytes/clientTotalMs (streaming-usage.ts:32-36), numResults (web-search.ts:15). |

**6 / 6 HIGH closed.**

### Original MEDIUM findings (7) — closure

| ID | Title | Status | Evidence |
|---|---|---|---|
| M-1 | Dead exports — no production importer | **PARTIAL** | `DeleteAccountResponse`, `VerificationStatusResponse`, `DiarizationResponse`, `CheckUserResponse`, `ReasonResponse` now wired into route `schema.response` blocks (delete-account.ts:95, verification-status.ts:47, diarization.ts:162/321/515, check-user.ts:44, reason.ts:146). Phase-5-family output schemas (`CloudNoteSchema`, `CloudFolderSchema`, `CloudConversationSchema`, `CloudMessageSchema`, `CloudConversationWithMessagesSchema`, `CloudTranscriptionSchema`, `SearchResultSchema`, `WebSearchResultSchema`, `WebSearchResponseSchema`, `SttConfigResponseSchema`, `NoteRecordingConfigResponseSchema`) remain **not parsed at send-time** in any `apps/api/src/routes/**` handler (grep confirms zero production parse/`schema.response` references). The `rowToCloud*` mappers still hand-encode. See W-1 below. |
| M-2 | `V1Response` helper unused | **NOT CLOSED** | `apps/api/src/routes/v1/keys/{list,revoke,create}.ts` still hand-construct `{ data: ... }` envelopes; no import of `V1Response`/`V1ListApiKeysResponseSchema`/`V1CreateApiKeyResponseSchema` outside the package. Comments cite "V1Response envelope per D-28" but the helper itself is not parsed/registered. See W-2 below. |
| M-3 | `scopes: z.array(z.string())` — no enum | **NOT CLOSED** | `SCOPE = z.string().min(1).max(64)` (api-keys.ts:19) is bounded but still free-form — any string up to 64 chars is accepted. The canonical OAuth scope set is not enumerated. See W-3 below. |
| M-4 | `availableProviders` / `allowedFormats` no enum | **CLOSED** | `SttProviderSchema = z.enum([...])` and `AudioFormatSchema = z.enum([...])` (settings.ts:13,16) plus `.max(16)` array caps. |
| M-5 | `status: z.string().optional()` on TranscriptionInput | **CLOSED** | `TranscriptionStatusSchema = z.enum(["pending","processing","completed","failed"])` (transcriptions.ts:16) applied to both input (line 28) and output (line 45). |
| M-6 | `diarization_enabled` as `z.number()` | **CLOSED** | Tightened to `z.union([z.literal(0), z.literal(1)])` on both input (notes.ts:47-50) and output (notes.ts:76). Documented as legacy 0/1 shape per upstream client. |
| M-7 | `NoteTypeSchema` not exported as named const | **CLOSED** | Now `export const NoteTypeSchema` + `export type NoteType` at notes.ts:19-20. |

**5 / 7 MEDIUM closed; 2 carry forward (M-1 partial, M-2).**

### Original LOW findings (4) — closure

| ID | Title | Status |
|---|---|---|
| L-1 | `.default(false)` / `.default(5)` mutate parsed object | **NOT CLOSED** — still present at streaming-usage.ts:37 and web-search.ts:15. Demoted further; see I-1. |
| L-2 | Duplicated literal fields between `ApiKey` + `CreateApiKeyResponse` | **CLOSED** — `CreateApiKeyResponseSchema = ApiKeySchema.extend({ key }).strict()` at api-keys.ts:34. |
| L-3 | `metadata` three-state nullable+optional | **CLOSED** — input is `MetadataSchema.optional()` only (conversations.ts:39); output `CloudMessage.metadata` is `MetadataSchema.nullable()` only (conversations.ts:64). Three-state eliminated on input. |
| L-4 | Stale "Phase 5 / Plan 01" headers | **NOT CLOSED** — file headers still reference internal phase numbering. Cosmetic; see I-2. |

**2 / 4 LOW closed.**

## Findings @ b830cc4

### WARNINGS

**W-1: Phase-5 output schemas (`CloudNote`, `CloudFolder`, `CloudConversation`, `CloudMessage`, `CloudTranscription`, `SearchResult`, `WebSearchResponse`) still not enforced at send-time** [carry-forward of M-1]
- **Files:** `packages/wire-schemas/src/{notes.ts:61, folders.ts:24, conversations.ts:48,59,69, transcriptions.ts:34, web-search.ts:20,27}.ts`
- **Issue:** Grep across `apps/**/src/**` for these exported response schemas returns **zero** Fastify `schema: { response: ... }` registrations and zero `.parse(...)` calls. The corresponding route handlers (`apps/api/src/routes/notes/**`, `folders/**`, `conversations/**`, `transcriptions/**`, `agent/web-search.ts`) hand-encode via `rowToCloud*` mappers without contract validation. The schemas now correctly model UUID + ISO + bounds (H-2/H-3 closed), but a row-mapper bug shipping a wrong key name or a NULL where a NOT-NULL is declared would still escape. The Phase 40 sub-fix wired the leaf schemas (`DeleteAccountResponse`, `VerificationStatusResponse`, `DiarizationResponse`, `CheckUserResponse`, `ReasonResponse`) into `schema.response` blocks — the asymmetry is jarring. The package advertises wire enforcement on both sides but enforces only the request side for the Phase-5 family.
- **Fix:** Either (a) register each `CloudXSchema` in the corresponding route's Fastify `schema.response[200|201]` and let Fastify's response-serializer validate, or (b) call `.parse(payload)` inside the `rowToCloud*` mapper return path. Preferred (a) — it is the same pattern already used by the Phase 40 leaf routes.

**W-2: `V1Response` helper still bypassed by `/api/v1/keys/*` handlers** [carry-forward of M-2]
- **Files:** `packages/wire-schemas/src/api-keys.ts:48-55`; not imported from `apps/api/src/routes/v1/keys/{list,revoke,create}.ts`.
- **Issue:** The `V1Response<T>`, `V1ListApiKeysResponseSchema`, `V1CreateApiKeyResponseSchema` helpers exist precisely to lock the D-28 `{ data: T }` envelope. Production routes still hand-construct that envelope and only reference it in comments. If a future refactor accidentally returns `{ result: ... }` or `{ data: { items: ... } }` instead of `{ data: { keys: ... } }`, no schema check catches it. Wire-critical for v1 stability.
- **Fix:** Either register `V1ListApiKeysResponseSchema` / `V1CreateApiKeyResponseSchema` as the `schema.response[200]` for the respective routes, or wrap the reply payload in `V1ListApiKeysResponseSchema.parse(...)` before `reply.send`.

**W-3: API-key `scopes` not constrained to a canonical enum** [carry-forward of M-3]
- **File:** `packages/wire-schemas/src/api-keys.ts:19` (`SCOPE = z.string().min(1).max(64)`), used at lines 26 (`ApiKeySchema.scopes`) and 42 (`CreateApiKeyOptionsSchema.scopes`).
- **Issue:** Length-bound is good; semantic constraint is missing. A client requesting `["totally:fake:scope"]` round-trips into the DB without error, and the byok-guard / authorization middleware then has to silently ignore an unknown scope (or worse, treat it as a wildcard if any glob logic exists). The canonical scope list per `OAUTH_SPEC.md` is finite (`notes:read`, `notes:write`, `transcriptions:read`, `transcriptions:write`, `folders:read`, `folders:write`, `conversations:read`, `conversations:write`, `keys:manage`, etc. — verify against `packages/byok-guard` source of truth).
- **Fix:** `export const ApiKeyScopeSchema = z.enum([...])` colocated with the byok-guard scope constant (single source of truth via re-export), then `scopes: z.array(ApiKeyScopeSchema).max(64)`. Rejecting unknown scopes at the wire boundary is the right layer.

**W-4: Two `passthrough()` shapes on response envelopes — silent acceptance of unknown server fields**
- **Files:** `packages/wire-schemas/src/delete-account.ts:10` (`DeleteAccountResponse = z.object({}).passthrough()`), `packages/wire-schemas/src/diarization.ts:10-20` (`DiarizationResponse = z.object({ segments: ... }).passthrough()`).
- **Issue:** The task brief flags "no `.passthrough()` on security-sensitive shapes" as a focus area. Both schemas are now used in `schema.response[200]` blocks (delete-account.ts:95, diarization.ts:162/321/515). `delete-account` is a **destructive auth action**; `diarization` forwards a pyannote payload that may contain raw transcript fragments. `passthrough()` here means Fastify's response-serialization will **not strip** unknown fields and instead forward them verbatim to the client. If a future handler refactor accidentally attaches an internal field (audit-trail PII, internal queue id, raw provider response with API key echoed back, debug metadata), it leaks to the client. Defense-in-depth principle: response schemas should be `.strict()` at the network boundary; if forward-compat is needed, add explicit `.optional()` slots, do not wildcard-allow. Both file-header comments explicitly justify `passthrough()` for forward-compat — the cost is unbounded.
- **Fix:** Replace `passthrough()` with explicit `.optional()` slots for the anticipated future fields. For `DeleteAccountResponse`, an `{ deleted: true, deleted_at?: ISO_DATETIME }` strict shape is more honest. For `DiarizationResponse`, enumerate the known pyannote fields you actually forward (confidence, segment_id, etc.) and strict-mode the rest.

### INFO

**I-1: `.default(false)` / `.default(5)` inflate the parsed object** [carry-forward of L-1]
- **Files:** `streaming-usage.ts:37` (`sendLogs: z.boolean().optional().default(false)`), `web-search.ts:15` (`numResults: ... .optional().default(5)`).
- **Issue:** With Zod `.default()`, omitted-by-client fields are materialised post-parse, so `parsed.sendLogs === false` even when the client sent nothing. Routes that re-serialize the parsed object (e.g. forwarding to BullMQ job payload) will now persist a client-not-sent value. Minor contract-fidelity wart; not a security risk.
- **Fix:** Either move defaulting to the route handler (`body.numResults ?? 5`), or document the post-parse inflation in the file header so consumers understand the shape.

**I-2: Stale "Phase 5 / Plan 01" headers on FSL-released package** [carry-forward of L-4]
- **Files:** 9 of 15 files (`agent.ts`, `api-keys.ts`, `conversations.ts`, `folders.ts`, `index.ts`, `notes.ts`, `settings.ts`, `streaming-usage.ts`, `transcriptions.ts`, `web-search.ts`).
- **Issue:** Internal planning-doc coordinates are noise for external readers of the released `@openwhispr/wire-schemas` package.
- **Fix:** Replace with a stable one-liner ("Wire schema for POST /api/...") and a link to the relevant `BACKEND_SPEC.md` section.

**I-3: `agent.ts` content typed as `z.unknown()`**
- **File:** `packages/wire-schemas/src/agent.ts:26` (`AgentChatMessage.content: z.unknown()`); line 40 (`AgentLegacyTool.parameters: z.unknown()`).
- **Issue:** The file header acknowledges this is deliberate (OpenAI multi-modal allows string or array-of-parts; LiteLLM forwards untouched), so `z.unknown()` is justified for structural-envelope-only validation. However, `z.unknown()` accepts `undefined`. If the desktop client omits `content` entirely, `.strict()` still passes (because the key is required but the value is unknown including undefined). For an assistant/user/system message, an undefined content is almost certainly a client bug worth surfacing. Trade-off, not a bug — flag for review.
- **Fix:** Consider `z.union([z.string().max(N), z.array(z.unknown()).max(M)])` if the OpenAI shape is known to be string|parts-array; or `z.unknown().refine(v => v !== undefined, 'content required')` if `undefined` must be rejected.

## Out-of-Scope Observations

- **LOCKER-12 (no type-suppression):** no `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` anywhere in the 15 files. Clean.
- **LOCKER-13 (no hardcoded localhost/UUID/secret-shape literals):** none in source. Clean.
- **LOCKER-05 (Error subclass body truncation):** no `Error` subclasses defined in this package. N/A.
- **Suppressed warnings / TODO markers:** none. Clean.
- **SPDX headers:** present on all 15 files. Clean.

## Summary

Phase 39 + 40a + 41b genuinely closed the bulk of the Phase-5 wire-schemas debt: every original HIGH is fixed with measurable refinements (UUID, ISO-8601-offset, enum, `.strict()`, `.max(...)`, `.int().nonnegative()`). The two carry-forward warnings (W-1, W-2) are response-side-enforcement gaps — the schemas exist and are now correct, but the bulk of `apps/api/src/routes/**` Phase-5 handlers still bypass them, leaving an asymmetric contract surface. W-3 (scope enum) is a known semantic gap. W-4 (`.passthrough()` on `DeleteAccountResponse` + `DiarizationResponse`) is a new concern surfaced by the v2.2-close focus area — both are wired into production response serializers, and `passthrough()` is the wrong default at a security boundary even with the documented forward-compat rationale.

No blockers for v2.2 publication. The four warnings should be triaged for v2.3 — W-4 first (defense-in-depth, smallest blast radius), then W-1/W-2 together (response-side enforcement sweep mirroring the Phase 39 input-side sweep), then W-3 (cross-package coordination with byok-guard).

---
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_HEAD: b830cc44b65f56ebdc2ebacd789e93df481788d8_
