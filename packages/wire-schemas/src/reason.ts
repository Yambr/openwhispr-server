// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: docs/wire-contracts-phase-3.md / BACKEND_SPEC.md §/api/reason.
//
// Phase 51 / Plan 51-07 (REVIEW CR-11 + wire-schemas HIGH cluster):
//   * text.max() — Phase 41.b fixed the same DoS shape on
//     /api/agent/stream; the /api/reason equivalent was missed. The
//     handler forwards `text` verbatim to LiteLLM, so an unbounded
//     prompt is a cost-multiplier DoS.
//   * model.max() — defence in depth (the route already enum-validates
//     against bundled models downstream, but a multi-MB string is
//     still a useless burden on the parser).
//
// R23 (quick-task 20260521) — request schema aligned with the documented
//   BACKEND_SPEC body the immutable desktop client actually sends:
//   * Every documented optional field is now explicitly modeled and
//     typed (strings / number / string[]); `text` stays required.
//   * `.strict()` -> `.passthrough()` — forward-compat for future client
//     fields. The explicit field list still gives a typed `z.infer`
//     surface and bounds; passthrough only tolerates UNMODELED keys.
//   * provider / promptMode / matchType REMOVED — they are
//     `ReasonResponse` (response-shape) fields and were never sent by
//     the client. The route's response echo is now the constant
//     "default" (see apps/api/src/routes/reason.ts).
import { z } from "zod";

/**
 * Upper bound on the request `text` field. 64 KiB is generous for a
 * cleanup / agent prompt (the LiteLLM context window does the real
 * filtering downstream); we just need to refuse multi-MB payloads
 * that exist to inflate billing or DOS the parser.
 */
export const MAX_REASON_TEXT_LENGTH = 64 * 1024;

/**
 * Generic bound for short metadata strings on the request (sessionId,
 * clientType, language tags, STT descriptors, …). Generous enough for
 * any documented value, tight enough to refuse multi-KB junk.
 */
const MAX_META_STRING_LENGTH = 256;

/** Bound for the free-text prompt-override fields. ≈ 4k tokens. */
const MAX_PROMPT_LENGTH = 16_384;

// POST /api/reason — request body (BACKEND_SPEC §/api/reason).
//
// R28 (quick-task 20260522): every optional field is `.nullish()`
// (=== `.optional().nullable()`), NOT `.optional()`. The immutable
// desktop client builds the body from `opts.model` / `opts.agentName`;
// on the FIRST dictation of a session those are `null` (the store has
// not yet resolved a model/agent), so the body literally contains
// `"model":null`. `.optional()` accepts "key absent" OR the typed value
// but REJECTS `null` — 400-ing the first dictation. `null` for an unset
// optional field is valid JSON and standard client behavior; BACKEND_SPEC
// marks these optional, so "optional" must tolerate `null`. The route
// handler already consumes these fields with `?? default`, which treats
// `null` identically to `undefined`. The `.max()` / `.min()` bounds
// still apply when a non-null value IS present.
export const ReasonRequest = z
  .object({
    text: z.string().min(1).max(MAX_REASON_TEXT_LENGTH),
    model: z.string().min(1).max(128).nullish(),
    agentName: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    customDictionary: z.array(z.string().max(MAX_META_STRING_LENGTH)).nullish(),
    customPrompt: z.string().max(MAX_PROMPT_LENGTH).nullish(),
    systemPrompt: z.string().max(MAX_PROMPT_LENGTH).nullish(),
    language: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    locale: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    sessionId: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    clientType: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    appVersion: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    clientVersion: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    sttProvider: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    sttModel: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    sttLanguage: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    audioFormat: z.string().max(MAX_META_STRING_LENGTH).nullish(),
    sttProcessingMs: z.number().nullish(),
    sttWordCount: z.number().nullish(),
    audioDurationMs: z.number().nullish(),
    audioSizeBytes: z.number().nullish(),
    clientTotalMs: z.number().nullish(),
  })
  .passthrough();
export type ReasonRequest = z.infer<typeof ReasonRequest>;

export const ReasonResponse = z.object({
  text: z.string(),
  model: z.string(),
  provider: z.string(),
  promptMode: z.string(),
  matchType: z.string(),
});
export type ReasonResponse = z.infer<typeof ReasonResponse>;
