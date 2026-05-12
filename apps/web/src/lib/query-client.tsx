// Phase 07.1 / Plan 06 — TanStack Query 5 Client provider (D-STACK-3).
//
// RESEARCH § Pattern 5: each browser tab gets ONE QueryClient instance for
// its lifetime — `useState(() => new QueryClient(...))` is the documented
// pattern (TanStack Query SSR guide, Next.js App Router section).
//
// Defaults:
//   - staleTime: 60_000      → match RSC `makeServerQueryClient()` so the
//                              hydrated cache appears fresh on first paint
//                              (Pitfall 4 — hydration mismatch avoidance)
//   - refetchOnWindowFocus: false → screens explicitly refetch via Refresh
//                              buttons (see UI-SPEC action.refresh.label rows)
//
// We do NOT auto-mount React Query Devtools — they bring in extra bundle
// weight at the route level; debugging is via the integrated devtools the
// developer launches manually in dev (deferred to Plan 04 dev-tooling).
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

export function QueryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
