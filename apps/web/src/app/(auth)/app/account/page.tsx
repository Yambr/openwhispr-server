// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 08 — U5 Account RSC entry.
//
// Resolves the Better Auth session server-side (cookie-forwarded HTTP call
// to apps/api `/api/auth/get-session`) and hands the user object + the
// current session token down to the AccountClient. The Client component
// owns the listSessions / revoke / deleteAccount flows.
//
// If the session resolves to null (race after sign-out, expired cookie),
// redirect to /sign-in — the layout already does this but we guard
// defensively in case a future refactor changes the layout contract.
import { redirect } from "next/navigation";
import { AccountClient } from "@/components/screens/account/AccountClient";
import { getServerSession } from "@/lib/auth-server";

export default async function AccountPage(): Promise<React.JSX.Element> {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const user = {
    id: session.user.id,
    name: (session.user.name as string | undefined) ?? null,
    email: (session.user.email as string | undefined) ?? "",
    emailVerified: Boolean(session.user.emailVerified),
    createdAt: (session.user.createdAt as string | undefined) ?? null,
  };
  const currentSessionToken = (session.session.token as string | undefined) ?? null;

  return <AccountClient currentSessionToken={currentSessionToken} user={user} />;
}
