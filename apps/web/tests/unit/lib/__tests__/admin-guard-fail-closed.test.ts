// SPDX-License-Identifier: FSL-1.1-ALv2
// checkAdminAccess fails closed by default — no edge-auth bypass.
//
// Admin = regular user with users.role='admin'. Anonymous + non-admin
// signed-in users both see "forbidden". No Traefik basic-auth, no
// `edgeAuthEnforced` parameter — the guard is a pure role check.

import { describe, expect, it } from "vitest";
import { checkAdminAccess } from "@/lib/admin-guard";
import type { ServerSession } from "@/lib/auth-server";

const adminSession: ServerSession = {
  session: { id: "sess-admin", userId: "u-1" },
  user: { id: "u-1", role: "admin" },
};

describe("checkAdminAccess fails closed on null session", () => {
  it("forbids anonymous visitors", () => {
    expect(checkAdminAccess(null)).toBe("forbidden");
  });

  it("admin session is allowed", () => {
    expect(checkAdminAccess(adminSession)).toBe("allow");
  });
});
