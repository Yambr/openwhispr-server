// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41 / Plan 41-c — HI-1 admin route role-check guard.
// Phase 51 / Plan 51-04 — REVIEW CR-6 fail-closed hardening.
//
// Defense-in-depth role gate. Pre-Phase-51 the guard returned "allow"
// on a null session because Traefik basic-auth at the edge was treated
// as the primary gate. That assumption holds in production deployments
// but NOT in the OSS quickstart where Traefik basic-auth is optional —
// a forged or missing session cookie would fall through to "allow"
// and the admin layout would render full operator content.
//
// Post-Phase-51 the guard fails CLOSED by default. Operators who DO
// deploy Traefik basic-auth opt into the historical behaviour via the
// `edgeAuthEnforced` flag (sourced from `ADMIN_EDGE_AUTH_ENFORCED=1`
// at the layout layer).
//
// Four branches:
//
//   - session === null && !edgeAuthEnforced → "forbidden"  (DEFAULT)
//   - session === null && edgeAuthEnforced  → "allow"      (operator
//                                                            runbook:
//                                                            Traefik is
//                                                            the gate)
//   - session.user.role === "admin"         → "allow"
//   - otherwise (signed-in non-admin)       → "forbidden"
//
// The helper is pure (no I/O, no headers/redirect side-effects) so it
// is unit-testable. The RSC layout consumes it and renders an inline
// 403 surface on "forbidden".
import type { ServerSession } from "@/lib/auth-server";

export type AdminAccessDecision = "allow" | "forbidden";

/**
 * Decide whether a session may access /admin/*.
 *
 * @param session  the resolved Better Auth session, or `null` for
 *                 anonymous visitors.
 * @param edgeAuthEnforced  when `true`, anonymous visitors are allowed
 *                 through (Traefik basic-auth at the edge is the
 *                 canonical operator gate). When `false` (the default),
 *                 the guard fails CLOSED — a missing/forged cookie
 *                 cannot bypass the admin surface.
 * @returns `"allow"` when the request may proceed to the admin layout;
 *          `"forbidden"` when the layout MUST render a 403 surface
 *          instead of admin content.
 */
export function checkAdminAccess(
  session: ServerSession | null,
  edgeAuthEnforced: boolean = false,
): AdminAccessDecision {
  if (session === null) {
    return edgeAuthEnforced ? "allow" : "forbidden";
  }
  const role = (session.user as { role?: unknown }).role;
  if (role === "admin") return "allow";
  return "forbidden";
}
