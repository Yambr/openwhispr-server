// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — Admin route group layout (D-ADMIN-1).
//
// NO session check here. Admin gating is performed at the Traefik edge via
// basic-auth (D-ADMIN-1) — credentials are configured via the
// ADMIN_BASIC_AUTH_USERS env variable on the web service. Adding an
// application-level role check would double-gate and confuse operators who
// expect Traefik to be the single source of truth for admin access.
import type { ReactNode } from "react";
import { AdminShell } from "@/components/screens/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <AdminShell>{children}</AdminShell>;
}
