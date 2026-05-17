// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 04 / Task 1 — Vendored copy of apps/api/src/lib/redact-url.ts
// (Phase 13 HI-02 helper). Vendored rather than imported to keep
// `packages/byok-guard/` self-contained — the package is consumed by BOTH
// `apps/api` and `apps/worker` and a reverse `apps/api → packages/byok-guard`
// dependency would violate workspace boundaries (the `apps/*` <- `packages/*`
// import direction is one-way per the monorepo conventions).
//
// SOURCE OF TRUTH: this file (Phase 40 supersedes the apps/api/src/lib copy).
// Phase 40 / Sub-fix 40.b (HIGH-FIX-BYOK-02) — extended to mask:
//   * URL.password (original behavior)
//   * URL.username (Phase 40)
//   * Query-string credential params (api_key, apikey, api-key, token,
//     access_token, refresh_token, key, code, secret, signature,
//     password, X-Amz-Signature, X-Amz-Credential, X-Amz-Security-Token,
//     and any *_api_key the codebase may grep up — parity test pins it)
//   * Bearer-token-shaped path segments (sk-…, sk-ant-…, AIza…, AKIA…)
//
// The redactor runs from the boot-time loud-fail path (assertBYOKConfig)
// where no observability is wired yet, so it must be tiny, synchronous,
// and infallible.

/**
 * Case-insensitive predicate: does the query-param NAME look like a
 * credential? Matches:
 *   - api_key / apikey / api-key (any case, any separator)
 *   - token / access_token / refresh_token / id_token
 *   - key / code / secret / signature / password
 *   - any X-Amz-* SigV4 credential param
 *   - any *_api_key (catches future env-var-named query params; this
 *     is the rule the parity test exercises)
 */
function isCredentialParam(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "key" || n === "code" || n === "secret" || n === "signature" || n === "password") {
    return true;
  }
  if (n === "token" || n.endsWith("_token") || n === "access_token" || n === "refresh_token") {
    return true;
  }
  // api_key, apikey, api-key, *_api_key, *_apikey
  if (/api[-_]?key$/.test(n)) return true;
  // AWS SigV4: x-amz-signature, x-amz-credential, x-amz-security-token
  if (n === "x-amz-signature" || n === "x-amz-credential" || n === "x-amz-security-token") {
    return true;
  }
  return false;
}

/**
 * Bearer-token shapes embedded in path segments / query values / hash fragments.
 *
 * Phase 51 / Plan 51-02 (REVIEW-INDEX CR-10):
 *   * Added JWT three-part shape `eyJ<base64url>.eyJ<base64url>.<base64url>`.
 *     Better Auth session tokens, OAuth2 ID tokens, and most realtime
 *     ephemeral bearers (OpenAI, AssemblyAI, Deepgram) fit this shape.
 *     The first segment MUST start with `eyJ` because the header is
 *     `{"alg":"…","typ":"JWT"}` which base64url-encodes to that prefix
 *     in 100% of practical cases.
 */
const BEARER_SHAPES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AIza[A-Za-z0-9_-]{35,}/g,
  /AKIA[A-Z0-9]{16,}/g,
  // JWT — strict three-part match starting with the canonical `eyJ`
  // header. The third segment may be empty for unsigned tokens (rare),
  // but we require it for the redactor (one-token, opaque body).
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

/**
 * Apply BEARER_SHAPES sweep to an opaque string slot (path / query value /
 * hash). Returns the redacted string.
 */
function sweepBearerShapes(input: string): string {
  let out = input;
  for (const re of BEARER_SHAPES) {
    out = out.replace(re, "***");
  }
  return out;
}

/**
 * Mask credential-bearing components of a URL string to "***" before logging.
 *
 * Covered surfaces (Phase 40 sub-fix 40.b — HIGH-FIX-BYOK-02):
 *   1. URL userinfo (username AND password)
 *   2. Query-string credential params (api_key, token, AWS SigV4, …)
 *   3. Bearer-shaped path segments (sk-…, sk-ant-…, AIza…, AKIA…)
 *
 * @param raw - candidate URL string. Typical inputs are credential-bearing
 *   `S3_ENDPOINT`, `DATABASE_URL`, signed S3 presigned URLs, etc.
 * @returns the URL with every detected credential masked to "***" (or
 *   `"<unparseable-url>"` if `new URL(raw)` throws). Never throws.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username) {
      u.username = "***";
    }
    if (u.password) {
      u.password = "***";
    }
    // Query-string sweep — iterate keys once, replace credential values
    // (by name) AND apply BEARER_SHAPES to every value (so a JWT or
    // sk-…-shape carried in `?next=…` etc. is masked even though the
    // param name is innocuous; CR-10 / byok-guard CR-01).
    const params = u.searchParams;
    const keys = [...params.keys()];
    for (const k of keys) {
      if (isCredentialParam(k)) {
        // `set` collapses repeats to a single value — acceptable for
        // log redaction (we don't echo the URL back into a signing
        // pipeline; we only render it for an operator).
        params.set(k, "***");
        continue;
      }
      const v = params.get(k);
      if (v === null) continue;
      const swept = sweepBearerShapes(v);
      if (swept !== v) params.set(k, swept);
    }
    // Bearer-shape sweep on the pathname. We apply each shape in
    // order (sk-ant- before sk-, longest-prefix-first so we don't
    // partially mask the ant-prefixed key).
    u.pathname = sweepBearerShapes(u.pathname);

    // Phase 51 / Plan 51-02 (REVIEW CR-10 / byok-guard CR-02) — URL
    // fragment. OAuth2 implicit-flow access tokens live here
    // (`#access_token=…`) and were preserved verbatim by the pre-fix
    // implementation. Strategy: if the fragment looks like a
    // `&`-separated key/value list, mask credential-named keys; then
    // run the bearer-shape sweep over what remains (handles opaque
    // tokens deposited in the fragment without a key=value form).
    if (u.hash) {
      // u.hash includes the leading "#".
      const raw = u.hash.slice(1);
      const parts = raw.split("&").map((kv) => {
        const eq = kv.indexOf("=");
        if (eq < 0) return sweepBearerShapes(kv);
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1);
        if (isCredentialParam(decodeURIComponent(key))) {
          return `${key}=***`;
        }
        return `${key}=${sweepBearerShapes(val)}`;
      });
      u.hash = `#${parts.join("&")}`;
    }
    return u.toString();
  } catch {
    return "<unparseable-url>";
  }
}
