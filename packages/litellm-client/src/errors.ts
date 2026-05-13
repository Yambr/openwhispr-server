// SPDX-License-Identifier: Apache-2.0
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
    super(
      `${envVar} is not configured. Set it in .env to enable model "${model}" via LiteLLM.`,
    );
    this.name = "MissingProviderKeyError";
    this.envVar = envVar;
    this.model = model;
  }
}

export class LitellmUpstreamError extends Error {
  public readonly status: number;
  public readonly bodyText: string;

  constructor(status: number, bodyText: string, message?: string) {
    // Truncate body to 200 chars in the default message so we never echo
    // a verbose upstream payload (which could include secret-shaped
    // provider responses) into our own log surface.
    super(message ?? `LiteLLM upstream returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "LitellmUpstreamError";
    this.status = status;
    this.bodyText = bodyText;
  }
}
