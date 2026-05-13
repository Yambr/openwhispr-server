// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — OIDC button row (D-UX4).
//
// Renders one Button per provider id enumerated in
// `process.env.NEXT_PUBLIC_OIDC_PROVIDERS` (default `google,github,oidc`).
// Click → `authClient.signIn.social({ provider })`. Labels come from the
// per-screen i18n namespace (signin or signup) so corp ops can rebrand via
// locale overrides.
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const KNOWN_PROVIDERS = ["google", "github", "oidc"] as const;
type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

function readProviders(): KnownProvider[] {
  const raw = process.env.NEXT_PUBLIC_OIDC_PROVIDERS ?? "google,github,oidc";
  const ids = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is KnownProvider => (KNOWN_PROVIDERS as readonly string[]).includes(s));
  return ids;
}

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
  const providers = readProviders();
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
          key={p}
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => onClick(p)}
        >
          {t(labelKey(namespace, p))}
        </Button>
      ))}
    </div>
  );
}
