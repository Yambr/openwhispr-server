// Phase 08 / Plan 02 — Task 2 GREEN: Bearer-token rotation helpers.
//
// Better Auth rotates session tokens via the `set-auth-token` response
// header (per BACKEND_SPEC.md). The k6 VU state must follow rotations
// or every request after the first one will 401. These helpers operate
// on plain header maps so they have no k6 runtime dependency.

const ROTATION_HEADER = "set-auth-token";

/**
 * Read the rotation header from a header map. The lookup is
 * case-insensitive because HTTP header casing is not guaranteed across
 * proxies (Traefik 3 normalises but k6's `headers` object preserves
 * the response casing as observed on the wire).
 */
export function extractBearer(headers: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === ROTATION_HEADER) {
      return value;
    }
  }
  return null;
}

/**
 * Mutate `state.token` in place if the response carries a rotated token.
 * No-op otherwise. The state object is the VU-local context passed into
 * each k6 iteration; mutation is intentional so subsequent requests pick
 * up the new bearer without re-threading the value through call sites.
 */
export function updateBearer(
  state: { token: string },
  response: { headers: Record<string, string> },
): void {
  const next = extractBearer(response.headers);
  if (next !== null) {
    state.token = next;
  }
}
