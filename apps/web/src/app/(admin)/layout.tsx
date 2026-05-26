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
//
// Pre-prod blocker B1 (quick 260526-lgn): the 403 surface itself
// (heading + body paragraph) is now localized via getServerI18n,
// matching the pattern used by the root layout. Two <code> tokens
// (`admin` role-name + `users.role = 'admin'` SQL fragment) stay
// literal English because they are programmatic identifiers, not
// localizable copy. Body splits into three i18n keys around the two
// <code> boundaries.
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/screens/AdminShell";
import { checkAdminAccess } from "@/lib/admin-guard";
import { getServerSession } from "@/lib/auth-server";
import { getServerI18n } from "@/lib/i18n";

async function AdminForbidden(): Promise<React.JSX.Element> {
  const requestHeaders = await headers();
  const rawLocale = requestHeaders.get("x-locale");
  const lng = rawLocale === "ru" ? "ru" : "en";
  const i18n = await getServerI18n(lng, ["admin"]);
  const t = i18n.t.bind(i18n);
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold">{t("admin:admin.forbidden.title.text")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("admin:admin.forbidden.body_prefix.text")}
        <code>admin</code>
        {t("admin:admin.forbidden.body_middle.text")}
        <code>users.role = 'admin'</code>
        {t("admin:admin.forbidden.body_suffix.text")}
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
    return await AdminForbidden();
  }
  return <AdminShell>{children}</AdminShell>;
}
