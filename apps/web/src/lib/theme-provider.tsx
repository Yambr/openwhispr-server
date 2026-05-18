// SPDX-License-Identifier: FSL-1.1-ALv2
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

interface ThemeProviderProps {
  children: ReactNode;
  /** Phase 53 / Plan 53-07 — CSP nonce forwarded from the request
   *  middleware so next-themes' theme-init inline script carries
   *  `nonce=<value>` and passes the `script-src 'self' 'nonce-…'
   *  'strict-dynamic'` directive emitted by `middleware.ts`. Pre-fix
   *  the inline script was nonce-less and fired
   *  SecurityPolicyViolationEvent on every page load. */
  nonce?: string;
}

export function ThemeProvider({ children, nonce }: ThemeProviderProps): React.JSX.Element {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
      {...(nonce !== undefined ? { nonce } : {})}
    >
      {children}
    </NextThemesProvider>
  );
}
