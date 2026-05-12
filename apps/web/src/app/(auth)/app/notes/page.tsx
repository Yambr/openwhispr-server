// Phase 07.1 / Plan 10 — U8 RSC entry for /app/notes.
//
// Prefetches GET /api/notes/list?limit=20 + GET /api/folders/list server-side
// and hydrates the TanStack Query cache, then renders the Client component.
// RSC fetch forwards the incoming Cookie header (Pitfall 2 — RSC fetch does
// not inherit browser cookies).
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { NotesListClient } from "@/components/screens/notes/NotesListClient";
import { makeServerQueryClient } from "@/lib/query-client-server";
import { queryKeys } from "@/lib/query-keys";

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}

export default async function NotesPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const queryClient = makeServerQueryClient();
  const cursor = { limit: 20 } as const;

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.notes.list(cursor),
      queryFn: async () => {
        const res = await fetch(`${internalApiUrl()}/api/notes/list?limit=${cursor.limit}`, {
          headers: { cookie: cookieHeader },
          cache: "no-store",
        });
        if (!res.ok) return { notes: [] };
        return (await res.json()) as { notes: unknown[] };
      },
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.folders(),
      queryFn: async () => {
        const res = await fetch(`${internalApiUrl()}/api/folders/list?limit=200`, {
          headers: { cookie: cookieHeader },
          cache: "no-store",
        });
        if (!res.ok) return { folders: [] };
        return (await res.json()) as { folders: unknown[] };
      },
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <NotesListClient />
    </HydrationBoundary>
  );
}
