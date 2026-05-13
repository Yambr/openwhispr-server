// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 05 — Server Actions for auth-related mutations.
//
// `signOutAction()` is the canonical sign-out path for U5 (account screen)
// and the global nav. We:
//   1. Best-effort POST to apps/api `/api/auth/sign-out` with the user's
//      cookie so the server-side session row is invalidated and any
//      future bearer-token rotations are stopped.
//   2. ALWAYS redirect to `/sign-in` — even if the upstream call fails
//      (network blip, api restart). The user-visible signed-out state is
//      driven by the redirect; the server-side revoke is best-effort.
//
// Note: `redirect()` from next/navigation throws an internal
// `NEXT_REDIRECT` error by design. Callers MUST NOT wrap this in a
// try/catch that swallows everything — Next.js relies on the throw to
// unwind the Server Action.
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}

export async function signOutAction(): Promise<never> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  try {
    await fetch(`${internalApiUrl()}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      cache: "no-store",
    });
  } catch {
    // Best-effort revoke — local redirect proceeds regardless.
  }
  redirect("/sign-in");
}
