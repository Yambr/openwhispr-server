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
export const HealthResponse = z.object({ status: z.literal("ok") });
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
