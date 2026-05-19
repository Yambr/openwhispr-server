// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U6 RSC entry for /app/transcriptions.
//
// Prefetches `GET /api/transcriptions/list?limit=20` server-side and hydrates
// the TanStack Query cache, then renders the Client component. RSC fetch
// forwards the incoming Cookie header to apps/api (Pitfall 2 — RSC fetch does
// not inherit browser cookies).
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { TranscriptionsListClient } from "@/components/screens/transcriptions/TranscriptionsListClient";
// Plan 51-11b — INTERNAL_API_URL helper centralised (REVIEW web HIGH HI-03).
import { internalApiUrl } from "@/lib/internal-api";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

// Phase 41 / Plan 41-c (HI-2) — removed PLAYWRIGHT_DISABLE_SSR_PREFETCH env branch.

export default async function TranscriptionsPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 20 } as const;

  await queryClient.prefetchQuery({
    queryKey: queryKeys.transcriptions.list(cursor),
    queryFn: async () => {
      const res = await fetch(`${internalApiUrl()}/api/transcriptions/list?limit=${cursor.limit}`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      // Phase 55-06-batch (BUG-55-06-a-RSC-FETCH-WALL): on non-2xx, throw so
      // the dehydrated cache hydrates Client useQuery's `isError=true` branch
      // (TranscriptionsListClient.tsx:150-166 renders Alert + Retry).
      if (!res.ok) {
        throw new Error(`/api/transcriptions/list ${res.status}`);
      }
      return (await res.json()) as { transcriptions: unknown[] };
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TranscriptionsListClient />
    </HydrationBoundary>
  );
}
