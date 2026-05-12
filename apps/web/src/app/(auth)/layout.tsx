// Phase 07.1 / Plan 05 — Authenticated route group layout.
//
// The Edge middleware (`src/middleware.ts`) does a cookie-existence check
// only. This layout does the REAL session validation by calling apps/api's
// `/api/auth/get-session` over HTTP with the forwarded Cookie header
// (RESEARCH § Pattern 2). On null we redirect to /sign-in.
//
// AppShell (sidebar + nav + i18n + query provider) lands in Plan 06; for
// now the layout is the bare auth gate around `{children}`.
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // TODO(plan-06): wrap children with <AppShell user={session.user}>.
  return <>{children}</>;
}
