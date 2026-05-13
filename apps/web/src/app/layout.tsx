// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — Root layout wires every cross-cutting provider.
//
// Order matters (outermost → innermost):
//   ThemeProvider     — must wrap I18nProvider so theme tokens apply during
//                       the i18n re-render path.
//   I18nProvider      — receives resources snapshot serialized from the
//                       RSC parent (Pitfall 1). Holds dictionaries for the
//                       app, admin, and common namespaces.
//   QueryProvider     — TanStack Query 5 client. Single instance per tab.
//   TooltipProvider   — Radix UI tooltip context (consumed by shadcn primitives).
//   ErrorBoundary     — last line of defence under the providers.
//   Toaster           — Sonner toast root (renders portal-level outside the
//                       boundary so notifications survive a child crash).
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/lib/error-boundary";
import { getServerI18n } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n-client";
import { QueryProvider } from "@/lib/query-client";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenWhispr",
  description: "OpenWhispr Server web console",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  // Phase 10 / Plan 02 — Edge middleware (`src/middleware.ts`) resolves the
  // active locale from (NEXT_LOCALE cookie → Accept-Language → "en") and
  // forwards it to RSC handlers as the `x-locale` request header. If the
  // header is absent (e.g. a request that bypassed the matcher), fall back
  // to "en" — the server factory will additionally fall back to "en" for
  // any missing key, so this default is purely cosmetic for <html lang>.
  const requestHeaders = await headers();
  const rawLocale = requestHeaders.get("x-locale");
  const lng = rawLocale === "ru" ? "ru" : "en";
  const i18n = await getServerI18n(lng, ["admin", "end-user", "common"]);
  // Plain serialisable snapshot of the resource store for the Client
  // provider (Pitfall 1 — RSC→Client serialization boundary).
  // Resource store can also be empty on cold start if all keys missed —
  // defensively coalesce to `{}` so the Client provider never receives
  // `undefined` (which would crash the useMemo init).
  const resources = (i18n.services.resourceStore.data[lng] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return (
    <html lang={lng} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <I18nProvider lng={lng} resources={resources}>
            <QueryProvider>
              <TooltipProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </TooltipProvider>
            </QueryProvider>
          </I18nProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
