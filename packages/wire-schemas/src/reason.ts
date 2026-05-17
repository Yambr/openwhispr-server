// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: docs/wire-contracts-phase-3.md / BACKEND_SPEC.md §/api/reason.
//
// Phase 51 / Plan 51-07 (REVIEW CR-11 + wire-schemas HIGH cluster):
//   * text.max() — Phase 41.b fixed the same DoS shape on
//     /api/agent/stream; the /api/reason equivalent was missed. The
//     handler forwards `text` verbatim to LiteLLM, so an unbounded
//     prompt is a cost-multiplier DoS.
//   * provider / promptMode / matchType enums — the handler at
//     apps/api/src/routes/reason.ts:149-151 echoes these fields back
//     into the response unchanged, so a client can poison documented
//     wire-surface values. Bound to the documented spec values.
//   * model.max() — defence in depth (the route already enum-validates
//     against bundled models downstream, but a multi-MB string is
//     still a useless burden on the parser).
import { z } from "zod";

/**
 * Upper bound on the request `text` field. 64 KiB is generous for a
 * cleanup / agent prompt (the LiteLLM context window does the real
 * filtering downstream); we just need to refuse multi-MB payloads
 * that exist to inflate billing or DOS the parser.
 */
export const MAX_REASON_TEXT_LENGTH = 64 * 1024;

/** Provider IDs the bundled `MODEL_PROVIDER` table maps to. */
export const REASON_PROVIDERS = ["openai", "anthropic", "groq", "openrouter", "litellm"] as const;

/** Documented prompt modes (BACKEND_SPEC.md §/api/reason response shape). */
export const REASON_PROMPT_MODES = ["default", "cleanup", "agent"] as const;

/** Documented match types (BACKEND_SPEC.md §/api/reason response shape). */
export const REASON_MATCH_TYPES = ["default", "cleanup", "agent"] as const;

// POST /api/reason
export const ReasonRequest = z
  .object({
    text: z.string().min(1).max(MAX_REASON_TEXT_LENGTH),
    model: z.string().min(1).max(128).optional(),
    provider: z.enum(REASON_PROVIDERS).optional(),
    promptMode: z.enum(REASON_PROMPT_MODES).optional(),
    matchType: z.enum(REASON_MATCH_TYPES).optional(),
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
