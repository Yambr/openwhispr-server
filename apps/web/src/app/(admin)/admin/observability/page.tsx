// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A2 /admin/observability RSC entry (D-S1).
//
// Pure pass-through to the Client Component: A2 has zero server-side data
// fetches (the screen is a static deep-link grid into the operator's
// external Grafana / Tempo / Mimir / Loki stack). All envs read here are
// NEXT_PUBLIC_*, so Next.js inlines them into the client bundle at build
// time — operators must rebuild the web container after env changes.
//
// Admin access is gated by the (admin) layout, which calls
// checkAdminAccess() (admin = users.role='admin'); see lib/admin-guard.ts.
// This page adds no extra role check of its own.
import { ObservabilityClient } from "@/components/screens/admin/ObservabilityClient";

export default function ObservabilityPage(): React.JSX.Element {
  return (
    <ObservabilityClient
      env={{
        grafana: process.env.NEXT_PUBLIC_GRAFANA_BASE_URL,
        tempo: process.env.NEXT_PUBLIC_TEMPO_BASE_URL,
        mimir: process.env.NEXT_PUBLIC_MIMIR_BASE_URL,
        loki: process.env.NEXT_PUBLIC_LOKI_BASE_URL,
      }}
    />
  );
}
