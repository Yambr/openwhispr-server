// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 1 — minutesFromDuration helper.
//
// Minutes of audio rounded UP — semantics for usage_ledger kind
// 'transcribe_minutes'. wordsUsed semantics locked in docs/wire-contracts-phase-3.md
// ("Decision: wordsUsed semantics"). Phase 3 Plan 01 chose minutes-of-audio
// over literal-word-count to match the ledger kind so the unit binding stays
// internally consistent across (response shape, ledger row, observability
// label).
//
// The helper is defensive: undefined/null/0/negative inputs all map to 0 so
// callers can pass the upstream Whisper response straight through (the
// `duration` field is OPTIONAL in OpenAI's transcription response when
// `response_format=json` rather than `verbose_json`).

export function minutesFromDuration(seconds: number | undefined | null): number {
  if (seconds === undefined || seconds === null) return 0;
  if (seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}
