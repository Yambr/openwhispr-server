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
// Phase 57 / Track D (REVIEW-INDEX byok:CR-01 + byok:CR-02):
//   * CR-01 — added GitHub PAT/OAuth, Tavily, Yandex, and AWS STS
//     session-key prefixes. Tavily + Yandex are SHIPPED web-search
//     providers (apps/api/src/routes/agent/web-search.ts) — their real
//     keys were leaking into boot hints + structured logs verbatim.
//   * CR-02 — lowered the `sk-` body threshold from {20,} to {8,}.
//     LiteLLM virtual keys (the `sk-` prefix + a 16-char hex body) have
//     8-19 char bodies and slipped through the old threshold. {8,} is
//     conservative enough to avoid false positives on ordinary English
//     prose (8+ consecutive [A-Za-z0-9_-] chars after a literal `sk-`
//     is rare).
//
// Shape provenance (doc-verified vs conservative):
//   * GitHub `gh[pousr]_` + 36+ base62 — DOC-VERIFIED (GitHub token
//     format reference: ghp_/gho_/ghu_/ghs_/ghr_, 36-char minimum body).
//   * AWS `AKIA`/`ASIA` + exactly 16 [A-Z0-9] — DOC-VERIFIED (AWS
//     access-key-id format: 4-char prefix + 16 chars; ASIA = STS).
//   * Google `AIza` + 35 — DOC-VERIFIED (Google API key format).
//   * Tavily `tvly-` + {16,40} — CONSERVATIVE: Tavily publishes a 32+
//     char base62 body in dashboard samples; {16,40} errs slightly wide.
//   * Yandex `AQVN` (folder-scoped IAM) + {16,} and `y0_` (OAuth) +
//     {20,} — CONSERVATIVE: Yandex does not publish exact lengths; the
//     prefixes are stable, the body bounds err toward over-redaction.
//   * `sk-`/`sk-ant-` — see CR-02 note above.
//
// No catastrophic backtracking: every alternative is a fixed literal
// prefix followed by a single bounded `[charclass]{n,}` quantifier — no
// nested quantifiers, no `(.+)+`. Safe to run on every logged URL.
const BEARER_SHAPES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{35,}/g,
  // AWS access-key-id (AKIA = permanent) and STS session-key (ASIA).
  /AKIA[A-Z0-9]{16}/g,
  /ASIA[A-Z0-9]{16}/g,
  // GitHub PAT / OAuth — ghp_ gho_ ghu_ ghs_ ghr_ prefixes.
  /gh[pousr]_[A-Za-z0-9]{36,255}/g,
  // Tavily web-search API key.
  /tvly-[A-Za-z0-9]{16,40}/g,
  // Yandex — folder-scoped IAM key (AQVN…) and OAuth token (y0_…).
  /AQVN[A-Za-z0-9_-]{16,}/g,
  /y0_[A-Za-z0-9_-]{20,}/g,
  // JWT — strict three-part match starting with the canonical `eyJ`
  // header. The third segment may be empty for unsigned tokens (rare),
  // but we require it for the redactor (one-token, opaque body).
  //
  // CodeQL #17 (js/polynomial-redos): the prior unbounded
  // `[A-Za-z0-9_-]+` segments backtracked super-linearly on a long
  // `eyJeyJeyJ…` run with no dot terminator (the `eyJ` literal overlaps
  // the segment charclass, so `/g` retried a full O(N) backtrack at
  // every `eyJ` offset → O(N²)). Two changes make the match linear:
  //   1. A `(?<![A-Za-z0-9_-])` lookbehind anchors the start to a
  //      token boundary, so `/g` cannot restart inside a contiguous
  //      base64url run after a failed attempt.
  //   2. Each segment is bounded to {1,8192} — a JWT segment far past
  //      8 KB is not a real token — so a single attempt is bounded.
  // Neither change narrows what is matched for any genuine JWT.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{1,8192}\.eyJ[A-Za-z0-9_-]{1,8192}\.[A-Za-z0-9_-]{1,8192}/g,
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
