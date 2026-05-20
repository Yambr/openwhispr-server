// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-04 — /admin index RSC entry (closes TD-12.a, ADMIN-04).
//
// Pure RSC entry that hands off to the Client AdminIndex. No session
// check at the page level — the (admin) layout already applies the role
// gate via checkAdminAccess() (admin = users.role='admin'; see
// lib/admin-guard.ts); a second check here would be redundant.
//
// JSX oracle: `.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:445-628`
// (ScreenConfig). RESEARCH §15(h) prohibits A1 (ScreenAudit) and A2
// (ScreenObservability) mirrors in this surface — they leak user PII.
import { AdminIndex } from "@/components/screens/AdminIndex";

export default function AdminIndexPage(): React.JSX.Element {
  return <AdminIndex />;
}
