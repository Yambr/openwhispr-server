# Review: wire-schemas (packages/wire-schemas)

Branch: main @ 1832f28
Scope: packages/wire-schemas/src/** (9 files)
Reviewer: gsd-code-reviewer (adversarial)

## Summary

- Files reviewed: 9 (api-keys, conversations, folders, notes, settings, streaming-usage, transcriptions, web-search, index)
- Findings: **CRITICAL=0  HIGH=6  MEDIUM=7  LOW=4**
- Top 3 production risks:
  1. **No input schema uses `.strict()`** — every `POST /api/...` route persists the parsed body into Postgres, but `NoteInputSchema`, `FolderInputSchema`, `ConversationInputSchema`, `TranscriptionInputSchema`, `StreamingUsageBodySchema`, `WebSearchRequestSchema`, `CreateApiKeyOptionsSchema` silently accept any unknown keys. Combined with `Record<string, unknown>` insert-builders in `apps/api/src/routes/**/create.ts`, this is a non-rejecting attack surface (enumeration, undocumented-field probing, future spec drift). Zod default is `strip` — unknown keys are dropped silently with no log, so neither client mistakes nor adversarial probes leave a trace. The lone `.strict()` in `ApiKeySchema` (api-keys.ts:25) proves the team knows the option; absence everywhere else is the bug.
  2. **Permissive primitives across every output schema** — `id`, `created_at`, `updated_at`, `expires_at`, `last_used_at`, `deleted_at`, `archived_at`, `client_*_id`, and `url` (WebSearchResultSchema) are all `z.string()`. The package presents itself as the canonical wire contract (D-22, byte-for-byte) but in practice will validate `"not-a-uuid"`, `""`, and `"not-an-iso-timestamp"`. Type-level "string" is not a contract; the desktop client expects ISO-8601 + UUID + URL shapes per BACKEND_SPEC. Risk: server can ship malformed data and tests pass.
  3. **Substantial dead code in the public barrel** — at least 8 exported output schemas (`CloudConversationSchema`, `CloudMessageSchema`, `CloudConversationWithMessagesSchema`, `CloudFolderSchema`, `CloudNoteSchema`, `SearchResultSchema`, `CloudTranscriptionSchema`, `WebSearchResultSchema`, `WebSearchResponseSchema`, `V1Response`, `V1ListApiKeysResponseSchema`, `V1CreateApiKeyResponseSchema`, `CreateApiKeyResponseSchema`, `CreateApiKeyOptionsSchema`, `ApiKeySchema`) are not imported by any production file under `apps/**/src/**` — only by `tests/` and `contract-tests`. Routes hand-roll `rowToCloud*` mappers (e.g. `apps/api/src/routes/notes/shape.ts`) without ever validating the response against the package schema. Net effect: the package advertises wire enforcement but enforces only the request side, and ships unused surface that drifts from the actual response code.

## Findings (by severity)

### HIGH

**H-1  No `.strict()` on input schemas — unknown fields silently stripped**
- Files: `notes.ts:17` (NoteInputSchema), `folders.ts:8` (FolderInputSchema), `conversations.ts:10` (ConversationInputSchema), `transcriptions.ts:8` (TranscriptionInputSchema), `streaming-usage.ts:10` (StreamingUsageBodySchema), `web-search.ts:10` (WebSearchRequestSchema), `api-keys.ts:40` (CreateApiKeyOptionsSchema)
- Issue: Zod's default `strip` behaviour drops unknown keys without error. Combined with `route → schema.parse → insertValues: Record<string, unknown>` flow in `apps/api/src/routes/notes/create.ts:37-60`, a misbehaving / hostile client gets a 200 for any request whose required keys exist, with extraneous content silently absorbed. The fact that `ApiKeySchema` (api-keys.ts:25) calls `.strict()` proves the codebase considers strictness intentional — its absence here is inconsistency.
- Fix: `.strict()` on every input schema; for nested objects (`ConversationInputSchema.messages[]`) also strict.

**H-2  Permissive `z.string()` where shape is known (UUID, ISO-8601 datetime, URL, email)**
- Files: `api-keys.ts:17,21-23,28-35`; `conversations.ts:27-34,38-42,45`; `folders.ts:16-24`; `notes.ts:38-58`; `transcriptions.ts:21-35`; `web-search.ts:17-19` (`url: z.string()` — must be `.url()`).
- Issue: Every `id`/`*_at`/`*_id`/`url` field is unbounded `z.string()`. The schemas claim to mirror the upstream client byte-for-byte, but the client expects UUIDs and ISO-8601 timestamps. Tests passing `""` or `"foo"` would not fail validation; downstream consumers do not get the contract they think they get.
- Fix: `z.string().uuid()` for ids, `z.string().datetime({ offset: true })` for timestamps, `z.string().url()` for `WebSearchResult.url`. If the upstream client allows non-UUID legacy ids, document that as a comment and pick `.min(1)` at minimum.

**H-3  Unbounded `z.string()` on body fields persisted to Postgres**
- Files: `notes.ts:19-22,30-31` (`content`, `enhanced_content`, `enhancement_prompt`, `transcript`); `transcriptions.ts:10-12` (`text`, `raw_text`); `conversations.ts:18-19` (message `content`); `streaming-usage.ts:15` (`text`).
- Issue: No `.max(N)`. The only protection is Fastify's global body limit. A single 50 MB string in `content` flows straight into a TEXT column. Wire schemas are the right place to cap user-influenced text fields.
- Fix: `.max(...)` on every long-text input (`content` ≈ 256 KB cap recommended; `transcript`/`text` ≈ 5 MB; `enhancement_prompt` ≈ 16 KB).

**H-4  `metadata: z.record(z.string(), z.unknown())` accepted unbounded**
- File: `conversations.ts:20`, `conversations.ts:43`.
- Issue: Both `ConversationInput.messages[].metadata` and `CloudMessage.metadata` accept arbitrary JSON of arbitrary depth/size. No max keys, no max nested depth, no size cap. This lands in a JSONB column. Combined with H-1 (no `.strict()` on the enclosing message object), a hostile payload could embed multi-MB structures or deeply nested objects (Postgres jsonb has a hard depth limit but well above what should be allowed at the API boundary).
- Fix: cap with `.refine` (max stringified bytes), enumerate the known metadata keys if any are known, or move to a typed sub-schema.

**H-5  Schema/output type mismatch for `note_type`**
- Files: `notes.ts:15` (input enum `["personal","meeting","upload"]`) vs `notes.ts:44` (output `z.string()`).
- Issue: The wire surface treats the same field strictly on the way in and permissively on the way out. Either DB persists non-enum values (then input enum lies) or output should also be the enum. The drift is a contract bug regardless of direction.
- Fix: `CloudNoteSchema.note_type: NoteTypeSchema` (same enum); also export `NoteTypeSchema`.

**H-6  Numeric fields accept negatives and floats where domain is non-neg int**
- Files: `folders.ts:12` (`sort_order: z.number()`), `notes.ts:25,28-29,53-54` (`audio_duration_seconds`, `diarization_enabled`, `expected_speaker_count`), `transcriptions.ts:15,26` (`audio_duration_ms`, `word_count`), `streaming-usage.ts:21-25` (`sttProcessingMs`, `audioSizeBytes`, `clientTotalMs`), `web-search.ts:12` (`numResults` is correctly `.int().min(1).max(10)` — the lone good example).
- Issue: `z.number()` accepts `-1`, `NaN`, `1.5`, `Infinity`. `word_count: -3` parses and lands in Postgres.
- Fix: `.int().nonnegative()` (or `.int().min(0).max(...)`) on every count/duration; `expected_speaker_count` should also have a sensible max (≤ 32 say).

### MEDIUM

**M-1  Dead exports — no production importer**
- Files: `api-keys.ts:15,28,40,48,51,54` (ApiKeySchema, CreateApiKeyResponseSchema, CreateApiKeyOptionsSchema, V1Response, V1ListApiKeysResponseSchema, V1CreateApiKeyResponseSchema); `conversations.ts:8,27,38,48` (ConversationRoleSchema, CloudConversationSchema, CloudMessageSchema, CloudConversationWithMessagesSchema); `folders.ts:16` (CloudFolderSchema); `notes.ts:38,61` (CloudNoteSchema, SearchResultSchema); `settings.ts:10,17` (SttConfigResponseSchema, NoteRecordingConfigResponseSchema); `transcriptions.ts:21` (CloudTranscriptionSchema); `web-search.ts:16,23` (WebSearchResultSchema, WebSearchResponseSchema).
- Issue: Grep across `apps/**/src/**` returns zero hits for any of these (only `tests/**` and `packages/contract-tests/**`). Routes use hand-rolled `rowToCloud*` mappers and do not validate responses through the package. Either the response side needs to start enforcing these schemas (and the schemas need to be correct — see H-2) or these exports should be removed from the barrel to stop signalling false coverage.
- Fix: Either (a) add `Schema.parse(payload)` (or `.passthrough().safeParse` for logging) to every send-site, or (b) drop the unused exports and document the response side as "encoded by `rowToCloud*` in apps/api".

**M-2  `V1Response` helper unused by production code**
- File: `api-keys.ts:48-55`.
- Issue: The `V1Response` generic and its two instances are declared, exported, and never imported outside the package's own file. The two `/v1/keys/*` route handlers (`apps/api/src/routes/v1/keys/{list,revoke,create}.ts`) hand-construct `{ data: ... }` directly. Same pattern as M-1 but for the v1 envelope specifically; arguably a bigger smell because D-28 envelope correctness is wire-critical.
- Fix: Use `V1Response(...)` as a Fastify response schema (or `.parse` before `reply.send`) in `apps/api/src/routes/v1/keys/*.ts`.

**M-3  `scopes: z.array(z.string())` — no enum**
- Files: `api-keys.ts:20,33,42`.
- Issue: API-key scopes are a finite known set (per BACKEND_SPEC / OAUTH_SPEC). Accepting `z.string()` lets `["foo:bar"]` round-trip; on the create-options side this could even let a client request an unrecognized scope which then gets persisted.
- Fix: Define `ApiKeyScopeSchema = z.enum([...])` matching the canonical scope list (likely in `packages/auth` or `packages/byok-guard`) and reuse.

**M-4  `availableProviders: z.array(z.string())` and `allowedFormats: z.array(z.string())`**
- Files: `settings.ts:13,20`.
- Issue: Same as M-3 — these are operator-controlled enums in practice (`openai`, `groq`, `speaches`, etc. and `wav`/`webm`/`mp3`/`m4a`/`flac`). Leaving as free `z.string()` means a misconfigured server can publish nonsense providers/formats and clients silently accept.
- Fix: Enumerate; reject unknowns at boot.

**M-5  `status: z.string().optional()` on TranscriptionInput**
- File: `transcriptions.ts:16`.
- Issue: `status` ultimately lands in Postgres as the row's lifecycle column (route defaults to `"completed"`). No enum, no validation — `status: "pwned"` accepted.
- Fix: `z.enum(["pending","processing","completed","failed"])` (or whatever the canonical set is — verify against `packages/data/src/schema`).

**M-6  `diarization_enabled` typed as `z.number().nullable()`**
- Files: `notes.ts:27,52`.
- Issue: Domain is boolean ({0,1}). Schema lets `42` through and the route writes it raw (`notes/create.ts:55`). Comment near the top of the file calls this deliberate, but it allows the obvious anti-shape. If desktop legacy really demands int, constrain to `z.union([z.literal(0), z.literal(1)])`.
- Fix: tighten to `0|1` (or migrate to `z.boolean()` if the upstream client now emits booleans).

**M-7  `NoteTypeSchema` not exported**
- File: `notes.ts:15` — declared `const NoteTypeSchema` but never re-exported (the barrel only re-exports `* from "./notes.js"` so it is exported, but tests/contract code can't reuse it semantically because the constant is the only NoteType source of truth and there is no type alias).
- Fix: Add `export const NoteTypeSchema = ...` and `export type NoteType = z.infer<typeof NoteTypeSchema>` for downstream use.

### LOW

**L-1  `.default(false)` and `.default(5)` mutate the wire surface invisibly**
- Files: `streaming-usage.ts:26` (`sendLogs`), `web-search.ts:13` (`numResults`).
- Issue: With Zod `.default()`, omitted-by-client values are materialised post-parse. If a downstream caller serializes the parsed object back over the wire, the value `5`/`false` is now present where the client sent nothing. Minor, but a contract-fidelity wart.
- Fix: Either document the inflation, or move defaulting to the route handler (`body.numResults ?? 5`) so the parsed object preserves "client did not send this".

**L-2  Repeated literal schema between `ApiKey` and `CreateApiKeyResponse`**
- File: `api-keys.ts:15-25` vs `28-37`.
- Issue: The two schemas share seven fields. Today they happen to match; tomorrow one drifts. The intended invariant is "CreateApiKeyResponse = ApiKey + { key }".
- Fix: `CreateApiKeyResponseSchema = ApiKeySchema.extend({ key: z.string() }).strict()`. (Note: also fixes the missing `.strict()` on the create response.)

**L-3  `ConversationInput.messages[].metadata` allows `null` but the field is `.optional()` — three-state**
- File: `conversations.ts:20`.
- Issue: `z.record(...).nullable().optional()` allows undefined / null / object. Pick one (per upstream client TS, optional or nullable, not both).
- Fix: align to the desktop client's `metadata?: Record<string,unknown>` (drop `.nullable()`).

**L-4  File-level header references "Phase 5 / Plan 01" — stale labelling**
- All 9 files. Not a bug, but for an FSL-released package the planning-doc co-ordinates are noise to external readers.
- Fix: replace with a stable one-line description and a link to BACKEND_SPEC.

## Dead code

| Export | File | Production importer? |
|---|---|---|
| `ApiKeySchema`, `ApiKey` | api-keys.ts:15 | none |
| `CreateApiKeyResponseSchema`, `CreateApiKeyResponse` | api-keys.ts:28 | none |
| `CreateApiKeyOptionsSchema`, `CreateApiKeyOptions` | api-keys.ts:40 | none |
| `V1Response<T>`, `V1ListApiKeysResponseSchema`, `V1CreateApiKeyResponseSchema` | api-keys.ts:48-55 | none |
| `ConversationRoleSchema` | conversations.ts:8 | none (internal use only) |
| `CloudConversationSchema`, `CloudMessageSchema`, `CloudConversationWithMessagesSchema` | conversations.ts:27-48 | none |
| `CloudFolderSchema` | folders.ts:16 | none |
| `CloudNoteSchema`, `SearchResultSchema` | notes.ts:38,61 | none |
| `SttConfigResponseSchema`, `NoteRecordingConfigResponseSchema` | settings.ts:10,17 | tests only |
| `CloudTranscriptionSchema` | transcriptions.ts:21 | none |
| `WebSearchResultSchema`, `WebSearchResponseSchema` | web-search.ts:16,23 | none |

Recommendation: either wire the output schemas into `reply.send` in the corresponding route handlers (preferred — closes the response-side contract gap exposed in M-1/M-2), or remove from the barrel.

## Suppressed warnings

None found. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `as any`, or `as unknown as` in any of the 9 files. No `TODO`/`FIXME`/`HACK`/`XXX`/`TEMP`/`WORKAROUND` markers. Clean on this dimension.

## Notes

- The package consistently uses SPDX header, ESM `.js` extensions in imports, and zod v3 record syntax (`z.record(z.string(), z.unknown())`). Style is uniform; the defects are systematic (no strictness, no primitive refinement) rather than scattered.
- The single `.strict()` in `api-keys.ts:25` shows the team is aware of strictness and chose it deliberately for the list shape. The asymmetry — input schemas not strict despite landing in SQL — is the central bug pattern of this package.
- BACKEND_SPEC.md / OAUTH_SPEC.md / SELF_HOSTING.md are referenced throughout the source comments but not present in the repo at the documented paths. Cannot verify byte-for-byte spec compliance without those files; downgraded what would otherwise be CRITICAL spec-divergence findings to HIGH (the strictness + permissive-primitive issues are bugs against any reasonable spec).
- The output schemas, if adopted at send-time, would catch real divergences today: `rowToCloudNote` and friends in `apps/api/src/routes/**/shape.ts` are not currently validated against `CloudNoteSchema`, so a row-mapper bug shipping the wrong field name would not be caught by any schema check.
