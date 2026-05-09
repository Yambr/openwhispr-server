// Phase 2 / Plan 03 / Task 1 — typed error classes for the centralized
// envelope handler.
//
// Every route throws one of these instead of `reply.status(...).send({...})`.
// `apps/api/src/error-handler.ts` is the SINGLE emission point for the
// `{error:<string>}` envelope (D-13). Inline error sends are an
// anti-pattern (RESEARCH-WIRE § Anti-Patterns).
//
// Design choices:
//   * `name = "<ClassName>"` literals so the handler can `instanceof`
//     match without fragile string comparisons.
//   * No `cause`/metadata fields here — keep the constructor surface
//     minimal so handlers can `throw new AuthError("session expired")`
//     without ceremony. If a class needs metadata in the future, add it
//     as an optional second arg and update the handler accordingly.

/** 400 — request body / query / params failed validation (manual throw). */
export class ValidationError extends Error {
  override name = "ValidationError";
}

/** 401 — bearer + cookie both missing or invalid (PITFALLS #1). */
export class AuthError extends Error {
  override name = "AuthError";
}

/** 404 — route exists but the addressed resource does not. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends Error {
  override name = "RateLimitError";
}

/** 503 — transient infra (DB unavailable, etc.); clients keep polling. */
export class ServiceUnavailable extends Error {
  override name = "ServiceUnavailable";
}

/** 500 — explicit server-side bug. Catch-all default also returns 500. */
export class ServerError extends Error {
  override name = "ServerError";
}
