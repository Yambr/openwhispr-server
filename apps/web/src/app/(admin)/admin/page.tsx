// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-04 — /admin index RSC entry (closes TD-12.a, ADMIN-04).
//
// Pure RSC entry that hands off to the Client AdminIndex. NO session
// check at the page level — Phase 07.1 D-ADMIN-1 keeps Traefik basic-auth
// as the single source of truth for admin gating; an application-layer
// role check here would double-gate operators and confuse the runbook.
//
// JSX oracle: `.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:445-628`
// (ScreenConfig). RESEARCH §15(h) prohibits A1 (ScreenAudit) and A2
// (ScreenObservability) mirrors in this surface — they leak user PII.
import { AdminIndex } from "@/components/screens/AdminIndex";

export default function AdminIndexPage(): React.JSX.Element {
  return <AdminIndex />;
}
