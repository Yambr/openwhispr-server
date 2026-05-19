// SPDX-License-Identifier: FSL-1.1-ALv2
// Admin role gate — fail-closed.
//
// Admin = regular user with `users.role='admin'`. The first user to
// complete the /setup wizard becomes admin (POST /api/setup/admin).
// No Traefik basic-auth, no edge-auth env flag, no separate admin
// login — the admin surface is gated solely by Better Auth session +
// users.role check.
//
// Three branches:
//
//   - session === null                       → "forbidden"
//   - session.user.role === "admin"          → "allow"
//   - signed-in non-admin                    → "forbidden"
//
// The helper is pure (no I/O, no headers/redirect side-effects) so it
// is unit-testable. The RSC layout consumes it and renders an inline
// 403 surface on "forbidden".
//
// Phase 55-18-cleanup (2026-05-19): removed `edgeAuthEnforced` branch
// — the prior model treated Traefik basic-auth as the primary gate and
// admitted anonymous visitors when ADMIN_EDGE_AUTH_ENFORCED=1 was set.
// That coupled admin access to ingress configuration, breaking the
// self-host quickstart (slim topology has no Traefik). Auth is now in-
// app only, regardless of deployment topology.
import type { ServerSession } from "@/lib/auth-server";

export type AdminAccessDecision = "allow" | "forbidden";

/**
 * Decide whether a session may access /admin/*.
 *
 * @param session  the resolved Better Auth session, or `null` for
 *                 anonymous visitors.
 * @returns `"allow"` when the request may proceed to the admin layout;
 *          `"forbidden"` when the layout MUST render a 403 surface
 *          instead of admin content.
 */
export function checkAdminAccess(session: ServerSession | null): AdminAccessDecision {
  if (session === null) return "forbidden";
  const role = (session.user as { role?: unknown }).role;
  if (role === "admin") return "allow";
  return "forbidden";
}
