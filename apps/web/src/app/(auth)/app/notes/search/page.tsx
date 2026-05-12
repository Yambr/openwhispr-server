// Phase 07.1 / Plan 10 — U10 RSC entry for /app/notes/search.
//
// Pure Client Component delegate — the search query is gated on q.length >= 2
// inside NotesSearchClient (TanStack Query `enabled`), so there is nothing
// useful for the RSC to prefetch (we'd need the q to issue a useful query,
// and we don't have it until the client renders).
import { NotesSearchClient } from "@/components/screens/notes/NotesSearchClient";

export default function NotesSearchPage(): React.JSX.Element {
  return <NotesSearchClient />;
}
