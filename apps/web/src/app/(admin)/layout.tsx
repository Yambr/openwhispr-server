// SPDX-License-Identifier: FSL-1.1-ALv2
// Admin route group layout.
//
// Auth model: admin = regular user with `users.role='admin'`. The first
// user to complete the in-product /setup wizard (POST /api/setup/admin)
// is granted role='admin' automatically. AdminLayout calls
// checkAdminAccess(session) — anonymous + non-admin signed-in visitors
// see the inline 403 surface. No Traefik basic-auth, no edge-auth env
// flag — auth is in-app via Better Auth cookies regardless of
// deployment topology (slim or traefik).
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
  // Fail-closed admin gate. Admin = regular user with users.role='admin'
  // (granted by the first /setup wizard completion via POST
  // /api/setup/admin). No Traefik basic-auth, no edge-auth env flag.
  if (checkAdminAccess(session) === "forbidden") {
    return <AdminForbidden />;
  }
  return <AdminShell>{children}</AdminShell>;
}
