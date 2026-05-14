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
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}

// Phase 07.1 / Plan 13.2 — see (auth)/app/page.tsx for the rationale.
function ssrPrefetchDisabled(): boolean {
  return process.env.PLAYWRIGHT_DISABLE_SSR_PREFETCH === "1";
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 50 } as const;

  if (!ssrPrefetchDisabled()) {
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
        if (!res.ok) return { messages: [] };
        return (await res.json()) as { messages: unknown[] };
      },
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConversationDetailClient conversationId={id} />
    </HydrationBoundary>
  );
}
