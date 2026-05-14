// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 1 — Single zod source of truth for Phase 2
// wire shapes. Imported by both the apps/api route handlers AND the
// CONTRACT-01 conformance suite (Plan 06). If a shape changes, it changes
// HERE — every consumer picks up the new contract automatically.
//
// Source of truth: BACKEND_SPEC.md (upstream). Conventions:
//   * Request schemas: `.strict()` — extra fields rejected (catches typos
//     and mass-assignment surfaces early).
//   * Response schemas: NO `.strict()` — desktop ignores extras, and we
//     keep forward-compat headroom (e.g. audit metadata may grow on
//     `DeleteAccountResponse`).
//   * `ErrorEnvelope` is `.strict()` because the on-the-wire shape MUST be
//     exactly `{error:string}` with NO extras (security — no leak surface).
import { z } from "zod";

/**
 * Global error envelope — every non-2xx response body matches this shape.
 *
 * `.min(1)` on `error` rules out `{error:""}` (which would type-check but
 * is functionally useless). `.strict()` rejects extras (no leaking
 * stack frames or internal state via additional fields).
 */
export const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// POST /api/check-user
export const CheckUserRequest = z.object({ email: z.string().email() }).strict();
export type CheckUserRequest = z.infer<typeof CheckUserRequest>;

export const CheckUserResponse = z.object({ exists: z.boolean() });
export type CheckUserResponse = z.infer<typeof CheckUserResponse>;

// GET /api/auth/verification-status?email=<urlencoded>
export const VerificationStatusQuery = z.object({ email: z.string().email() }).strict();
export type VerificationStatusQuery = z.infer<typeof VerificationStatusQuery>;

export const VerificationStatusResponse = z.object({ verified: z.boolean() });
export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponse>;

// DELETE /api/auth/delete-account — passthrough so the handler may attach
// audit metadata in a future phase without breaking the contract.
export const DeleteAccountResponse = z.object({}).passthrough();
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;

// GET /api/health
//
// Plan 13-01 / Task 13-01-05 — `migrations_completed` added so the e2e-cjm
// harness's wait-for-readiness probe has a deterministic post-migrate
// signal without needing a direct Postgres connection (Postgres is not
// host-bound in the compose stack — see RECON OQ-3). NOT `.strict()` so
// the desktop and old contract consumers can ignore extras and so future
// fields can land without a wire-shape break.
export const HealthResponse = z.object({
  status: z.literal("ok"),
  migrations_completed: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------------------------------------------------------------------
// Phase 3 — LiteLLM-backed endpoints. Source of truth: docs/wire-contracts-phase-3.md
// (extracted verbatim from upstream BACKEND_SPEC.md per D-09). When
// docs/wire-contracts-phase-3.md updates, these schemas update in the
// same commit — no parallel definitions, no drift.
// ---------------------------------------------------------------------

// POST /api/transcribe — multipart audio in, JSON out.
// Note: Request body is multipart so we describe the FIELDS, not a JSON
// body. Contract suite uses FormData; this schema documents the field
// contract for type-safe builders.
export const TranscribeRequestFields = z
  .object({
    file: z.unknown(), // Blob/Buffer in tests, multipart field on wire
    language: z.string().optional(),
    model: z.string().optional(),
    response_format: z.enum(["json", "verbose_json", "text"]).optional(),
  })
  .strict();
export type TranscribeRequestFields = z.infer<typeof TranscribeRequestFields>;

export const TranscribeResponse = z.object({
  text: z.string(),
  wordsUsed: z.number(), // semantics locked in Plan 01 (minutes per A6 default)
  wordsRemaining: z.number(),
  plan: z.string(), // 'unlimited' in v1
  limitReached: z.literal(false), // always false in v1 per WIRE-05
  sttProvider: z.string(),
  sttModel: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(z.unknown()).optional(),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;

// POST /api/reason
export const ReasonRequest = z
  .object({
    text: z.string().min(1),
    model: z.string().optional(),
    provider: z.string().optional(),
    promptMode: z.string().optional(),
    matchType: z.string().optional(),
  })
  .strict();
export type ReasonRequest = z.infer<typeof ReasonRequest>;

export const ReasonResponse = z.object({
  text: z.string(),
  model: z.string(),
  provider: z.string(),
  promptMode: z.string(),
  matchType: z.string(),
});
export type ReasonResponse = z.infer<typeof ReasonResponse>;

// Diarization — shape per docs/wire-contracts-phase-3.md "Diarization"
// section (locked in Plan 01). Two-step pyannote shape OR single-hop
// wrapped shape; Plan 01 records which one. Permissive `passthrough()`
// because the upstream pyannote payload may carry additional fields
// (e.g. confidence scores per segment) we forward without validation.
export const DiarizationResponse = z
  .object({
    segments: z.array(
      z.object({
        start: z.number(),
        end: z.number(),
        speaker: z.string(),
      }),
    ),
  })
  .passthrough();
export type DiarizationResponse = z.infer<typeof DiarizationResponse>;

// ---------------------------------------------------------------------
// Phase 4 — Streaming + realtime token mints. Source of truth:
// BACKEND_SPEC.md §/api/agent/stream (NDJSON chunk vocabulary),
// §/api/streaming-token, §/api/deepgram-streaming-token,
// §/api/openai-realtime-token.
//
// Plan 04-08 / Task 1a (D-28). The chunk schemas mirror BACKEND_SPEC's
// locked v3-era vocabulary byte-for-byte (text-delta / tool-call /
// tool-result / finish). NO Vercel AI SDK v5/v6 vocabulary — those
// chunk type names (`text-start`, `tool-input-start`,
// `tool-output-available`) do not match the wire spec. See 04-CONTEXT.md
// D-01 for the full rationale.
// ---------------------------------------------------------------------

/** NDJSON chunk: `{type:"text-delta", text:"..."}` — token text fragment. */
export const TextDeltaChunk = z
  .object({
    type: z.literal("text-delta"),
    text: z.string(),
  })
  .passthrough();
export type TextDeltaChunk = z.infer<typeof TextDeltaChunk>;

/**
 * NDJSON chunk: `{type:"tool-call", toolCallId, toolName, args}`.
 *
 * Per D-09, args is a COMPLETE parsed object (not a partial JSON string).
 * Tool-call delta accumulation happens server-side; one consolidated
 * chunk is emitted per tool call when `finish_reason==="tool_calls"`.
 */
export const ToolCallChunk = z
  .object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  })
  .passthrough();
export type ToolCallChunk = z.infer<typeof ToolCallChunk>;

/**
 * NDJSON chunk: `{type:"tool-result", toolCallId, result}`.
 *
 * Per D-08, the route is stateless and never executes tools inline —
 * tool-result chunks only appear when LiteLLM itself echoes a tool-result
 * role from the conversation history. The desktop submits tool results
 * by POSTing a follow-up /api/agent/stream with the tool result in
 * `messages`.
 */
export const ToolResultChunk = z
  .object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    result: z.unknown(),
  })
  .passthrough();
export type ToolResultChunk = z.infer<typeof ToolResultChunk>;

/**
 * NDJSON terminal chunk: `{type:"finish", finishReason, usage:{promptTokens, completionTokens}}`.
 *
 * Per D-12, `stream_options.include_usage:true` is forwarded upstream
 * to guarantee the final usage chunk. Server maps LiteLLM
 * `usage.prompt_tokens → promptTokens` and `usage.completion_tokens →
 * completionTokens`. The terminal-chunk contract: the LAST non-empty
 * NDJSON line MUST be a finish chunk so the desktop NDJSON consumer
 * deterministically knows the stream is closed.
 */
export const FinishChunk = z
  .object({
    type: z.literal("finish"),
    finishReason: z.string(),
    usage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
      })
      .passthrough(),
  })
  .passthrough();
export type FinishChunk = z.infer<typeof FinishChunk>;

/**
 * Discriminated union of every NDJSON chunk type emitted by
 * /api/agent/stream. Contract tests parse each non-empty NDJSON line
 * with this schema; any line that doesn't match is a wire-shape
 * regression (T-04-03 mitigation at the contract layer).
 */
export const StreamChunk = z.discriminatedUnion("type", [
  TextDeltaChunk,
  ToolCallChunk,
  ToolResultChunk,
  FinishChunk,
]);
export type StreamChunk = z.infer<typeof StreamChunk>;

/**
 * POST /api/streaming-token (AssemblyAI v3) success body.
 *
 * Wire shape per BACKEND_SPEC.md §/api/streaming-token. The server
 * mints an ephemeral AssemblyAI token via the v3 API and surfaces it
 * verbatim to the desktop. NOT `.strict()` — desktop ignores extras
 * and we keep forward-compat headroom (e.g. ttl echo could be added
 * without breaking existing clients).
 */
export const StreamingTokenResponse = z.object({
  token: z.string().min(1),
});
export type StreamingTokenResponse = z.infer<typeof StreamingTokenResponse>;

/**
 * POST /api/deepgram-streaming-token success body.
 *
 * Same wire shape as AssemblyAI but kept as a SEPARATE named schema
 * for grep clarity and so each provider's contract evolves
 * independently if upstream changes. The route renames Deepgram's
 * `access_token` to `token` server-side per D-15.
 */
export const DeepgramStreamingTokenResponse = z.object({
  token: z.string().min(1),
});
export type DeepgramStreamingTokenResponse = z.infer<typeof DeepgramStreamingTokenResponse>;

// ---------------------------------------------------------------------
// Phase 5 — Operational endpoints. Source of truth: BACKEND_SPEC.md
// §/api/streaming-usage (lines 377-412) + §/api/usage (lines 416-435).
// Plan 05-02 (WIRE-09, WIRE-10).
// ---------------------------------------------------------------------

/**
 * Shared usage-response shape returned by BOTH
 *   - POST /api/streaming-usage (after recording the session)
 *   - GET  /api/usage           (cumulative aggregate)
 *
 * `plan` is literal "unlimited" in v1 (D-12). `limitReached` is literal
 * `false`. `wordsRemaining` is the sentinel 999_999_999. NOT `.strict()`
 * so a future phase can add an audit field without breaking the contract.
 */
export const UsageResponse = z.object({
  wordsUsed: z.number(),
  wordsRemaining: z.number(),
  plan: z.literal("unlimited"),
  limitReached: z.literal(false),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

/** POST /api/streaming-usage response body — same shape as UsageResponse. */
export const StreamingUsageResponse = UsageResponse;
export type StreamingUsageResponse = UsageResponse;

/**
 * POST /api/openai-realtime-token success body.
 *
 * Wire shape per BACKEND_SPEC.md §/api/openai-realtime-token.
 *   * `clientSecret` — convenience field, equals `clientSecrets[0]`.
 *   * `clientSecrets` — array of ephemeral OpenAI Realtime client
 *     secrets, length === streams (always 1 or 2 per D-17).
 * The desktop asserts `clientSecrets.length >= 2` when streams=2.
 *
 * `.min(1)` because the server's fail-fast (Promise.all) guarantees
 * at least one secret on success — partial-failure responses 503 with
 * the canonical envelope rather than serializing a partial body
 * (T-04-01 partial-success-leakage mitigation).
 */
export const OpenAIRealtimeTokenResponse = z.object({
  clientSecret: z.string().min(1),
  clientSecrets: z.array(z.string().min(1)).min(1),
});
export type OpenAIRealtimeTokenResponse = z.infer<typeof OpenAIRealtimeTokenResponse>;
