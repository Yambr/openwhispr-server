// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 10 — U9 RSC entry for /app/notes/[id].
//
// === Access pattern: Branch B (list-then-filter) ===
//
// apps/api has no GET /api/notes/:id and the list endpoint does NOT support
// `?id=<uuid>`. The Client pages forward through the list with
// `limit=50, before=<last>` up to a hard cap (5 pages = 250 rows). If the
// target id is older than the 250 most recent rows the user sees the
// "not found" empty state.
//
// Phase 7.x backlog (mirrors U7 / Plan 09): add GET /api/notes/:id so this
// RSC can prefetch a single row without paginating.
//
// We intentionally do NOT prefetch on the server — the list-then-filter scan
// can fan out multiple round-trips and we want a tight TTFB budget.
import { NoteDetailClient } from "@/components/screens/notes/NoteDetailClient";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <NoteDetailClient noteId={id} />;
}
