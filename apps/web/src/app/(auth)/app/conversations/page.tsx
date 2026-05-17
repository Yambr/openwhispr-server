// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U11 RSC entry for /app/conversations.
//
// Prefetches `GET /api/conversations/list?limit=20` server-side and hydrates
// the TanStack Query cache, then renders the Client component. RSC fetch
// forwards the incoming Cookie header to apps/api (Pitfall 2 — RSC fetch
// does not inherit browser cookies).
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { ConversationsListClient } from "@/components/screens/conversations/ConversationsListClient";
// Plan 51-11b — INTERNAL_API_URL helper centralised (REVIEW web HIGH HI-03).
import { internalApiUrl } from "@/lib/internal-api";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

// Phase 41 / Plan 41-c (HI-2) — removed PLAYWRIGHT_DISABLE_SSR_PREFETCH env branch.

export default async function ConversationsPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 20 } as const;

  await queryClient.prefetchQuery({
    queryKey: queryKeys.conversations.list(cursor),
    queryFn: async () => {
      const res = await fetch(`${internalApiUrl()}/api/conversations/list?limit=${cursor.limit}`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      if (!res.ok) return { conversations: [] };
      return (await res.json()) as { conversations: unknown[] };
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConversationsListClient />
    </HydrationBoundary>
  );
}
