// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 / Task 1 — cookie-domain resolver (PITFALLS #5 / AUTH-07).
//
// Source of truth: 02-RESEARCH-AUTH.md § Cookie Host Scoping.
//
// Topologies:
//   1. AUTH_URL == OPENWHISPR_API_URL (single host) → omit `domain`. The
//      browser scopes the cookie to the host that set it.
//   2. AUTH_URL ≠ OPENWHISPR_API_URL but they share an eTLD+1
//      (e.g. auth.example.com / api.example.com) → set `domain=.example.com`
//      so the cookie travels between sibling subdomains.
//   3. Unrelated hosts → throw at boot. v1 deliberately does not support
//      cross-host installs without a shared parent — silent breakage of
//      the verification-status polling loop is far more painful than a
//      loud boot-time refusal.
//
// We do NOT rely on a Public Suffix List (PSL) lookup. PSL would correctly
// reject `domain=.co.uk` but introduces a multi-megabyte data dependency
// and a 6-monthly refresh cadence we don't want to own. Instead, we
// require ≥ 2 labels (rejecting bare TLDs and single-label networks like
// `localhost`), and document in 02-RESEARCH-AUTH.md that operators on
// effective TLDs longer than two labels (e.g. `*.co.uk`, `*.com.br`) must
// run AUTH_URL == OPENWHISPR_API_URL until v2 lands proper PSL support.
import { URL } from "node:url";

export interface CookieDomainConfig {
  enabled: boolean;
  domain?: string;
}

/**
 * Find the longest common DNS suffix shared by two hostnames, requiring
 * at least 2 labels in the result. Returns `null` for unrelated hosts and
 * for shared suffixes that look like a single-label TLD (e.g. `localhost`).
 *
 * Examples:
 *   ("api.example.com", "api.example.com")          → "api.example.com"
 *   ("auth.example.com", "api.example.com")         → "example.com"
 *   ("a.svc.example.com", "b.svc.example.com")      → "svc.example.com"
 *   ("auth.foo.com", "api.bar.com")                 → null
 *   ("a.localhost", "b.localhost")                  → null  (single-label)
 */
export function findSharedParentDomain(a: string, b: string): string | null {
  const aLabels = a.split(".");
  const bLabels = b.split(".");
  let longest: string | null = null;
  for (let i = 1; i <= Math.min(aLabels.length, bLabels.length); i++) {
    const aTail = aLabels.slice(-i).join(".");
    const bTail = bLabels.slice(-i).join(".");
    if (aTail === bTail) {
      longest = aTail;
    } else {
      break;
    }
  }
  if (!longest) return null;
  if (longest.split(".").length < 2) return null;
  return longest;
}

/**
 * Resolve the `crossSubDomainCookies` config Better Auth expects, based on
 * the runtime AUTH_URL and OPENWHISPR_API_URL env values.
 *
 * @throws Error when AUTH_URL and OPENWHISPR_API_URL share no eTLD+1 (≥2
 *         labels). Caller is expected to bubble this up at app-boot time.
 */
export function cookieDomainConfig(): CookieDomainConfig {
  const authUrl = process.env.AUTH_URL;
  const apiUrl = process.env.OPENWHISPR_API_URL;
  if (!authUrl || !apiUrl) return { enabled: false };
  const authHost = new URL(authUrl).hostname;
  const apiHost = new URL(apiUrl).hostname;
  if (authHost === apiHost) return { enabled: false };
  const sharedParent = findSharedParentDomain(authHost, apiHost);
  if (!sharedParent) {
    throw new Error(
      `AUTH_URL host '${authHost}' and OPENWHISPR_API_URL host '${apiHost}' share no common parent domain. ` +
        "Either co-locate them on the same eTLD+1, OR set AUTH_URL == OPENWHISPR_API_URL. " +
        "Cross-host installs without a shared parent are not supported in v1.",
    );
  }
  return { enabled: true, domain: `.${sharedParent}` };
}
