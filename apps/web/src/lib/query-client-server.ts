// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — TanStack Query 5 server factory (D-STACK-3).
//
// RESEARCH § Pattern 5 + Pitfall 4: every RSC render that prefetches data
// MUST construct a fresh QueryClient — sharing one across requests would
// leak hydrated state between users (one user's session data could be
// dehydrated into another user's HTML payload).
//
// Defaults match the Client provider exactly so the dehydrated state on
// the wire matches the first client-side getQuery() lookup.
import { QueryClient } from "@tanstack/react-query";

export function makeServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Mirror the Client provider — see apps/web/src/lib/query-client.tsx
        // for the Phase 07.1 / Plan 13.2 retry-disable rationale. Keeps the
        // RSC + client default surface byte-identical (Pitfall 4 — hydration).
        retry: false,
      },
    },
  });
}
