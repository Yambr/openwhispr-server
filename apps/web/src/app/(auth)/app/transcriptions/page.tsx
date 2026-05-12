// Phase 07.1 / Plan 09 — U6 RSC entry for /app/transcriptions.
//
// Prefetches `GET /api/transcriptions/list?limit=20` server-side and hydrates
// the TanStack Query cache, then renders the Client component. RSC fetch
// forwards the incoming Cookie header to apps/api (Pitfall 2 — RSC fetch does
// not inherit browser cookies).
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { TranscriptionsListClient } from "@/components/screens/transcriptions/TranscriptionsListClient";
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

export default async function TranscriptionsPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 20 } as const;

  if (!ssrPrefetchDisabled()) {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.transcriptions.list(cursor),
      queryFn: async () => {
        const res = await fetch(
          `${internalApiUrl()}/api/transcriptions/list?limit=${cursor.limit}`,
          {
            headers: { cookie: cookieHeader },
            cache: "no-store",
          },
        );
        if (!res.ok) return { transcriptions: [] };
        return (await res.json()) as { transcriptions: unknown[] };
      },
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TranscriptionsListClient />
    </HydrationBoundary>
  );
}
