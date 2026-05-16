// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — Admin route group layout (D-ADMIN-1).
// Phase 41 / Plan 41-c (HI-1) — defense-in-depth role gate added.
//
// Auth model:
//   - PRIMARY GATE — Traefik basic-auth at the edge (D-ADMIN-1). The
//     `ADMIN_BASIC_AUTH_USERS` env variable on the web service governs
//     operator access; this is the canonical runbook gate.
//   - DEFENSE-IN-DEPTH — `checkAdminAccess(session)`. When a Better
//     Auth session IS present we additionally require
//     `session.user.role === "admin"`. A signed-in user with a
//     non-admin role sees a 403 surface instead of admin content. An
//     anonymous (no-session) visitor passes through unchanged so the
//     ops-engineer workflow (basic-auth credentials, no OpenWhispr
//     account) keeps working as documented.
//
// See `.planning/phases/41-residual-high-sweep/41-c-DECISIONS.md` D-1
// for the decision matrix and rejected alternatives.
import type { ReactNode } from "react";
import { AdminShell } from "@/components/screens/AdminShell";
import { checkAdminAccess } from "@/lib/admin-guard";
import { getServerSession } from "@/lib/auth-server";

function AdminForbidden(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold">403 — Forbidden</h1>
      <p className="text-sm text-muted-foreground">
        Your account does not have the <code>admin</code> role. The /admin surface is restricted to
        operators. If you believe this is wrong, ask the install owner to promote your account via
        the setup wizard or by setting <code>users.role = 'admin'</code>
        for your user.
      </p>
    </main>
  );
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getServerSession();
  if (checkAdminAccess(session) === "forbidden") {
    return <AdminForbidden />;
  }
  return <AdminShell>{children}</AdminShell>;
}
