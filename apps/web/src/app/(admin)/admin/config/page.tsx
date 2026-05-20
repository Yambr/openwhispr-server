// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A3 /admin/config RSC entry (D-API4, D-S1).
//
// Renders the Config view client. Server-side prefetch is intentionally
// skipped here: the two underlying endpoints (/api/stt-config,
// /api/note-recording-config) require a dual-auth credential (session
// cookie OR Bearer). The Client component fetches them from the browser,
// which carries the operator's Better Auth session cookie.
//
// D-API4 — no Effective env block; ConfigClient enforces the omission.
// D-S1   — only existing endpoints are consumed.
// Admin access is gated by the (admin) layout via checkAdminAccess()
// (admin = users.role='admin'; see lib/admin-guard.ts).
import { ConfigClient } from "@/components/screens/admin/ConfigClient";

export default function ConfigPage(): React.JSX.Element {
  return <ConfigClient />;
}
