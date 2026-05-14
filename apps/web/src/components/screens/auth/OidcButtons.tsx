// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-04 — OIDC button row (UICONF-02, TD-12.c).
//
// Reads the runtime list of configured OIDC providers from
// GET /api/auth/providers via the `useAuthProviders` hook (Plan 12-04
// task 1) instead of the previous build-time env read. This closes
// TD-12.c — operator-side env now drives the UI
// without a web container rebuild, and a zero-providers env produces
// zero buttons (no Better-Auth-404 → 429-lockout cascade).
//
// Click → `authClient.signIn.social({ provider })`. Labels come from the
// per-screen i18n namespace (signin or signup) so corp ops can rebrand
// via locale overrides — unchanged from the Plan 07 contract.
//
// Conditional-render contract (RESEARCH §9):
//   - loading=true                  -> return null (T-12.04-02 flicker gate)
//   - providers.length === 0       -> return null (zero-N gate)
//   - otherwise                    -> render one Button per provider
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useAuthProviders } from "./useAuthProviders";

type KnownProvider = "google" | "github" | "oidc";

/** Map provider id → i18n label key for the given namespace (signin|signup). */
function labelKey(ns: "signin" | "signup", provider: KnownProvider): string {
  // `oidc` is the generic SSO bucket — labeled "Continue with SSO" per D-UX4.
  const slot = provider === "oidc" ? "sso" : provider;
  return `end-user.${ns}.oidc.${slot}.label`;
}

export interface OidcButtonsProps {
  /** Which screen's copy keys to use for labels. */
  namespace: "signin" | "signup";
}

export function OidcButtons({ namespace }: OidcButtonsProps): React.JSX.Element | null {
  const { t } = useTranslation(["end-user"]);
  const [pending, setPending] = useState<KnownProvider | null>(null);
  const { providers, loading } = useAuthProviders();

  // Flicker gate (RESEARCH §9 P2): no zero-N flash before fetch resolves.
  if (loading) return null;
  if (providers.length === 0) return null;

  async function onClick(provider: KnownProvider): Promise<void> {
    setPending(provider);
    try {
      // better-auth/react's `signIn.social` triggers a full-page redirect on
      // success; the awaited promise still resolves so we can clear pending
      // on the (unlikely) inline-result branch.
      await (
        authClient.signIn as unknown as {
          social: (args: { provider: string; callbackURL?: string }) => Promise<unknown>;
        }
      ).social({ provider, callbackURL: "/app" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => onClick(p.id)}
        >
          {t(labelKey(namespace, p.id))}
        </Button>
      ))}
    </div>
  );
}
