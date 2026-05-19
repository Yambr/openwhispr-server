// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U12 RSC entry for /app/conversations/[id].
//
// Prefetches `GET /api/conversations/messages?conversation_id=<id>&limit=50`
// server-side and hydrates the TanStack Query cache, then renders the Client
// component which uses keyset pagination for older pages.
//
// /api/conversations/messages is a dual-method endpoint (Plan 01 verified):
// POST line 79 is desktop-client only, GET line 145 is what the RSC + Client
// use here.
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { ConversationDetailClient } from "@/components/screens/conversations/ConversationDetailClient";
// Plan 51-11b — INTERNAL_API_URL helper centralised (REVIEW web HIGH HI-03).
import { internalApiUrl } from "@/lib/internal-api";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

// Phase 41 / Plan 41-c (HI-2) — removed PLAYWRIGHT_DISABLE_SSR_PREFETCH env branch.

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 50 } as const;

  await queryClient.prefetchQuery({
    queryKey: queryKeys.conversations.messages(id, cursor),
    queryFn: async () => {
      const qp = new URLSearchParams({
        conversation_id: id,
        limit: String(cursor.limit),
      });
      const res = await fetch(`${internalApiUrl()}/api/conversations/messages?${qp.toString()}`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      // Phase 55-06-batch (BUG-55-06-a-RSC-FETCH-WALL): on non-2xx, throw so
      // the dehydrated cache hydrates Client useQuery's `isError=true` branch
      // (ConversationDetailClient.tsx:139-150 renders Alert + Retry).
      if (!res.ok) {
        throw new Error(`/api/conversations/messages ${res.status}`);
      }
      return (await res.json()) as { messages: unknown[] };
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConversationDetailClient conversationId={id} />
    </HydrationBoundary>
  );
}
