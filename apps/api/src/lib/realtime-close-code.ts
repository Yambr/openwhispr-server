// SPDX-License-Identifier: FSL-1.1-ALv2
// T-03-07 close-behavior refinement — pure mapper from an upstream WS
// handshake HTTP status to a client-facing WebSocket close code + reason.
//
// The realtime relay's upstream `ws` client emits `unexpected-response`
// when the upstream rejects the WS handshake with an HTTP response. The
// previous posture closed the desktop client with a flat 1011 for every
// failure class, so the client could not distinguish a 401 (bad key)
// from a 503 (down) from a 429 (rate-limited). This mapper assigns a
// meaningful wire close code per class.
//
// SECURITY: the reason strings are FIXED per class and are NEVER derived
// from the upstream response body — an upstream error body can carry
// secret-shaped provider payloads, and WS close reasons are visible to
// the desktop client. Each reason is ≤120 chars (the WS close-reason
// byte bound the relay clamps to).

/**
 * Map an upstream WS-handshake HTTP status to a client-facing WS close
 * code + a fixed, body-independent reason string.
 *
 *   * 401 / 403 → 1008 (policy violation) — "realtime upstream unauthorized"
 *   * 429       → 1013 (try again later)  — "realtime upstream rate limited"
 *   * any other (5xx, etc.) → 1011 (internal error) — "realtime upstream unavailable"
 *
 * 1008 / 1011 / 1013 are all valid IANA WebSocket close codes. The caller
 * passes them straight to `clientSocket.close(code, reason)` — they MUST
 * NOT be routed through the relay's `safeCode` clamp, which only admits
 * 1000-1003 + 3000-4999 and would collapse 1008/1013 → 1011.
 */
export function mapUpstreamStatusToCloseCode(status: number): {
  code: number;
  reason: string;
} {
  if (status === 401 || status === 403) {
    return { code: 1008, reason: "realtime upstream unauthorized" };
  }
  if (status === 429) {
    return { code: 1013, reason: "realtime upstream rate limited" };
  }
  return { code: 1011, reason: "realtime upstream unavailable" };
}
