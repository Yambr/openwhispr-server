// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — Theme provider (D-SEC-2 — UI preference only).
//
// Thin wrapper around `next-themes` that:
//   - sets `data-theme` on <html> (matches Tailwind 4 @theme block in
//     globals.css that swaps tokens via `[data-theme="dark"]`)
//   - persists the user choice to `localStorage` under key "theme"
//
// D-SEC-2 explicitly allows the theme preference in localStorage — only auth
// TOKENS are forbidden there. Better Auth sessions stay in HttpOnly cookies
// throughout.
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
    >
      {children}
    </NextThemesProvider>
  );
}
