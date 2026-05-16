// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — typed error classes for LiteLLM client.
//
// Two distinct error types so route handlers can map cleanly:
//   * MissingProviderKeyError -> 503 envelope (operator-actionable: set
//     OPENROUTER_API_KEY / GROQ_API_KEY / PYANNOTE_API_KEY in .env).
//     This is RESEARCH Pitfall #8 — silent 401-from-upstream looks like
//     a user auth failure to the desktop and triggers logout. We MUST
//     pre-check provider keys on the bundled-default path and surface a
//     503 with operator instructions instead.
//   * LitellmUpstreamError -> 502 envelope (LiteLLM proxy itself
//     misbehaved or the underlying provider returned non-2xx).
//
// Threat T-03-03-01 (LITELLM_MASTER_KEY in error message): bodyText is
// truncated to 200 chars and the auth header is NEVER passed through.

export class MissingProviderKeyError extends Error {
  public readonly envVar: string;
  public readonly model: string;

  constructor(envVar: string, model: string) {
    super(`${envVar} is not configured. Set it in .env to enable model "${model}" via LiteLLM.`);
    this.name = "MissingProviderKeyError";
    this.envVar = envVar;
    this.model = model;
  }
}

export class LitellmUpstreamError extends Error {
  public readonly status: number;
  // Phase 37 / CRIT-FIX-09 (CR-9). bodyText is truncated AT CONSTRUCTION
  // and held as a non-enumerable own property so pino's default `err`
  // serializer (which walks own enumerable properties) cannot exfiltrate
  // the upstream payload into Loki. Override of `toJSON()` below is the
  // belt-and-braces second layer (pino calls `err.toJSON()` if present).
  private readonly bodyText: string;

  constructor(status: number, bodyText: string, message?: string) {
    // Truncate body to 200 chars in the default message so we never echo
    // a verbose upstream payload (which could include secret-shaped
    // provider responses) into our own log surface.
    const truncated = bodyText.slice(0, 200);
    super(message ?? `LiteLLM upstream returned ${status}: ${truncated}`);
    this.name = "LitellmUpstreamError";
    this.status = status;
    // Non-enumerable: drops the field from JSON.stringify(err) entirely,
    // closing the V7 STRIDE Info-Disclosure surface even if pino's err
    // serializer is bypassed by a downstream `log.warn({ err })` call.
    Object.defineProperty(this, "bodyText", {
      value: truncated,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * pino's default `err` serializer calls `err.toJSON()` when present.
   * Returning only the safe triple guarantees bodyText never reaches
   * structured-log shipping even via that path.
   */
  toJSON(): { name: string; message: string; status: number } {
    return { name: this.name, message: this.message, status: this.status };
  }
}
