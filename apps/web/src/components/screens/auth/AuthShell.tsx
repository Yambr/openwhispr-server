// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface AuthShellProps {
  children: ReactNode;
  /** Optional override for the side-panel headline; defaults to the shared shell copy. */
  sideTitle?: string;
  /** Optional override for the kicker/uppercase tag above the headline. */
  sideKicker?: string;
  /** Optional override for the supporting paragraph beneath the headline. */
  sideQuote?: string;
}

/**
 * Two-column branded auth shell. Maps the Phase 07 UI-SPEC oracle
 * (`design/ui.jsx:229-316` AuthShell) to Tailwind 4 + shadcn/ui v2.
 *
 * Layout:
 *  - `<lg`: side panel hidden, form fills the viewport.
 *  - `≥lg`: 2-column grid; left = branded panel (logo, kicker, headline,
 *           quote, version + Status/Docs/GitHub links), right = form slot.
 *
 * The `(public)/layout.tsx` LanguageSwitcher header remains absolute over
 * the right column — AuthShell is the layout owner (D-14).
 */
export function AuthShell({
  children,
  sideTitle,
  sideKicker,
  sideQuote,
}: AuthShellProps): React.JSX.Element {
  const { t } = useTranslation(["common"]);
  const kicker = sideKicker ?? t("common.auth.shell.kicker.default.text");
  const title = sideTitle ?? t("common.auth.shell.title.default.text");
  const quote = sideQuote ?? t("common.auth.shell.quote.default.text");
  return (
    <div className="grid min-h-svh w-full grid-cols-1 lg:grid-cols-2">
      <aside
        // Hidden on mobile (`<lg`); turned on as a flex column at `lg`.
        className="hidden flex-col justify-between gap-10 bg-muted p-10 lg:flex"
      >
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-foreground font-bold text-background text-base"
          >
            W
          </div>
          <div>
            <div className="font-semibold tracking-tight">OpenWhispr Server</div>
            <div className="text-muted-foreground text-xs uppercase tracking-wider">{kicker}</div>
          </div>
        </div>
        <div className="relative z-10">
          <h2 className="max-w-[14ch] font-semibold text-3xl leading-tight tracking-tight">
            {title}
          </h2>
          <p className="mt-3 max-w-[40ch] text-muted-foreground text-sm leading-relaxed">{quote}</p>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-muted-foreground text-xs">
          <span className="font-mono">v1.0.4</span>
          <span aria-hidden="true">·</span>
          <Link href="#" className="hover:text-foreground">
            {t("common.auth.shell.footer.status.text")}
          </Link>
          <Link href="#" className="hover:text-foreground">
            {t("common.auth.shell.footer.docs.text")}
          </Link>
          <Link href="#" className="hover:text-foreground">
            {t("common.auth.shell.footer.github.text")}
          </Link>
        </div>
      </aside>
      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
