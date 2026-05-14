// SPDX-License-Identifier: Apache-2.0
// Phase 13 review HI-02 — Bootstrap-log URL redactor.
//
// The bootstrap catch arms in apps/api/src/index.ts (BullMQ email-delivery
// queue, LiteLLM client construction, Valkey/Redis client) historically
// logged `(err as Error).message`. Both `new Redis(url)` and Node's URL
// parser can throw errors whose message embeds the offending URL verbatim
// (e.g. ioredis "Invalid URL: redis://user:secret@host:6379"). The
// container stdout is shipped to Loki in the Phase-6 LGTM stack — logging
// such a message leaks Valkey passwords / LiteLLM master keys in
// plaintext.
//
// `redactUrl` parses the offending URL and masks the password component
// to "***" before logging. On parse failure it returns a sentinel string;
// the caller still gets a token to log (so the WARN line remains
// informative) without ever including the original credential-bearing
// substring. The redactor is deliberately tiny + dependency-free: it
// runs at bootstrap time (zero observability wiring yet) and must not
// itself throw.

/**
 * Mask the `password` component of a URL-string to "***" before logging.
 *
 * @param raw - candidate URL string. Typical inputs are
 *   `process.env.VALKEY_URL ?? ""` and `process.env.LITELLM_BASE_URL ?? ""`.
 * @returns the URL with `password=***` if parseable and credential-bearing,
 *   the URL unchanged if parseable and credential-free, or
 *   `"<unparseable-url>"` if `new URL(raw)` throws (including the empty
 *   string and whitespace-only inputs — both of which the URL constructor
 *   rejects). Never throws.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) {
      u.password = "***";
    }
    return u.toString();
  } catch {
    return "<unparseable-url>";
  }
}
