// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: docs/wire-contracts-phase-3.md "Diarization" section.
//
// Phase 51 / Plan 51-07 (REVIEW wire-schemas HIGH):
//   * `.passthrough()` removed — upstream pyannote does NOT need extra
//     keys, and accepting arbitrary keys defeats the wire contract.
//     Confidence-per-segment is documented as a per-speaker field, not
//     a sibling of `segments`.
//   * `start` / `end` constrained: finite, non-negative numbers only.
//     Pre-fix accepted NaN, Infinity, and negative values — every one
//     of which produces a downstream rendering bug at minimum and a
//     crash on the desktop client at worst.
//   * `speaker` non-empty so a malformed upstream doesn't propagate
//     empty-string speaker IDs into the UI.
import { z } from "zod";

export const DiarizationResponse = z
  .object({
    segments: z.array(
      z.object({
        start: z.number().finite().nonnegative(),
        end: z.number().finite().nonnegative(),
        speaker: z.string().min(1).max(128),
      }),
    ),
  })
  .strict();
export type DiarizationResponse = z.infer<typeof DiarizationResponse>;
