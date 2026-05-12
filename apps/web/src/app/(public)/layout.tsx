// Phase 07.1 / Plan 07 — Public route group layout.
//
// Centred single-column shell used by U1 (/sign-in), U2 (/sign-up), and
// U3 (/verify-email). No sidebar, no AppShell — public pages render
// before authentication is established.
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">{children}</main>
  );
}
