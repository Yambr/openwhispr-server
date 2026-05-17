// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-04 — RED→GREEN for REVIEW-INDEX.md CR-6.
//
// Pre-publication review found that `checkAdminAccess(null)` returns
// "allow", on the theory that Traefik basic-auth at the edge is the
// canonical operator gate. The flaw: in the OSS quickstart Traefik
// basic-auth is NOT mandatory. A forged or missing session cookie
// therefore falls through to "allow" and the admin layout renders
// with full operator content.
//
// Fix contract:
//   * checkAdminAccess accepts a second arg `edgeAuthEnforced: boolean`
//     (default `false`). When `false` AND session is `null`,
//     the result is `"forbidden"` (fail-closed). When `true`, the
//     historical "anonymous = allow" behaviour is restored — used by
//     operators who DO deploy Traefik basic-auth.
//   * The existing three branches (admin, non-admin, no-role) keep
//     their current outcomes.

import { describe, expect, it } from "vitest";
import { checkAdminAccess } from "@/lib/admin-guard";
import type { ServerSession } from "@/lib/auth-server";

const adminSession: ServerSession = {
  session: { id: "sess-admin", userId: "u-1" },
  user: { id: "u-1", role: "admin" },
};

describe("Plan 51-04 — checkAdminAccess fails closed on null session by default", () => {
  it("forbids anonymous when edgeAuthEnforced is omitted (default fail-closed)", () => {
    expect(checkAdminAccess(null)).toBe("forbidden");
  });

  it("forbids anonymous when edgeAuthEnforced=false explicitly", () => {
    expect(checkAdminAccess(null, false)).toBe("forbidden");
  });

  it("allows anonymous when edgeAuthEnforced=true (operator opts into Traefik gate)", () => {
    expect(checkAdminAccess(null, true)).toBe("allow");
  });

  it("admin session is still allowed under fail-closed default", () => {
    expect(checkAdminAccess(adminSession)).toBe("allow");
  });
});
