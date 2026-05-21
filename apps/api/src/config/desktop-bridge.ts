// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — desktop auth-bridge callback target.
//
// The OpenWhispr Electron client (immutable, ships separately) runs a
// loopback HTTP listener on the fixed bridge port `5199`, whose
// `/oauth/callback` endpoint is the client's ONLY token-intake channel.
// The client's `main.js` accepts `?bearer_token=` / `?token=` on that
// URL and calls `applySessionTokenAndRefresh` — the exact same channel
// the OAuth sign-in flow already uses.
//
// This is NOT an environment-dependent URL: it is a fixed contract
// between the server and the immutable desktop client. A corporate
// operator who self-hosts the server does NOT relocate the client's
// loopback listener — the client binary hardcodes the loopback bridge
// address. Therefore the literal is a build-time constant, not
// env-driven.
//
// LOCKER-03 (lint-no-hardcode) flags the loopback-IP literal below. It
// is allowlisted at `tools/lint-no-hardcode.allowlist.txt` as a
// PERMANENT entry (the desktop-bridge contract address), mirroring the
// docker-compose service-address-default doctrine in 31-08-DECISIONS.md
// §D-2: a fixed inter-process contract address, not deployment debt.
//
// SECURITY — the redirect target is a SERVER-FIXED literal. It is NEVER
// derived from a client-supplied query parameter. There is no
// open-redirect surface: the verify-email-complete route always emits
// exactly this origin + path, only the `bearer_token` value varies.

/**
 * The desktop auth-bridge callback URL. The verify-email-complete route
 * 302-redirects here with a freshly-minted `?bearer_token=` so the
 * Electron client picks up the session after a sign-up → verify flow.
 *
 * Not exported: the only consumer is `buildDesktopBridgeRedirect` below.
 * Callers that need the literal (e.g. tests asserting the redirect
 * target) derive it via `buildDesktopBridgeRedirect` — keeping a single
 * public surface and avoiding a dead export (LOCKER-04).
 */
const DESKTOP_BRIDGE_CALLBACK_URL = "http://127.0.0.1:5199/oauth/callback";

/**
 * Build the desktop-bridge redirect URL carrying the session bearer.
 *
 * `encodeURIComponent` guards the token against any `+`, `/`, `=`, or
 * `.` characters (Better Auth session tokens are URL-safe-base64 today,
 * but signed-cookie tokens contain a `.` separator) so the value
 * survives the loopback HTTP hop and the client's URL parsing intact.
 */
export function buildDesktopBridgeRedirect(bearerToken: string): string {
  return `${DESKTOP_BRIDGE_CALLBACK_URL}?bearer_token=${encodeURIComponent(bearerToken)}`;
}
