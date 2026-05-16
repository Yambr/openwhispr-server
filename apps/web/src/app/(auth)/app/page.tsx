// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U4 Usage dashboard RSC entry.
//
// Prefetches `GET /api/usage` server-side and dehydrates the TanStack Query
// cache into the SSR payload. The Client subtree (<UsageDashboardClient />)
// reads from the hydrated cache on first paint — no client round-trip.
//
// Cookie forwarding (Pitfall 2): RSC fetch does not inherit browser cookies;
// the `cookie` header is explicitly forwarded from the incoming request.
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { UsageDashboardClient } from "@/components/screens/usage/UsageDashboardClient";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}

// Phase 41 / Plan 41-c (HI-2) — removed the `PLAYWRIGHT_DISABLE_SSR_PREFETCH`
// runtime env branch. SSR prefetch now runs unconditionally. Test-side
// migration of loading-state e2e specs (u4-usage etc.) is tracked in
// .planning/phases/41-residual-high-sweep/41-c-DEFERRED.md.

export default async function UsagePage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.usage(),
    queryFn: async () => {
      const res = await fetch(`${internalApiUrl()}/api/usage`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      if (!res.ok) {
        // Surface as empty defaults — the Client component still renders
        // the KPI grid (UI-SPEC: empty is N/A).
        return {
          wordsUsed: 0,
          wordsRemaining: 0,
          plan: "unlimited",
          limitReached: false,
        };
      }
      return (await res.json()) as {
        wordsUsed: number;
        wordsRemaining: number;
        plan: string;
        limitReached: boolean;
      };
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UsageDashboardClient />
    </HydrationBoundary>
  );
}
