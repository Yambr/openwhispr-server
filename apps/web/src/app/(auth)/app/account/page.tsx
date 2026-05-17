// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 Account RSC entry.
// Phase 51 / Plan 51-04 — REVIEW CR-4 fix: never serialize the bearer.
//
// Resolves the Better Auth session server-side (cookie-forwarded HTTP call
// to apps/api `/api/auth/get-session`) and hands the user object + the
// current session ID down to the AccountClient.
//
// Pre-fix this passed `session.session.token` (a Better Auth bearer) as
// a Client-component prop, which serialized it into __NEXT_DATA__ /
// the JS heap — defeating HttpOnly cookie protection. The only
// downstream use of the token was the SessionsTable "this device"
// badge, which only needs an identifier comparison. We now pass
// `currentSessionId` and SessionsTable compares against `row.id`.
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
  // Phase 51 / Plan 51-04 — pass the safe session ID, NOT the bearer.
  const currentSessionId = session.session.id;

  return <AccountClient currentSessionId={currentSessionId} user={user} />;
}
