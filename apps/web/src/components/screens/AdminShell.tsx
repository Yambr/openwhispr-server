// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — Admin shell (D-STRUCT-1).
//
// Two-row admin sidebar (Observability, Configuration). The admin surface
// is gated by the application role model — admin = `users.role='admin'`,
// enforced by `checkAdminAccess()` (see `lib/admin-guard.ts`). No edge /
// reverse-proxy credential gate is involved.
//
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-04: an admin signs out via
// Better Auth `signOut()` like any other user, so the header carries an
// in-product sign-out control (mirrors `AppShell.handleSignOut`).
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/lib/auth-client";
import { ThemeSwitcher } from "./theme-switcher";

interface NavItem {
  href: string;
  key: string;
}

const NAV: NavItem[] = [
  {
    href: "/admin/observability",
    key: "admin.observability.nav.sidebar.label",
  },
  { href: "/admin/config", key: "admin.config.nav.sidebar.label" },
];

export function AdminShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <aside className="flex w-64 flex-col border-r border-border bg-panel">
        <div className="px-4 py-5 font-semibold text-lg">
          {t("common:common.brand.admin.title.label")}
        </div>
        <Separator />
        <ScrollArea className="flex-1 px-2 py-3">
          <nav aria-label="Admin" className="flex flex-col gap-1">
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
          <span className="text-text-muted text-xs uppercase tracking-wide">
            {t("common:common.brand.mode.admin.label")}
          </span>
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
