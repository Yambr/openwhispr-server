// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 10 / Task 1 — WIRE-29 + WIRE-16 negative-matrix
// inventory + tolerant envelope schema.
//
// Constants extracted into a non-test module so both
// `negative-matrix.test.ts` (the matrix itself) and
// `__tests__/negative-matrix-enumeration.test.ts` (the Pitfall #6
// runtime coverage check) can import the same source of truth without
// re-declaration drift.
//
// See `negative-matrix.test.ts` for behavior + D-33..D-36 rationale.

import { z } from "zod";

/**
 * Tolerant envelope matcher (D-33) — accepts BOTH the default
 * `{error: string}` envelope (D-34, every Phase 5 endpoint) AND the
 * structured `{error: {message, code?}}` envelope (BACKEND_SPEC.md:745,
 * reserved for future structured-error sites).
 */
export const TolerantEnvelope = z.union([
  z.object({ error: z.string().min(1) }),
  z.object({
    error: z.object({
      message: z.string().min(1),
      code: z.string().optional(),
    }),
  }),
]);
export type TolerantEnvelope = z.infer<typeof TolerantEnvelope>;

/**
 * Each tuple is `{ method, path, hasBody? }` where `hasBody` (when
 * true) means the route accepts a JSON request body — the negative
 * matrix's malformed-body sub-case sends `{"__invalid_field__":true}`
 * with `content-type: application/json`.
 */
export interface RouteSpec {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  /** Set for routes that accept a JSON body (POST/PATCH/DELETE w/ body). */
  readonly hasBody?: boolean;
}

/**
 * Phase 5 implemented routes inventory — every `/api/*` path
 * registered by `buildAllRoutes` for Phase 5 plans 02..09. The
 * negative matrix walks this list to prove envelope conformance.
 *
 * The enumeration sanity test (`negative-matrix-enumeration.test.ts`)
 * asserts every runtime `/api/*` route appears here OR in
 * `PHASE_2_4_BASELINE_ROUTES` — adding a route without updating this
 * inventory fails CI loudly (Pitfall #6 mitigation).
 */
export const PHASE_5_ROUTES: readonly RouteSpec[] = [
  // Phase 05 / Plan 02 — usage ledger (WIRE-09, WIRE-10)
  { method: "POST", path: "/api/streaming-usage", hasBody: true },
  { method: "GET", path: "/api/usage" },
  // Phase 05 / Plan 03 — agent web-search (WIRE-08)
  { method: "POST", path: "/api/agent/web-search", hasBody: true },
  // Phase 05 / Plan 04 — settings reads (WIRE-11, WIRE-12)
  { method: "GET", path: "/api/stt-config" },
  { method: "GET", path: "/api/note-recording-config" },
  // Phase 05 / Plan 05 — notes CRUD (WIRE-22)
  { method: "POST", path: "/api/notes/create", hasBody: true },
  { method: "POST", path: "/api/notes/batch-create", hasBody: true },
  { method: "PATCH", path: "/api/notes/update", hasBody: true },
  { method: "DELETE", path: "/api/notes/delete", hasBody: true },
  { method: "DELETE", path: "/api/notes/delete-all" },
  { method: "GET", path: "/api/notes/list" },
  { method: "POST", path: "/api/notes/search", hasBody: true },
  // Phase 05 / Plan 06 — folders CRUD (WIRE-23)
  { method: "POST", path: "/api/folders/create", hasBody: true },
  { method: "POST", path: "/api/folders/batch-create", hasBody: true },
  { method: "PATCH", path: "/api/folders/update", hasBody: true },
  { method: "DELETE", path: "/api/folders/delete", hasBody: true },
  { method: "GET", path: "/api/folders/list" },
  // Phase 05 / Plan 07 — conversations + messages (WIRE-24, WIRE-25)
  { method: "POST", path: "/api/conversations/create", hasBody: true },
  { method: "PATCH", path: "/api/conversations/update", hasBody: true },
  { method: "DELETE", path: "/api/conversations/delete", hasBody: true },
  { method: "GET", path: "/api/conversations/list" },
  { method: "POST", path: "/api/conversations/search", hasBody: true },
  { method: "POST", path: "/api/conversations/messages", hasBody: true },
  { method: "GET", path: "/api/conversations/messages" },
  // Phase 05 / Plan 08 — transcriptions CRUD (WIRE-26)
  { method: "POST", path: "/api/transcriptions/create", hasBody: true },
  { method: "POST", path: "/api/transcriptions/batch-create", hasBody: true },
  { method: "GET", path: "/api/transcriptions/list" },
  { method: "DELETE", path: "/api/transcriptions/delete", hasBody: true },
  { method: "POST", path: "/api/transcriptions/batch-delete", hasBody: true },
  // Phase 05 / Plan 09 — api keys CRUD (WIRE-27)
  { method: "GET", path: "/api/v1/keys/list" },
  { method: "POST", path: "/api/v1/keys/create", hasBody: true },
  // /api/v1/keys/:id/revoke — synthetic UUID exercises route registration
  {
    method: "POST",
    path: "/api/v1/keys/11111111-2222-3333-4444-555555555555/revoke",
    hasBody: true,
  },
] as const;

/**
 * Phase 2-4 routes — baseline surface registered before Phase 5.
 *
 * The enumeration sanity test unions this with `PHASE_5_ROUTES` when
 * whitelisting runtime fastify routes. MUST track
 * `apps/api/src/routes/index.ts` — a missing entry here for a
 * registered route fails the enumeration test (Pitfall #6).
 *
 * `:param` placeholders match the Fastify route declaration; the
 * enumeration test's path matcher normalizes UUIDs in runtime paths
 * to `:param` before comparison.
 */
export const PHASE_2_4_BASELINE_ROUTES: readonly string[] = [
  "/api/health",
  "/api/check-user",
  "/api/auth/verification-status",
  "/api/auth/delete-account",
  "/api/desktop-signin/:provider",
  "/api/auth/desktop-callback/:provider",
  // Better Auth universal handler mount
  "/api/auth/*",
  // Phase 4 streaming-token mints (registered unconditionally)
  "/api/streaming-token",
  "/api/deepgram-streaming-token",
  "/api/openai-realtime-token",
  // Phase 3 — registered when LITELLM_MASTER_KEY is wired
  "/api/transcribe",
  "/api/reason",
  "/api/agent/stream",
  // Phase 3 realtime WSS reverse-proxy (registered when masterKey present)
  "/v1/realtime",
  // Phase 3 diarization (registered when redis client present)
  "/v1/audio/diarization",
  // Test-only diagnostic seam (gated on OPENWHISPR_TEST_ROUTES=true)
  "/api/_test/force-rotate",
  "/api/_test/health-authed",
  "/api/_test/litellm-baseurl",
  "/api/_test/route-list",
] as const;

/**
 * Out-of-scope paths per 05-CONTEXT.md. Stripe billing + referrals are
 * v2-deferred — the matrix asserts they surface as 404 with the
 * canonical envelope today via Phase 2's `setNotFoundHandler` (D-35).
 * Mitigates T-OUT-OF-SCOPE-LEAK.
 */
export const OUT_OF_SCOPE_PATHS: readonly { method: "GET" | "POST"; path: string }[] = [
  { method: "POST", path: "/api/stripe/checkout" },
  { method: "POST", path: "/api/stripe/portal" },
  { method: "POST", path: "/api/stripe/switch-plan" },
  { method: "POST", path: "/api/stripe/preview-switch" },
  { method: "GET", path: "/api/referrals/stats" },
  { method: "POST", path: "/api/referrals/invite" },
  { method: "GET", path: "/api/referrals/invites" },
] as const;
