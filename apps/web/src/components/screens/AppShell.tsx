// Phase 07.1 / Plan 06 — End-user app shell (D-STRUCT-1).
//
// Five-row sidebar (Dashboard, Transcriptions, Notes, Conversations, Account)
// + header with sign-out + theme switcher. Wraps every (auth) route.
//
// Mobile breakpoint behaviour: sidebar collapses into a <Sheet> trigger per
// UI-SPEC Appendix B (mobile 0, tablet 640, desktop 1024). For Plan 06 we
// ship the desktop sidebar; the mobile <Sheet> is a P0 polish task in Plan
// 12 (final pass). The desktop layout still works on mobile — it just takes
// more vertical scroll than the spec ideal.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/lib/auth-client";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

interface NavItem {
  href: string;
  key: string;
}

const NAV: NavItem[] = [
  { href: "/app", key: "end-user.usage.nav.sidebar.label" },
  { href: "/app/transcriptions", key: "end-user.trx-list.nav.sidebar.label" },
  { href: "/app/notes", key: "end-user.notes-list.nav.sidebar.label" },
  { href: "/app/conversations", key: "end-user.conv-list.nav.sidebar.label" },
  { href: "/app/account", key: "end-user.account.nav.sidebar.label" },
];

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <aside className="flex w-64 flex-col border-r border-border bg-panel">
        <div className="px-4 py-5 font-semibold text-lg">OpenWhispr</div>
        <Separator />
        <ScrollArea className="flex-1 px-2 py-3">
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm ${
                    active
                      ? "bg-panel-2 font-medium text-text"
                      : "text-text-muted hover:bg-panel-2 hover:text-text"
                  }`}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b border-border px-4">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <Button onClick={handleSignOut} size="sm" variant="outline">
            {t("common:common.signout.label")}
          </Button>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
