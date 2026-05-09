// Phase 2 / Plan 01 / Task 1 — channel-scheme allow-list (D-06).
//
// Source of truth: 02-RESEARCH-AUTH.md § Channel-Scheme Allow-List.
//
// RFC 3986 § 3.1 grammar: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
//
// We intentionally REJECT uppercase even though RFC allows it (case-
// insensitive matching is part of the spec) because every legitimate
// channel scheme we ship is all-lowercase, and rejecting uppercase makes
// the validator stricter without losing any real caller. This closes the
// `JavaScript:` case-bypass vector at the syntactic layer rather than
// relying on a downstream lower-cased deny-list comparison.
const RFC3986_SCHEME = /^[a-z][a-z0-9+\-.]*$/;
const MAX_SCHEME_LEN = 32;

const DANGEROUS_SCHEMES = new Set<string>([
  "javascript",
  "data",
  "file",
  "vbscript",
  "about",
  "chrome",
  "chrome-extension",
]);
// ms-appx, ms-windows-store, ms-help, etc. — Microsoft-protocol family.
const DANGEROUS_PREFIXES = ["ms-"] as const;

const BUILTIN_SCHEMES = ["openwhispr", "openwhispr-dev", "openwhispr-staging"] as const;

export type ValidationResult =
  | { ok: true; scheme: string }
  | { ok: false; reason: string };

/**
 * Validate a candidate channel scheme against the OpenWhispr allow-list.
 *
 * Order of checks (each fails closed):
 *   1. Type + non-empty
 *   2. Length <= MAX_SCHEME_LEN
 *   3. No control characters / DEL
 *   4. Matches RFC 3986 § 3.1 grammar (lowercase only — see file header)
 *   5. Not on the dangerous-scheme deny-list
 *   6. Not on a dangerous prefix (e.g., `ms-*`)
 *   7. On the built-in allow-list, OR matches OPENWHISPR_PROTOCOL override
 */
export function validateScheme(input: string | undefined | null): ValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "scheme is empty" };
  }
  if (input.length > MAX_SCHEME_LEN) {
    return { ok: false, reason: `scheme exceeds ${MAX_SCHEME_LEN} chars` };
  }
  for (let i = 0; i < input.length; i++) {
    const cp = input.charCodeAt(i);
    if (cp < 0x20 || cp === 0x7f) {
      return { ok: false, reason: "scheme contains control character" };
    }
  }
  if (!RFC3986_SCHEME.test(input)) {
    return { ok: false, reason: "scheme does not match RFC 3986 grammar" };
  }
  // The regex already restricts to lowercase, but check the deny-list
  // explicitly so the intent is unambiguous in source.
  const lower = input.toLowerCase();
  if (DANGEROUS_SCHEMES.has(lower)) {
    return { ok: false, reason: "scheme is on the dangerous-scheme deny-list" };
  }
  for (const prefix of DANGEROUS_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { ok: false, reason: `scheme prefix '${prefix}' is denied` };
    }
  }
  const allowed = new Set<string>(BUILTIN_SCHEMES);
  const override = process.env.OPENWHISPR_PROTOCOL?.trim();
  if (override && override.length > 0) {
    allowed.add(override);
  }
  if (!allowed.has(input)) {
    return { ok: false, reason: "scheme is not in the configured allow-list" };
  }
  return { ok: true, scheme: input };
}

/**
 * Build the final custom-protocol redirect URL.
 *
 * `encodeURIComponent` (rather than the default URL serialiser) is used
 * because Better Auth's Bearer plugin emits URL-safe-base64 tokens today
 * but a future token format might contain `+`, `/`, or `=`. PITFALLS #7:
 * Windows argv parsing mangles `+` and `=`, so encoding is belt-and-
 * suspenders against a token-format change.
 */
export function buildProtocolRedirect(scheme: string, token: string): string {
  return `${scheme}://?bearer_token=${encodeURIComponent(token)}`;
}
