// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-01.
//
// `middleware.ts` sets `?from=<pathname>` on its /sign-in redirect so a
// signed-out deep link survives authentication. `SignInForm` consumes it
// as the post-sign-in destination — but a `?from=` value is attacker-
// controllable, so it MUST be validated against a strict same-origin path
// allowlist before it reaches `callbackURL` / `router.push`.
//
// Allowlist (all conditions required):
//   - starts with `/app/` OR equals `/app`
//   - does NOT contain `://` (no embedded scheme)
//   - does NOT contain a backslash (path-traversal / browser-normalisation)
//   - does NOT start with `//` (protocol-relative URL)
// Any value failing the allowlist falls back to the safe default `/app`.

const SAFE_DEFAULT = "/app";

/**
 * Validate a middleware-supplied `?from=` deep-link param and return a
 * same-origin destination. Returns `/app` for any value that is absent,
 * empty, or fails the open-redirect allowlist.
 */
export function safeFromParam(from: string | null | undefined): string {
  if (!from) return SAFE_DEFAULT;
  if (from.includes("://")) return SAFE_DEFAULT;
  if (from.includes("\\")) return SAFE_DEFAULT;
  if (from.startsWith("//")) return SAFE_DEFAULT;
  if (from === "/app" || from.startsWith("/app/")) return from;
  return SAFE_DEFAULT;
}
