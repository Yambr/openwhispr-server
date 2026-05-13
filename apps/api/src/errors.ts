// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 1 — typed error classes for the centralized
// envelope handler.
//
// Every route throws one of these instead of `reply.status(...).send({...})`.
// `apps/api/src/error-handler.ts` is the SINGLE emission point for the
// `{error:<string>}` envelope (D-13). Inline error sends are an
// anti-pattern (RESEARCH-WIRE § Anti-Patterns).
//
// Phase 10 / Plan 10-01a — each class now carries a stable `code`
// literal so the centralized handler can look up the localized message
// at `errors.<code>` via i18next. Codes are the i18n contract — they
// MUST stay in sync with apps/api/src/i18n/locales/{en,ru}.json (the
// ts-morph completeness test enforces this at CI time).
//
// Phase 10 / Plan 10-01d — constructors accept an OPTIONAL per-instance
// code so route-specific messages can localize independently of the
// class default. Two calling styles:
//
//   new ValidationError("Invalid request")               // legacy — uses class default code
//   new ValidationError("CONVERSATION_ID_REQUIRED", "msg") // new — per-site i18n code
//
// Disambiguation: if BOTH args are strings, the first slot is the code
// and the second is the English fallback message. If only one arg is
// provided, it is treated as the message and the class default code
// applies.
//
// Design choices:
//   * `name = "<ClassName>"` literals so the handler can `instanceof`
//     match without fragile string comparisons.
//   * `code` is a `readonly` string set in the constructor (Error
//     subclasses cannot use class-field initializers reliably across
//     the TS downlevel emit targets we care about — keep it explicit).
//   * No `cause`/metadata fields here — keep the constructor surface
//     minimal so handlers can `throw new AuthError("session expired")`
//     without ceremony.

type Coded = { code: string };

/**
 * Build the (code, message) tuple from the constructor's variadic args.
 * Centralized so every subclass shares one implementation and the
 * "two-arg = explicit code" contract cannot drift between classes.
 */
function pickCodeAndMessage(
  defaultCode: string,
  arg1?: string,
  arg2?: string,
): { code: string; message: string } {
  if (arg1 !== undefined && arg2 !== undefined) {
    return { code: arg1, message: arg2 };
  }
  return { code: defaultCode, message: arg1 ?? "" };
}

/** 400 — request body / query / params failed validation (manual throw). */
export class ValidationError extends Error implements Coded {
  override name = "ValidationError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("VALIDATION_ERROR", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/** 401 — bearer + cookie both missing or invalid (PITFALLS #1). */
export class AuthError extends Error implements Coded {
  override name = "AuthError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("AUTH_ERROR", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/** 404 — route exists but the addressed resource does not. */
export class NotFoundError extends Error implements Coded {
  override name = "NotFoundError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("NOT_FOUND", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends Error implements Coded {
  override name = "RateLimitError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("RATE_LIMITED", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/** 503 — transient infra (DB unavailable, etc.); clients keep polling. */
export class ServiceUnavailable extends Error implements Coded {
  override name = "ServiceUnavailable";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("SERVICE_UNAVAILABLE", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/** 500 — explicit server-side bug. Catch-all default also returns 500. */
export class ServerError extends Error implements Coded {
  override name = "ServerError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("SERVER_ERROR", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/**
 * 502 — upstream provider failure (downstream third-party hop returned
 * a 4xx/5xx, malformed response, or otherwise failed). Distinct from
 * ServiceUnavailable (503) which signals OUR transient infra; 502 means
 * the third-party hop failed.
 */
export class UpstreamError extends Error implements Coded {
  override name = "UpstreamError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("UPSTREAM_ERROR", arg1, arg2);
    super(message);
    this.code = code;
  }
}

/**
 * 409 — resource conflict (uniqueness violation, version mismatch). The
 * envelope handler maps this to status 409.
 */
export class ConflictError extends Error implements Coded {
  override name = "ConflictError";
  readonly code: string;
  constructor(arg1?: string, arg2?: string) {
    const { code, message } = pickCodeAndMessage("CONFLICT", arg1, arg2);
    super(message);
    this.code = code;
  }
}
