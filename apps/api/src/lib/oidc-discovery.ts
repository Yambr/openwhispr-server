// SPDX-License-Identifier: FSL-1.1-ALv2
// Shared OIDC discovery fetcher (extracted from mint-bearer.ts, Phase 02.16
// HI-04). One source of truth for resolving an issuer's
// `${issuer}/.well-known/openid-configuration` metadata document, used by:
//   * lib/mint-bearer.ts — desktop-callback code-exchange (token + userinfo).
//   * routes/desktop-signin.ts — desktop-signin authorize redirect (#10:
//     authorization_endpoint, so a non-`/authorize` IdP like Dex's `/auth`
//     works without a manual OIDC_AUTHORIZE_URL).
//
// HI-04 security posture (preserved verbatim from the original):
//   * The doc is zod-validated before caching; an unvalidated doc fails loud.
//   * Each endpoint is checked for https + issuer-origin affiliation BEFORE
//     caching (assertEndpointAffiliated) — a poisoned discovery response
//     cannot redirect the client_secret exchange (token_endpoint) NOR phish
//     the user with an attacker authorize page (authorization_endpoint, #10).
//     Default-deny; split-domain IdPs set OIDC_DISCOVERY_ALLOWED_ORIGINS.
//   * Bounded LRU + 60-min TTL cache (rotated IdP recovers on the next miss;
//     no unbounded process-lifetime poisoning).
//   * Error messages carry the HTTP status only, NEVER the response body
//     (a misconfigured proxy could leak PII / attacker values).
//
// `authorization_endpoint` is OPTIONAL in the schema: mint-bearer's
// code-exchange path reads only token/userinfo and MUST NOT regress on a doc
// that omits authorize (and no mint-bearer fixture needs to change).
// desktop-signin requires it post-fetch and 503s when absent.

import { LRUCache } from "lru-cache";
import { z } from "zod";

// HI-04 — the OIDC discovery doc is zod-validated before caching.
// `token_endpoint` / `userinfo_endpoint` MUST be absolute https:// URLs;
// `authorization_endpoint` is optional (only the desktop-signin authorize
// path needs it). The scheme + same-origin checks in discoverOidc additionally
// pin each present endpoint to the issuer's origin so a poisoned discovery
// response cannot redirect the client_secret exchange or phish the user.
const OidcDiscoveryDocSchema = z.object({
  authorization_endpoint: z.string().url().optional(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
});
export type OidcDiscoveryDoc = z.infer<typeof OidcDiscoveryDocSchema>;

// HI-04 — bounded, TTL'd cache for the OIDC discovery doc.
//
// OIDC Discovery 1.0 §4 explicitly permits caching the metadata document.
// `lru-cache` provides bounded-size + TTL natively: `max` evicts the
// least-recently-used issuer on overflow; `ttl` (60 min) lets a refreshed IdP
// recover on the next call — an expired entry is a transparent miss.
const MAX_CACHE_ENTRIES = 16;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoveryCache = new LRUCache<string, OidcDiscoveryDoc>({
  max: MAX_CACHE_ENTRIES,
  ttl: DISCOVERY_TTL_MS,
  // `Date.now()` is the TTL clock — keeps expiry deterministically
  // controllable under test fake timers (immaterial at 60-min granularity).
  perf: { now: () => Date.now() },
  ttlResolution: 0,
});

/**
 * HI-04 — assert an OIDC endpoint URL is an https:// URL whose origin
 * matches the issuer's origin (or an explicit operator-configured allowlist
 * origin). A non-affiliated origin on `token_endpoint` is the attacker
 * primitive that redirects the `client_secret` exchange; on
 * `authorization_endpoint` (#10) it redirects the USER's browser (carrying
 * the real client_id + state + PKCE challenge) to an attacker authorize page
 * — a phishing / auth-interception primitive. Default-deny: a legitimate
 * split-domain IdP sets `OIDC_DISCOVERY_ALLOWED_ORIGINS` (csv of https origins).
 */
function assertEndpointAffiliated(label: string, endpoint: string, issuerOrigin: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`oidc-discovery: ${label} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`oidc-discovery: ${label} must be https`);
  }
  if (url.origin === issuerOrigin) return;
  const allowed = (process.env.OIDC_DISCOVERY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (allowed.includes(url.origin)) return;
  throw new Error(`oidc-discovery: ${label} origin not affiliated with issuer`);
}

/**
 * Fetch (and cache) the OIDC issuer's discovery doc. Per RFC 8414 / OpenID
 * Connect Discovery 1.0 §4, the metadata document lives at
 * `${issuer}/.well-known/openid-configuration`. Operators set ONE env var
 * (OIDC_ISSUER_URL) and we resolve the rest — matching Better Auth
 * genericOAuth's lazy-discovery contract.
 *
 * HI-04 — the fetched document is zod-validated AND each PRESENT endpoint is
 * checked for https + issuer-origin affiliation BEFORE caching; an expired
 * cache entry is treated as a miss and re-fetched. Error messages include the
 * HTTP status only, NEVER the response body.
 */
export async function discoverOidc(issuerUrl: string): Promise<OidcDiscoveryDoc> {
  const issuer = issuerUrl.replace(/\/+$/, "");
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`oidc-discovery: discovery ${res.status} (issuer=${issuer})`);
  }
  const parsed = OidcDiscoveryDocSchema.safeParse(await res.json());
  if (!parsed.success) {
    // HI-04 — never cache an unvalidated doc; fail loud (no body leak).
    throw new Error(`oidc-discovery: discovery doc failed schema validation (issuer=${issuer})`);
  }
  const doc = parsed.data;

  let issuerOrigin: string;
  try {
    issuerOrigin = new URL(issuer).origin;
  } catch {
    throw new Error(`oidc-discovery: OIDC_ISSUER_URL is not a valid URL`);
  }
  // authorization_endpoint is optional — guard before asserting.
  if (doc.authorization_endpoint) {
    assertEndpointAffiliated("authorization_endpoint", doc.authorization_endpoint, issuerOrigin);
  }
  assertEndpointAffiliated("token_endpoint", doc.token_endpoint, issuerOrigin);
  assertEndpointAffiliated("userinfo_endpoint", doc.userinfo_endpoint, issuerOrigin);

  // HI-04 — cache only after zod-validation + origin-affiliation pass.
  discoveryCache.set(issuer, doc);
  return doc;
}

/** Test-only: clear the discovery cache between vitest runs. */
export function __resetOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}
