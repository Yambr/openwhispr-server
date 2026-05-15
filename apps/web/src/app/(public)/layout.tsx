// SPDX-License-Identifier: FSL-1.1-ALv2
// Public route group layout. AuthShell (Phase 18.1.1 / Plan 04, D-13/D-14)
// owns the layout for U1 (/sign-in), U2 (/sign-up), U3 (/verify-email), and
// U4 (/setup) — this wrapper drops the centered single-column shell so the
// two-column AuthShell grid is not double-centered.
//
// The Phase 10 LanguageSwitcher is preserved as an absolute-positioned
// header element so it overlays the right (form) column on lg+ and the
// fullscreen form on <lg.
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/screens/language-switcher";

export default function PublicLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <main className="relative min-h-svh bg-background">
      <header className="absolute top-0 right-0 z-20 flex h-14 items-center justify-end gap-2 px-6">
        <LanguageSwitcher />
      </header>
      {children}
    </main>
  );
}
