// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-04 — `useAuthProviders` hook.
//
// Fetches the runtime OIDC + email-verification posture published by
// GET /api/auth/providers (Plan 12-02) at mount and exposes it to the
// auth-screen client components (OidcButtons, SignInForm, SignUpForm,
// VerifyEmailClient). Closes TD-12.c by replacing the previous
// build-time NEXT_PUBLIC_OIDC_PROVIDERS env read in OidcButtons.tsx.
//
// Contract (RESEARCH §9):
//   - Initial state: { loading: true, providers: [] }. OidcButtons relies
//     on this so it can short-circuit to `null` (no flicker, no zero-N
//     button row leaking through before the fetch resolves — T-12.04-02).
//   - On successful fetch: { loading: false, providers: data.providers }.
//   - On fetch failure (network error / non-OK response / JSON parse):
//     fail closed -> { loading: false, providers: [] }. The error is
//     surfaced via `console.warn` (no throw) so a transient network
//     blip never crashes the auth screen for the user.
//   - `credentials: 'omit'` — /api/auth/providers is a public endpoint
//     (RESEARCH §4); sending the session cookie would be wasted bytes
//     and would needlessly expose the cookie to any future replay tap.
//   - One fetch per useEffect invocation (component lifecycle); re-renders
//     do NOT refetch.
"use client";

import { useEffect, useState } from "react";

/** Mirror of apps/api/src/lib/oidc-providers.ts `ConfiguredProvider`. */
export interface ConfiguredProvider {
  readonly id: "google" | "github" | "oidc";
  readonly name: string;
  readonly enabled: true;
}

/** Mirror of apps/api/src/routes/auth-providers.ts `EmailVerificationPosture`. */
export interface EmailVerificationPosture {
  readonly required: boolean;
  readonly configured: boolean;
}

interface AuthProvidersResponseBody {
  providers?: ConfiguredProvider[];
  emailVerification?: EmailVerificationPosture;
}

export interface UseAuthProvidersResult {
  /** List of configured OIDC providers. Empty array while loading or on failure. */
  readonly providers: readonly ConfiguredProvider[];
  /** True until the fetch settles (resolved OR rejected). */
  readonly loading: boolean;
}

export function useAuthProviders(): UseAuthProvidersResult {
  const [data, setData] = useState<AuthProvidersResponseBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers", { credentials: "omit" });
        if (!res.ok) {
          throw new Error(`auth-providers ${res.status}`);
        }
        const body = (await res.json()) as AuthProvidersResponseBody;
        if (!cancelled) setData(body);
      } catch (err) {
        // Fail closed — surface no providers, never throw. Surface to console
        // so an operator can correlate auth-screen flakes with their api
        // logs, but never block the page on a transient blip.
        // biome-ignore lint/suspicious/noConsole: intentional fail-closed observability hook (RESEARCH §9 P2)
        console.warn("[useAuthProviders] fetch failed; rendering zero providers", err);
        if (!cancelled) setData({ providers: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    providers: data?.providers ?? [],
    loading: data === null,
  };
}
