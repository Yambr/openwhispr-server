// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A3 /admin/config RSC entry (D-API4, D-S1, D-ADMIN-1).
//
// Renders the Config view client. Server-side prefetch is intentionally
// skipped here: the two underlying endpoints (/api/stt-config,
// /api/note-recording-config) require a dual-auth credential (session
// cookie OR Bearer) that the RSC render path does not synthesise — admin
// access at the network layer is via Traefik basic-auth (D-ADMIN-1), which
// does NOT yield a Better Auth session. The Client component fetches via
// the browser, which carries whatever cookie the operator already holds
// in addition to the basic-auth header.
//
// D-API4 — no Effective env block; ConfigClient enforces the omission.
// D-S1   — only existing endpoints are consumed.
// D-ADMIN-1 — layout already lacks a session gate.
import { ConfigClient } from "@/components/screens/admin/ConfigClient";

export default function ConfigPage(): React.JSX.Element {
  return <ConfigClient />;
}
