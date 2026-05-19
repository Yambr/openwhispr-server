// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 05 — Better Auth React client (D-STACK-5, RESEARCH § Pattern 3).
//
// Same-origin deploy (D-DEPLOY-1): web and api both ride behind Traefik on
// https://api.localhost (or the configured public host). `/api/auth/*` is
// served by apps/api's Better Auth catch-all handler. No `baseURL` here
// means the client uses relative URLs that Traefik routes correctly.
//
// 1.6.9 surface smoke (RESEARCH OQ4 / A2, executed locally 2026-05-12):
//   signIn=function     signIn.email=function     signIn.social=function
//   signUp=function     signUp.email=function
//   signOut=function    useSession=function       verifyEmail=function
//   revokeSession=function  revokeOtherSessions=function
//   listSessions=function
// Every method the U1..U13 + A2..A3 screens consume is present.
//
// Security: NO localStorage (D-SEC-2). Better Auth uses HttpOnly cookies
// exclusively via apps/api advanced.cookiePrefix='openwhispr'.
"use client";

import { createAuthClient } from "better-auth/react";

const baseClient = createAuthClient({
  // Same-origin — no baseURL needed. Browser fetches `/api/auth/*` and
  // Traefik routes those to apps/api.
});

// Better Auth's React client exposes some endpoints only via the runtime
// Proxy. These aren't in the inferred plugin-keyed type but ARE in the
// 1.6.9 surface — verified by the OQ4 smoke test in this plan's commit
// body. We extend the type minimally so TypeScript matches the runtime
// reality.
//
// Plan 51-11b (REVIEW web HIGH HI-06) — extended with the runtime-Proxy
// methods that the SignInForm / OidcButtons / VerifyEmailClient used to
// reach via local double-cast at every call site. Centralising the
// shape here eliminates the LOCKER-02-violating casts (CLAUDE.md
// DISCIPLINE rule 12) and gives a single edit point if Better Auth
// tightens the inferred surface in a future release.
//
// Phase 55-01-b — `deleteAccount` removed from this surface. Better
// Auth's deleteAccount() hits POST /api/auth/delete-account, but the
// server route is DELETE-method-only (apps/api/src/routes/delete-account.ts)
// because the Better Auth `user.deleteUser` plugin is intentionally NOT
// enabled (see apps/api/src/auth.ts user block). DeleteAccountDialog
// now uses a hand-rolled fetch DELETE per wire-contract.md WIRE-03.

type SignInEmail = (args: {
  email: string;
  password: string;
  rememberMe?: boolean;
  callbackURL?: string;
}) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

type SignInSocial = (args: { provider: string; callbackURL?: string }) => Promise<unknown>;

type SendVerificationEmail = (args: {
  email: string;
  callbackURL?: string;
}) => Promise<{ data: unknown; error: unknown }>;

type VerifyEmailFn = (args: {
  query: { token: string };
}) => Promise<{ data: unknown; error: { message?: string } | null }>;

type ExtendedSignIn = typeof baseClient.signIn & {
  email: SignInEmail;
  social: SignInSocial;
};

type ExtendedAuthClient = Omit<typeof baseClient, "signIn"> & {
  signIn: ExtendedSignIn;
  sendVerificationEmail: SendVerificationEmail;
  verifyEmail: VerifyEmailFn;
};

export const authClient = baseClient as unknown as ExtendedAuthClient;

// Named re-exports for ergonomic Client Component imports
// (e.g. `import { useSession } from '@/lib/auth-client'`).
export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const signOut = authClient.signOut;
export const useSession = authClient.useSession;
export const verifyEmail = authClient.verifyEmail;
export const revokeSession = authClient.revokeSession;
export const revokeOtherSessions = authClient.revokeOtherSessions;
export const listSessions = authClient.listSessions;
