// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — Admin shell (D-ADMIN-1 + D-STRUCT-1).
//
// Two-row admin sidebar (Observability, Configuration). NO sign-out button:
// admin auth is enforced at Traefik basic-auth (D-ADMIN-1), so the only way
// to "log out" of admin is to clear browser credentials at the OS level.
// Adding a sign-out here would be misleading.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <aside className="flex w-64 flex-col border-r border-border bg-panel">
        <div className="px-4 py-5 font-semibold text-lg">OpenWhispr — Admin</div>
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
          <span className="text-text-muted text-xs uppercase tracking-wide">Admin mode</span>
          <ThemeSwitcher />
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
