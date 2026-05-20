# Code Review — `packages/wire-schemas/src/**`

**Reviewer:** gsd-code-reviewer (adversarial)
**Branch / HEAD:** `main` @ `6e43588`
**Scope:** 17 source files (752 LOC) under `packages/wire-schemas/src/`
**Out of scope:** tests, `.planning/`, `docs/`, route-side inline-zod drift (flag on route reviewer)
**Status:** issues_found

> Supersedes a prior review of this package at the same path against an earlier HEAD. This is a fresh adversarial pass against the current 17-file tree; only the **remaining** defects are listed.

---

## Summary

The wire-schemas package is the codified single-source-of-truth for HTTP wire shapes shared between the Fastify API and the OpenWhispr desktop client. The code is uniformly small, well-commented (each file cites the upstream spec section + the phase that introduced/tightened it), uses `.strict()` on all request bodies + query-string schemas, applies bounded string/array/numeric caps everywhere user input flows into LiteLLM or DB, and shows zero LOCKER violations (no `as any`, no `@ts-ignore`, no `NODE_ENV` branches, no `localhost`/UUID/secret-shape literals). The package leaks **no internal DB columns** (no `tenant_id`, no `user_id`, no envelope-encryption sidecar columns `_dek_*`, `_value_iv`, `_value_ciphertext`, `_auth_tag`, `_fp`) into response shapes — CRITICAL-grade exposure path is clean.

Adversarial review surfaces:

1. One **HIGH** — hardcoded English error message in `ConversationInputSchema.MetadataSchema` refinement (`"metadata too large"`) violates the project's i18n-locale-keyed-or-empty rule for end-user error messages.
2. Four **MEDIUM** dead-export clusters (no importer in `apps/**` or `packages/**` outside this file): `ConversationRoleSchema`, `SttProviderSchema`, `AudioFormatSchema`, plus four `reason.ts` named constants (`MAX_REASON_TEXT_LENGTH`, `REASON_PROVIDERS`, `REASON_PROMPT_MODES`, `REASON_MATCH_TYPES`). Per LOCKER-04's "every exported symbol MUST have at least one non-test importer" invariant these are debt; the locker is operationally WARN-only today but flips BLOCKING at Phase 41 closure.
3. A scattering of **LOW** consistency / bounds gaps: response-shape strictness is inconsistent (some responses `.strict()`, most are not, no documented package-level convention); `OpenAIRealtimeTokenResponse.clientSecret`/`clientSecrets` carry no length caps; `TranscriptionInputSchema.text` accepts the empty string; `MetadataSchema`'s budget refinement uses `String.length` (UTF-16 code units) under a constant named `METADATA_MAX_BYTES`; `DiarizationResponse` does not enforce `end >= start` per segment.

No CRITICAL findings. No BACKEND_SPEC byte-for-byte divergences detected against the §49–77 global-error-envelope contract. No type-suppression. No TODO/FIXME/HACK markers. No "loosened to make tests pass" markers in recent diffs.

---

## Findings

### HIGH

**H-1 — Hardcoded English error message in `MetadataSchema` refinement** — `packages/wire-schemas/src/conversations.ts:24`

```ts
.refine((meta) => JSON.stringify(meta).length <= METADATA_MAX_BYTES, {
  message: "metadata too large",
});
```

The string `"metadata too large"` is a user-surface error message hardcoded in English. Project rule (CLAUDE.md / Constraints): "Runtime localization: `en` + `ru` minimum from day one for UI copy, emails, **end-user error messages**." The Zod refinement message lands in the 400-envelope `error` field when desktop clients exceed the cap, so it is an end-user error message. Convention elsewhere is for schema refinement messages to be either empty (route handler localizes via i18next + setErrorMap) or stable machine keys (`metadata.too_large`) — never inline English. The reviewer brief explicitly enumerates "hardcoded locale string" as HIGH for wire-schemas.

---

### MEDIUM

**M-1 — Dead export: `ConversationRoleSchema`** — `packages/wire-schemas/src/conversations.ts:19`

`ConversationRoleSchema` (the `z.enum(["user","assistant","system"])`) is exported but has **zero** importers in `apps/**` or `packages/**` outside this file. It is used INTERNALLY (lines 37, 62) to define `ConversationInputSchema.messages[].role` and `CloudMessageSchema.role`, but those wrapper schemas are what consumers import. Either drop the `export` keyword or document the public-API rationale.

**M-2 — Dead export: `SttProviderSchema`** — `packages/wire-schemas/src/settings.ts:13`

`SttProviderSchema` exported but no importer outside this file. Internally used at line 22 (`availableProviders: z.array(SttProviderSchema)`). Same fix as M-1.

**M-3 — Dead export: `AudioFormatSchema`** — `packages/wire-schemas/src/settings.ts:16`

`AudioFormatSchema` exported but no importer outside this file. Internally used at line 29. Same fix as M-1.

**M-4 — Dead exports: `reason.ts` named constants** — `packages/wire-schemas/src/reason.ts:25,28,31,34`

All four exported constants — `MAX_REASON_TEXT_LENGTH`, `REASON_PROVIDERS`, `REASON_PROMPT_MODES`, `REASON_MATCH_TYPES` — have **zero** importers outside `reason.ts`. They are useful inline documentation of the cap/enum decisions, but a route handler that needs e.g. the provider list to gate a downstream call would import them — none does. Either consume them in `apps/api/src/routes/reason.ts` to remove drift between the schema constant and any hand-written allowlist, or drop the `export`.

---

### LOW

**L-1 — Response-shape strictness convention is inconsistent** — package-wide

Some response schemas are `.strict()` (`DeleteAccountResponse:13`, `SeedTenantResponse:38,42`, `DiarizationResponse:28`, `ApiKeySchema:31`, `CreateApiKeyResponseSchema:36`, `V1Success`, `V1Failure`) with explicit per-file rationale, while most are not (`CheckUserResponse:19`, `VerificationStatusResponse:14`, `ReasonResponse:48`, `OpenAIRealtimeTokenResponse:39`, `SttConfigResponseSchema:19`, `NoteRecordingConfigResponseSchema:26`, `CloudConversationSchema:48`, `CloudMessageSchema:59`, `CloudFolderSchema:24`, `CloudNoteSchema:61`, `CloudTranscriptionSchema:34`, `WebSearchResultSchema:20`, `WebSearchResponseSchema:27`). The intent — request bodies always strict to surface drift, response bodies generally permissive for forward-compat — is defensible, but it is not stated as a package-level convention. A short `index.ts` header note codifying the rule would prevent future contributors from regressing it accidentally.

**L-2 — `OpenAIRealtimeTokenResponse` has no length caps** — `packages/wire-schemas/src/openai-realtime-token.ts:39–43`

```ts
export const OpenAIRealtimeTokenResponse = z.object({
  clientSecret: z.string(),
  clientSecrets: z.array(z.string()),
});
```

No `.min(1)` on `clientSecret`, no `.max()` on either field, no `.max()` on the array. Defence-in-depth across the rest of the package always bounds primitives; this schema diverges. Real-world OpenAI ephemeral-token secrets are well under 1 KB and exactly one entry, so caps like `clientSecret: z.string().min(1).max(4096)` and `clientSecrets: z.array(z.string().min(1).max(4096)).max(4)` would tighten it without breaking anything.

**L-3 — `TranscriptionInputSchema.text` accepts empty string** — `packages/wire-schemas/src/transcriptions.ts:22`

`text: z.string().max(TEXT_MAX)` has no `.min(1)`. A client can persist a transcription row with empty text. Compare against `notes.ts` where `content: z.string().max(CONTENT_MAX).optional()` is at least optional rather than empty-mandatory. If the upstream desktop client never sends empty `text`, `.min(1)` would catch wire-shape regressions.

**L-4 — `MetadataSchema` budget refinement counts UTF-16 code units, not bytes** — `packages/wire-schemas/src/conversations.ts:17,23`

```ts
const METADATA_MAX_BYTES = 4096;
…
.refine((meta) => JSON.stringify(meta).length <= METADATA_MAX_BYTES, …)
```

`String.prototype.length` returns UTF-16 code units. A metadata blob whose values are Cyrillic / CJK characters will pass this check at up to ≈ 8 KB on-wire. Either rename the constant to `METADATA_MAX_CHARS` and document the convention, or compute true byte length: `Buffer.byteLength(JSON.stringify(meta), "utf8")`. Defence-in-depth — the route still pays the cost of stringifying, but the cap is honest.

**L-5 — `DiarizationResponse` does not enforce `end >= start`** — `packages/wire-schemas/src/diarization.ts:21–25`

Each segment validates `start: nonnegative finite` and `end: nonnegative finite` independently but never asserts `end >= start`. An upstream pyannote bug or a malicious local-Speaches container can emit `{start: 10, end: 5}` and the desktop client will receive `duration < 0` — same UI-bug class the Phase 51 fix called out for NaN/negative. A `.refine(s => s.end >= s.start, …)` per segment closes this.

**L-6 — `AgentStreamRequestSchema.messages[].content` is unbounded `z.unknown()`** — `packages/wire-schemas/src/agent.ts:26`

Documented intent: the route forwards `content` verbatim to LiteLLM, which caps downstream. Combined with `.strict()` on the wrapping object the validator still admits arbitrarily-deeply-nested unknown structures with no byte ceiling. Cost-multiplier DoS via 50 messages × multi-MB nested-array content is theoretically possible before LiteLLM rejects. Out of scope for v1 (perf), but worth noting in a future hardening pass.

**L-7 — `V1Failure.code` is unbounded** — `packages/wire-schemas/src/api-keys.ts:80`

`code: z.string().min(1).optional()` has no `.max()`. Every other identifier-shaped string in the package is bounded. Cosmetic.

**L-8 — `SeedTenantResponse.token` has no `.max()`** — `packages/wire-schemas/src/test-only-seed-tenant.ts:39`

`token: z.string().min(1)` is the raw Better Auth bearer. The route is gated behind `OPENWHISPR_TEST_ROUTES=true` so it cannot reach prod, but the bound is missing for symmetry with the rest of the package.

---

## Dead code

| Symbol | File:Line | Note |
|---|---|---|
| `ConversationRoleSchema` | `conversations.ts:19` | M-1 |
| `SttProviderSchema` | `settings.ts:13` | M-2 |
| `AudioFormatSchema` | `settings.ts:16` | M-3 |
| `MAX_REASON_TEXT_LENGTH` | `reason.ts:25` | M-4 |
| `REASON_PROVIDERS` | `reason.ts:28` | M-4 |
| `REASON_PROMPT_MODES` | `reason.ts:31` | M-4 |
| `REASON_MATCH_TYPES` | `reason.ts:34` | M-4 |

Importer scan: `grep -rE "\b<sym>\b" --include="*.ts" apps/ packages/` excluding `wire-schemas/src/` — zero matches for each.

---

## Suppressed warnings

None observed. `grep -nE "@ts-ignore|@ts-nocheck|@ts-expect-error|as any|as unknown as|TODO|FIXME|HACK|XXX"` against `packages/wire-schemas/src/*.ts` returns no matches. The package complies with LOCKER-02 (no type-suppression) and carries no debug markers.

LOCKER scan also clean: no `localhost` / `127.0.0.1` / port literals / UUID literals / secret-shape literals (`sk-…`, `AKIA…`, `Bearer ey…`) — LOCKER-03 compliant. No `NODE_ENV` references — LOCKER-11 compliant.

---

## Conformance check vs `BACKEND_SPEC.md`

Spot-checked against `/Users/nick/openwhispr/docs/BACKEND_SPEC.md`:

- **§Global Error Envelope (lines 49–77):** wire-schemas does NOT export a schema for the bare `{ error: string }` envelope. The `V1Failure` shape at `api-keys.ts:76` (`{success:false,error,code?}`) is intentionally distinct (documented as the `/v1/*` envelope, §R12 in upstream `SERVER-REQUIREMENTS.md`). No divergence — the global envelope is just unmodelled. **Optional follow-up:** add `GlobalErrorEnvelopeSchema = z.object({ error: z.string() })` so route reviewers can assert against it; today there is no zod-level test catching a route that emits `{ message: "..." }` instead of `{ error: "..." }`.
- **§/api/check-user (lines 83–107):** matches. Request `{ email }`, response `{ exists: boolean }`. `CheckUserRequest` adds `.strict()` + `.max(254)` (RFC-5321) which is a tightening, not a divergence.
- **§/api/auth/verification-status:** matches. Same RFC-5321 tightening.
- **§/api/reason, §/api/agent/stream, §/api/agent/web-search, §/api/openai-realtime-token, §/api/streaming-usage, §/api/notes/*, §/api/folders/*, §/api/transcriptions/*, §/api/conversations/*, §/api/stt-config, §/api/note-recording-config:** no byte-for-byte divergence detected; all schemas tighten rather than loosen the spec.

No CRITICAL conformance violations.
