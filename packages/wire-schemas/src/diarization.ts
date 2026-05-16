// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: docs/wire-contracts-phase-3.md "Diarization" section.
//
// `passthrough()` because the upstream pyannote payload may carry
// additional fields (e.g. confidence scores per segment) we forward
// without validation.
import { z } from "zod";

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
