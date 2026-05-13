// SPDX-License-Identifier: Apache-2.0
// Phase 03 Plan 08 — map a LiteLLM model alias to the matching usage_ledger
// `kind` value. Mirrors the per-route kind constants used by the api:
//   * /api/transcribe -> 'transcribe_minutes' (Plan 04)
//   * /api/reason     -> 'reason_tokens'      (Plan 05)
//   * /v1/realtime    -> 'realtime_minutes'   (Plan 07)
//
// The worker side reads the model column on LiteLLM_SpendLogs and infers
// kind from it because LiteLLM does not propagate the per-route kind
// downstream — only the model alias survives. Unknown aliases fall back
// to 'reason_tokens' (the safe default — token-priced models are the
// most common surface; mis-labelling minutes-priced models would be
// worse since the units column would be a token count).
export type LedgerKind =
  | "transcribe_minutes"
  | "reason_tokens"
  | "realtime_minutes";

export function inferKind(model: string): LedgerKind {
  if (model === "whisper-large-v3" || model.includes("whisper")) {
    return "transcribe_minutes";
  }
  if (model.includes("realtime")) {
    return "realtime_minutes";
  }
  return "reason_tokens";
}
