// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 05 — Authenticated route group layout.
//
// The Edge middleware (`src/middleware.ts`) does a cookie-existence check
// only. This layout does the REAL session validation by calling apps/api's
// `/api/auth/get-session` over HTTP with the forwarded Cookie header
// (RESEARCH § Pattern 2). On null we redirect to /sign-in.
//
// Plan 06 wraps the authenticated subtree in the end-user AppShell after
// the session gate passes. The shell consumes i18n + theme contexts from
// the root layout, so all that's needed here is the import and one JSX
// element.
import { redirect } from "next/navigation";
import { AppShell } from "@/components/screens/AppShell";
import { getServerSession } from "@/lib/auth-server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  return <AppShell>{children}</AppShell>;
}
