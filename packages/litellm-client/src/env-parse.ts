// SPDX-License-Identifier: FSL-1.1-ALv2
// AUDIT-LIB-01 (LIB-1) — single shared positive-number env parser.
//
// Before this module, five copies of the same logic existed under four
// names: `readPositiveInt` (apps/api config/diarization.ts +
// config/web-search.ts), `numericEnv` (config/realtime.ts),
// `parsePositiveIntEnv` (this package's config.ts) and an inline
// `parseTimeoutEnv` (apps/api index.ts). They drifted on two axes:
// integer-only vs. any-positive-finite, and return-fallback vs.
// return-undefined-and-warn.
//
// This helper lives in `@openwhispr/litellm-client` because that package
// has NO Zod dependency (deps: undici, yaml) and is depended on by
// `@openwhispr/api` — so a single plain function here is importable by
// every call site without forcing Zod across the package boundary or
// inventing a new shared utility package. The audit explicitly sanctions
// "a single plain shared function" for exactly this boundary.

/** Options for {@link parsePositiveNumberEnv}. */
export interface ParsePositiveNumberEnvOptions {
  /**
   * When true, the value must additionally be an integer; a finite
   * positive non-integer is treated as invalid. Default: false
   * (any finite positive number is accepted — e.g. VAD tuning floats).
   */
  integer?: boolean;
  /**
   * Invoked with the trimmed raw string when it was present but failed
   * validation (not invoked for an unset/empty var). Lets a call site
   * emit a structured warn while still falling back to the default —
   * preserves the `parseTimeoutEnv` boot-log behavior.
   */
  onInvalid?: (rawTrimmed: string) => void;
}

/**
 * Parse a positive number from an env var.
 *
 * Returns `fallback` when the var is unset, empty/whitespace, or fails
 * validation (not finite, not positive, or — with `integer: true` — not
 * an integer). A malformed knob must never silently zero a timeout or a
 * poll cadence, so the fallback is always a sane positive default.
 *
 * @param raw      The raw env value (e.g. `process.env.FOO`).
 * @param fallback The default returned for unset/empty/invalid input.
 * @param opts     Optional integer-only enforcement + invalid-value hook.
 */
export function parsePositiveNumberEnv(
  raw: string | undefined,
  fallback: number,
  opts: ParsePositiveNumberEnvOptions = {},
): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const n = Number(trimmed);
  const valid = Number.isFinite(n) && n > 0 && (opts.integer !== true || Number.isInteger(n));
  if (!valid) {
    opts.onInvalid?.(trimmed);
    return fallback;
  }
  return n;
}

/**
 * Convenience wrapper for the common integer-only case (timeouts, ceilings,
 * poll intervals). Equivalent to `parsePositiveNumberEnv(raw, fallback,
 * { integer: true })`.
 */
export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  return parsePositiveNumberEnv(raw, fallback, { integer: true });
}
