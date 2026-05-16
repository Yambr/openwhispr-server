// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41 / Plan 41-c — HI-1 admin role-guard unit tests.
//
// Three branches × one assertion each, all-100% coverage on
// `lib/admin-guard.ts`. See `.planning/phases/41-residual-high-sweep/41-c-DECISIONS.md`
// D-1 for the chosen UX (inline 403 for signed-in non-admin; allow
// for anonymous so Traefik basic-auth remains the primary gate).
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

describe("checkAdminAccess (Phase 41.c HI-1)", () => {
  it("allows anonymous (null session) — Traefik basic-auth is the primary gate", () => {
    expect(checkAdminAccess(null)).toBe("allow");
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
