# Review: wire-schemas
Branch: main @ 13f0864
Files reviewed: 15 (`packages/wire-schemas/src/*.ts` — 570 LOC)

> Note: a prior review of this package against `main @ 1832f28` lived at this path. That commit predates the Phase 39 HIGH sweep and Phase 40 / Sub-fix 40.a (which moved `check-user`, `delete-account`, `diarization`, `reason`, `verification-status` here from `@openwhispr/contract-tests`). Most of the older review's HIGH findings (no `.strict()`, permissive primitives, unbounded long-text, dead-code on output schemas, scope/status/format/diarization-int issues, `NoteTypeSchema` export) have been fixed in the interim. This review is a fresh adversarial pass against the current 15-file tree and only the **remaining** defects.

## Summary
- CRITICAL: 1 / HIGH: 4 / MEDIUM: 5 / LOW: 4
- Top 3 production risks:
  1. **`ReasonRequest.text` has no `.max()` cap** — unbounded user-controlled prompt forwarded to LiteLLM. Cost-multiplier / DOS via multi-MB strings. This is the exact class of bug Phase 41.b created `AgentStreamRequestSchema` to fix; `reason.ts` was left behind by the Phase 39 / Phase 41.b cap pass.
  2. **`ReasonRequest.{provider,promptMode,matchType,model}` are free-form `z.string()` with no enum and no length cap.** The server echoes `promptMode` and `matchType` verbatim back into the canonical `ReasonResponse`, so a client can poison documented wire fields with arbitrary content (log injection, terminal-escape payloads, drift from `BACKEND_SPEC.md §/api/reason`).
  3. **`.passthrough()` on `DiarizationResponse` and `DeleteAccountResponse`** — these are response schemas; permissiveness here defeats the package's stated purpose (lock the wire surface byte-for-byte). Justifications in the source comments ("future audit metadata", "confidence scores per segment") describe future spec changes, not properly-modelled current shape.

## Findings

### [CRITICAL] CR-01: ReasonRequest.text is unbounded — cost-multiplier / DOS
- File: `packages/wire-schemas/src/reason.ts:7-15`
- Every other input schema in the package (`agent.ts`, `streaming-usage.ts`, `notes.ts`, `transcriptions.ts`, `web-search.ts`, `conversations.ts`, `folders.ts`, `api-keys.ts`) bounds string lengths with explicit documented caps. `reason.ts` ships:
  ```ts
  text: z.string().min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  promptMode: z.string().optional(),
  matchType: z.string().optional(),
  ```
- `text` is the user prompt forwarded directly to `litellm.chatCompletions` in `apps/api/src/routes/reason.ts:98-111` (`messages: [{ role: "user", content: body.text }]`). A client posting `{"text": "<10 MB string>"}` passes validation, hits LiteLLM, is billed against the tenant's quota, and locks a Fastify worker for the duration of the upstream call — *before* any token-budget check applies.
- Same bug that Phase 41.b explicitly carved as HI-02 for `/api/agent/stream`; the same fix discipline (documented cap, `.strict()` already in place) must be applied here.
- Fix: add `.max(MESSAGE_CONTENT_MAX)` aligned with the 256 KB cap used in `conversations.ts:38`, or a smaller domain-specific bound (16 KB matches `agent.ts`'s `systemPrompt`).

### [HIGH] HI-01: ReasonRequest enum-shaped fields drift from spec
- File: `packages/wire-schemas/src/reason.ts:11-13`
- `provider`, `promptMode`, `matchType` are typed `z.string().optional()`. Per `BACKEND_SPEC.md §/api/reason` and the server logic at `apps/api/src/routes/reason.ts:146-152`, these are enum-shaped (server keeps a hardcoded `MODEL_PROVIDER` map and defaults of `"default"`). The server **echoes the client's `promptMode` and `matchType` verbatim** into `ReasonResponse`, so any arbitrary string a client sends becomes part of the canonical response — including log-injection sequences, terminal escapes, or attacker-controlled values that downstream UI / analytics consume.
- Fix: convert to closed `z.enum([...])` matching the canonical set in `apps/api/src/routes/reason.ts` (`MODEL_PROVIDER` keys for `provider`; named modes for `promptMode`/`matchType`). At absolute minimum, cap length and constrain charset.

### [HIGH] HI-02: `.passthrough()` on DiarizationResponse + unbounded segment numbers
- File: `packages/wire-schemas/src/diarization.ts:10-21`
- Two defects in one schema:
  1. `.passthrough()` — `wire-schemas` is the source of truth and should fully model the upstream pyannote payload. The comment ("upstream pyannote payload may carry additional fields (e.g. confidence scores per segment)") describes a known field the schema should declare optional, not a license to leave the shape open.
  2. `start` and `end` are bare `z.number()` — accepts `NaN`, `±Infinity`, negatives, and `end < start`. These flow to clients that may use them as array indices, time offsets, or chart bounds.
- Fix: replace `.passthrough()` with `.strict()` and add the optional fields explicitly; constrain `start: z.number().nonnegative().finite()`, `end: z.number().nonnegative().finite()`, and add `.refine(s => s.end >= s.start)`.

### [HIGH] HI-03: `.passthrough()` on DeleteAccountResponse (validates nothing)
- File: `packages/wire-schemas/src/delete-account.ts:10`
- `z.object({}).passthrough()` validates literally any object. The comment says "the handler may attach audit metadata in a future phase without breaking the contract" — but adding fields to a response IS a contract change by definition, and clients are entitled to know the shape they will receive. Today this schema gives a false sense of validation; tomorrow a leak of internal audit fields (request IDs, internal user IDs, timing data) ships unnoticed.
- Fix: change to `z.object({}).strict()` (the current server returns literally `{}`). When the handler genuinely needs to add fields, amend the schema as part of the same change.

### [HIGH] HI-04: Email schemas lack `.max()`
- Files: `packages/wire-schemas/src/check-user.ts:11`, `packages/wire-schemas/src/verification-status.ts:7`
- `z.string().email()` accepts arbitrarily long strings as long as the regex matches. RFC 5321 caps practical email at 254 chars. Without `.max()` a client can submit a multi-MB email and force the server into expensive downstream lookups (`SELECT … WHERE email = $1`) — and `check-user` is by design an *unauthenticated* probe endpoint, so this is exploitable without credentials.
- Fix: `.max(254)`. Apply to both schemas. Add a regression test asserting a 10 KB email is rejected.

### [MEDIUM] ME-01: AgentChatMessage.content / AgentLegacyTool.parameters are `z.unknown()` without size bound
- File: `packages/wire-schemas/src/agent.ts:26, 40`
- The rationale comment ("desktop ships string content BUT the OpenAI multi-modal shape allows arrays of parts; we only assert presence + the structural envelope") is reasonable, but the matching size cap is missing. The route accepts up to 50 messages × unbounded `content` × Fastify's global body limit. If global body-limit is the only protection, document it; otherwise constrain `content` to `z.union([z.string().max(N), z.array(z.unknown()).max(M)])` so the spec at least bounds the obvious shapes. Same for `parameters` (caller-supplied JSON schema for tool definitions).
- Fix: tighten to a bounded union, OR add an inline comment pointing at the Fastify body-limit guarantee + a contract test that asserts an oversize body is rejected.

### [MEDIUM] ME-02: ReasonResponse fields unbounded `z.string()` (response side)
- File: `packages/wire-schemas/src/reason.ts:18-25`
- All five fields are bare `z.string()`. `text` is filled from `upstreamJson.choices?.[0]?.message?.content` (`apps/api/src/routes/reason.ts:147`) — an LLM output that could be megabytes if upstream misbehaves. Contract tests using this schema cannot detect a server bug that lets unbounded completions through. Same enum-shape mismatch as HI-01 applies to `provider`, `promptMode`, `matchType` on the response side.
- Fix: `.max(TEXT_MAX)` on `text`; enums on `provider`, `promptMode`, `matchType`.

### [MEDIUM] ME-03: AgentStreamRequest.messages allows empty array
- File: `packages/wire-schemas/src/agent.ts:57`
- `z.array(...).min(0).max(50)`: `.min(0)` is the Zod default and adds no constraint. An empty `messages` array is unambiguously a client bug — the route forwards to LiteLLM which returns a 400 anyway. Reject at the wire boundary instead of round-tripping to the upstream and burning a request slot.
- Fix: `.min(1).max(50)`.

### [MEDIUM] ME-04: ConversationInput.metadata refine runs `JSON.stringify` per parse, no key-count cap
- File: `packages/wire-schemas/src/conversations.ts:21-25`
- The 4 KB stringified-size refine fires *after* zod has already validated every key/value pair in `z.record(...)`. A payload with thousands of valid-by-themselves keys hits the refine only at the end. In a batched route (`notes/batch-create.ts` parses `NoteInputSchema` per element; the conversations equivalent does the same for messages) the validator work multiplies. Performance is out-of-scope per the brief, but the missing key-count guard also enables resource amplification.
- Fix: prefix the existing refine with `.refine(meta => Object.keys(meta).length <= 32)` so the cheap check runs first.

### [MEDIUM] ME-05: `.email()` policy is not pinned (IDN / Unicode behaviour will drift with Zod upgrades)
- Files: `packages/wire-schemas/src/check-user.ts:11`, `verification-status.ts:7`
- Zod v4's built-in `.email()` regex does not accept IDN/Unicode local parts. If `BACKEND_SPEC.md` claims internationalized email support, this is silent spec drift; if it doesn't, the behaviour is fine today but unpinned for future Zod upgrades. No test in the package asserts what the email policy actually is.
- Fix: either pin via `.regex(EMAIL_RE)` with an anchored, audited regex in the schema, OR add explicit accept/reject test cases (IDN, plus-addressing, quoted local part, trailing dot) so the policy is locked.

### [LOW] LO-01: Three primitive enums exported but only used internally
- Files: `packages/wire-schemas/src/conversations.ts:19` (`ConversationRoleSchema`), `settings.ts:13` (`SttProviderSchema`), `settings.ts:16` (`AudioFormatSchema`)
- All three are composed inside their own file (and the `SttProvider`/`AudioFormat` type aliases are exported), but no external app or package imports the schema constants. Not strictly dead, but the public-API surface is wider than the actual consumers need. Likely the web client redeclares these enums locally and would benefit from importing them.
- Fix: either wire downstream consumers to import these (preferred) or drop the `export` keyword on the schema constant while keeping the inferred type alias public.

### [LOW] LO-02: `notes.ts` mixes `0|1` and `z.boolean()` conventions
- Files: `packages/wire-schemas/src/notes.ts:46-50, 76` (`diarization_enabled` as `0|1`) vs `folders.ts:27` (`is_default: z.boolean()`) vs `settings.ts:30` (`diarizationEnabled: z.boolean()`)
- Comment justifies the legacy `0|1` shape per upstream desktop client (M-6). The convention is legitimate but a footgun for future contributors who will reach for `z.boolean()` by reflex.
- Fix: add a comment block on the `notes.ts` `diarization_enabled` field linking to the upstream desktop file that pins this. Consider a shared `LegacyBoolFlag` schema constant so the asymmetry is named once and referenced.

### [LOW] LO-03: `CreateApiKeyOptionsSchema.expiresInDays` allows 0 ambiguously
- File: `packages/wire-schemas/src/api-keys.ts:43`
- `z.number().int().nonnegative().nullable().optional()` accepts `0`. Is 0 "expires today / immediately" or "never expires" (the `null` semantic)? The schema is ambiguous and the server route has to disambiguate, which means any callers reading the schema for documentation will guess wrong.
- Fix: either `.positive()` (forbid 0) and reserve `null` for never-expires, or add an explicit doc-comment.

### [LOW] LO-04: `streaming-usage.ts` sessionId cap of 4096 is excessive
- File: `packages/wire-schemas/src/streaming-usage.ts:18`
- 4 KB for an idempotency key is two orders of magnitude above any plausible use (UUID = 36 chars; SHA-256 hex = 64; signed JWT idempotency key ≈ 600). Comment cites "hashed composite keys" but no real-world composite reaches 4 KB.
- Fix: tighten to `.max(512)` unless a specific consumer documents otherwise.

## Dead code
- No fully-dead exports. Three exports (`ConversationRoleSchema`, `SttProviderSchema`, `AudioFormatSchema`) have zero external importers but are composed internally — flagged LO-01.
- No `TODO|FIXME|HACK|XXX|TEMP|WORKAROUND|kludge` markers anywhere in the 15 files.
- Output schemas (`CloudNoteSchema`, `CloudFolderSchema`, etc.) that were dead in the prior `1832f28` review now have ≥ 5 external importers each — the response-side gap from that review has been closed.

## Suppressed warnings
None. No `@ts-ignore`, no `@ts-expect-error`, no `as any`, no `as unknown as` anywhere in `packages/wire-schemas/src/**`. Clean against LOCKER-02.

## Notes
- Strengths worth preserving:
  - Every input schema uses `.strict()` (the central HIGH defect from the prior review at `1832f28` — fixed).
  - UUID + ISO-8601 + bounded length applied uniformly across `notes.ts`, `folders.ts`, `conversations.ts`, `transcriptions.ts`, `api-keys.ts`.
  - No custom regex anywhere → zero ReDoS surface introduced by this package.
  - `agent.ts` and `streaming-usage.ts` explicitly document Phase 41.b / Phase 39 cap rationale per field — exemplary; same treatment is missing from `reason.ts` (CR-01).
- Recommended single follow-up phase: bring `reason.ts` + the two `.passthrough()` response schemas + the unbounded `.email()` schemas in line with the Phase 39 HIGH-sweep / Phase 41.b cap discipline. That closes CR-01, HI-01, HI-02, HI-03, HI-04 in one TDD pair.
- Wire-spec verification gap: the canonical `ErrorEnvelope` (`z.object({ error: z.string().min(1) }).strict()`) lives in `packages/contract-tests/src/schemas.ts:24`, not in `wire-schemas`. Sub-fix 40.a moved five schemas here to break that exact boundary inversion (`check-user`, `delete-account`, `diarization`, `reason`, `verification-status`); `ErrorEnvelope` should follow. Not a defect in the current files — a scope gap for the next phase.
- Missing wire shapes per the brief: no `set-auth-token` rotation token schema, no NDJSON streaming envelope schema, no channel-scheme echo schema present in this package. If `BACKEND_SPEC.md` / `OAUTH_SPEC.md` define these (per the brief they do), their absence means the package's "source of truth" claim is incomplete — gap, not defect, but worth tracking before the OSS publication so external integrators don't have to reverse-engineer the wire surface from `apps/api/src/**`.
