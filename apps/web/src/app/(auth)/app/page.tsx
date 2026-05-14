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

// Phase 07.1 / Plan 13.2 — Playwright SSR-prefetch escape hatch.
//
// Playwright's `page.route()` only intercepts requests issued from the
// browser context. RSC-side `prefetchQuery` runs inside the Next.js
// container so its fetch traffic to apps/api is invisible to the test's
// network mocks, and the hydrated cache lands in the client before
// useQuery would otherwise fire — turning loading / error state tests
// into races that always saw the real seeded data. Setting
// `PLAYWRIGHT_DISABLE_SSR_PREFETCH=1` on the `web` container at compose
// time turns the prefetch off; the Client subtree still issues the same
// `useQuery` against /api/usage on mount, which `page.route()` happily
// intercepts. Production deploys leave the var unset.
function ssrPrefetchDisabled(): boolean {
  return process.env.PLAYWRIGHT_DISABLE_SSR_PREFETCH === "1";
}

export default async function UsagePage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();

  if (!ssrPrefetchDisabled()) {
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
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UsageDashboardClient />
    </HydrationBoundary>
  );
}
