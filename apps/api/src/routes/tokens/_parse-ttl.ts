// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12tx2 — REVIEW api-routes-transcriptions HI-6.
// Shared TTL-from-env parser. Pre-fix every tokens route did
// `Number(process.env.X_TOKEN_TTL ?? DEFAULT)` — which silently produced
// `NaN` when the operator set `X_TOKEN_TTL=abc`. NaN then flowed into
// `?expires_in_seconds=NaN` URL params (AssemblyAI v3) or
// `{"ttl_seconds": NaN}` JSON bodies (Deepgram), producing upstream 4xx
// that the route surfaced as 503 "not configured" — misleading the
// operator.
//
// Contract: positive integer in `[1, max]`. On unset → return default.
// On parse failure → return default + log a warn via the supplied
// logger so the operator can see the misconfiguration in Loki without
// the route silently 500-ing on the upstream.

export interface TtlLogger {
  warn: (obj: object, msg: string) => void;
}

export function parseTtlSeconds(
  envValue: string | undefined,
  defaultSeconds: number,
  envVarName: string,
  log: TtlLogger,
  max = 3600,
): number {
  if (envValue === undefined || envValue.length === 0) return defaultSeconds;
  const parsed = Number(envValue);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= max) {
    return parsed;
  }
  log.warn(
    { env_var: envVarName, raw: envValue, fallback: defaultSeconds },
    "malformed TTL env var; falling back to default",
  );
  return defaultSeconds;
}
