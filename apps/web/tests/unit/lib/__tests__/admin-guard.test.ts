// SPDX-License-Identifier: FSL-1.1-ALv2
// Admin role-guard unit tests.
//
// Three branches × one assertion each. Admin = users.role='admin';
// anonymous + non-admin signed-in users both forbidden. No
// edgeAuthEnforced / Traefik bypass — auth is in-app only.
import { describe, expect, it } from "vitest";
import { checkAdminAccess } from "@/lib/admin-guard";
import type { ServerSession } from "@/lib/auth-server";

const adminSession: ServerSession = {
  session: { id: "sess-admin", userId: "u-1" },
  user: { id: "u-1", role: "admin" },
};

const regularSession: ServerSession = {
  session: { id: "sess-regular", userId: "u-2" },
  user: { id: "u-2", role: "user" },
};

const sessionWithoutRole: ServerSession = {
  session: { id: "sess-norole", userId: "u-3" },
  user: { id: "u-3" /* no role field at all */ },
};

describe("checkAdminAccess", () => {
  it("forbids anonymous (null session)", () => {
    expect(checkAdminAccess(null)).toBe("forbidden");
  });

  it("allows signed-in admin (role === 'admin')", () => {
    expect(checkAdminAccess(adminSession)).toBe("allow");
  });

  it("forbids signed-in non-admin (role !== 'admin')", () => {
    expect(checkAdminAccess(regularSession)).toBe("forbidden");
  });

  it("forbids signed-in user with no role attribute (defense-in-depth)", () => {
    expect(checkAdminAccess(sessionWithoutRole)).toBe("forbidden");
  });
});
