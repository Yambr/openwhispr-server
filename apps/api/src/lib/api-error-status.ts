// Phase 02.7 / Plan 03 — D-02 helper.
//
// Resolves a Better Auth `APIError` to a numeric HTTP status, defensively
// handling BOTH possible shapes of the `.status` field:
//
//   * STRING-NAME (e.g. "UNAUTHORIZED") — verified shape in installed
//     better-auth@1.6.9 via the A1 verification probe (see
//     02.7-03-PLAN.md Task 1, run 2026-05-09):
//       typeof e.status === "string", value === "UNAUTHORIZED"
//   * NUMERIC (e.g. 401) — defensive: future Better Auth versions may
//     align `.status` with `.statusCode`. Handle both so a future
//     dependency bump cannot silently break the dual-auth-hook +
//     error-handler envelope mapping.
//
// Unknown / unmapped → 500 (safe-by-default; threat T-02.7-11).
//
// We intentionally read `.status` rather than `.statusCode` because the
// CONTEXT D-02 spec + RESEARCH §D-02 STATUS_MAP both pin behavior on
// `.status`. The narrow `as unknown as { status?: unknown }` cast is
// justified because the public Better Auth type does not stably expose
// the `.status` field type across minor versions (Assumption A1).
import type { APIError } from "better-auth/api";

/** Symbolic-name → numeric HTTP status map (RESEARCH §D-02 STATUS_MAP). */
const STATUS_MAP: Record<string, number> = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

/**
 * Map a Better Auth `APIError` to its numeric HTTP status.
 *
 * @returns numeric HTTP status in [100, 600); falls back to 500 for any
 *   unknown/unmapped shape so callers can safely branch on `>= 500`.
 */
export function resolveApiErrorStatus(err: APIError): number {
  // Assumption A1: `.status` may be string-name OR number across Better
  // Auth minor versions. Public type does not stably expose this field.
  const raw = (err as unknown as { status?: unknown }).status;

  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw < 600) {
    return raw;
  }

  if (typeof raw === "string" && raw in STATUS_MAP) {
    return STATUS_MAP[raw] as number;
  }

  // Defensive fallback: if Better Auth ever emits a name we don't know,
  // surface as 500 rather than guessing — caller's `>= 500` branch then
  // (correctly) treats it as an infra-error to bubble.
  return 500;
}
