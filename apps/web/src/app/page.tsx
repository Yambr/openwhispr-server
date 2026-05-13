// SPDX-License-Identifier: Apache-2.0
import { redirect } from "next/navigation";

/**
 * Root route ("/") redirects to the authenticated app shell.
 *
 * Decision: `/` is not a public landing page in v1 — the desktop client owns
 * marketing copy. `(auth)/layout.tsx` performs the real session check and will
 * re-redirect unauthenticated users to `/sign-in` once Plan 06 lands. Until
 * then this route emits a 307 to `/app` so the scaffold has a deterministic
 * entry point for the smoke test.
 */
export default function RootPage(): never {
  redirect("/app");
}
