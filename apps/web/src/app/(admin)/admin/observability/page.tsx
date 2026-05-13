// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 12 — A2 /admin/observability RSC entry (D-ADMIN-1, D-S1).
//
// Pure pass-through to the Client Component: A2 has zero server-side data
// fetches (the screen is a static deep-link grid into the operator's
// external Grafana / Tempo / Mimir / Loki stack). All envs read here are
// NEXT_PUBLIC_*, so Next.js inlines them into the client bundle at build
// time — operators must rebuild the web container after env changes.
//
// D-ADMIN-1 — no application-layer role check. The (admin) layout (Plan 06)
// is also gate-less; Traefik basic-auth at the edge is the single source of
// truth for admin access.
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
