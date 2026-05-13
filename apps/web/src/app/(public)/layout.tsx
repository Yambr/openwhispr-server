// Phase 07.1 / Plan 07 + Phase 10 / Plan 02 — Public route group layout.
//
// Centred single-column shell used by U1 (/sign-in), U2 (/sign-up), and
// U3 (/verify-email). No sidebar, no AppShell — public pages render
// before authentication is established.
//
// Phase 10 / Plan 02 mounts `LanguageSwitcher` in the top-right corner so
// unauthenticated visitors can pick a locale before signing in. The
// component is a client island and reads the active locale from the
// inherited `I18nProvider` context established in the root layout.
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/screens/language-switcher";

export default function PublicLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center justify-end gap-2 px-6">
        <LanguageSwitcher />
      </header>
      <div className="flex flex-1 items-center justify-center p-6">{children}</div>
    </main>
  );
}
