// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41 / Plan 41-c — HI-1 admin route role-check guard.
//
// Defense-in-depth role gate layered on top of Traefik basic-auth
// (D-ADMIN-1). Traefik basic-auth remains the primary gate; this helper
// only acts when a Better Auth session is present. Three branches:
//
//   - session === null  → "allow"     (operator runbook: ops engineer
//                                      with basic-auth credentials but
//                                      no OpenWhispr account passes
//                                      through; Traefik already
//                                      authorised them).
//   - session.user.role === "admin" → "allow"      (authorised admin).
//   - otherwise          → "forbidden" (signed-in NON-admin user — the
//                                      defense-in-depth surface this
//                                      guard exists for; closes the
//                                      `web.md` HI-1 case "any signed-in
//                                      user gains operator config
//                                      visibility").
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
 *                 anonymous visitors (Traefik basic-auth covers this
 *                 case at the edge).
 * @returns `"allow"` when the request may proceed to the admin layout;
 *          `"forbidden"` when the layout MUST render a 403 surface
 *          instead of admin content.
 */
export function checkAdminAccess(session: ServerSession | null): AdminAccessDecision {
  if (session === null) return "allow";
  const role = (session.user as { role?: unknown }).role;
  if (role === "admin") return "allow";
  return "forbidden";
}
