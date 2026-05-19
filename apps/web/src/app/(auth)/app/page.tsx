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
// Plan 51-11b — INTERNAL_API_URL helper centralised (REVIEW web HIGH HI-03).
import { internalApiUrl } from "@/lib/internal-api";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

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
      // Phase 55-06-a fix (BUG-55-06-a-RSC-FETCH-WALL): on non-2xx,
      // throw so the dehydrated cache hydrates into the Client useQuery's
      // `isError=true` branch (UsageDashboardClient.tsx:80-95 renders the
      // Alert + Retry surface). The previous fallback returned
      // wordsUsed=0 defaults which silently masked real outages — making
      // /api/usage 5xx look identical to a fresh tenant. Truthful error
      // state lets retry-button UCs be exercised AND aligns UX with the
      // rest of the dashboard (list/detail clients all surface 5xx as
      // explicit Alert + Retry).
      if (!res.ok) {
        throw new Error(`/api/usage ${res.status}`);
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
