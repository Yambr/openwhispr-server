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
  // v1 is English-only (D-STACK-7). Phase 10 introduces the Accept-Language
  // → NEXT_LOCALE cookie chain.
  const lng = "en";
  const i18n = await getServerI18n(lng, ["admin", "end-user", "common"]);
  // Plain serialisable snapshot of the resource store for the Client
  // provider (Pitfall 1 — RSC→Client serialization boundary).
  const resources = i18n.services.resourceStore.data[lng] as Record<
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
