// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U7 RSC entry for /app/transcriptions/[id].
//
// === U7 access-pattern decision: Branch B (list-then-filter) ===
//
// `apps/api/src/routes/transcriptions/list.ts` accepts only `limit / before /
// since` query params (see `parseListQuery` in
// `apps/api/src/lib/keyset-pagination.ts`). There is no single-row endpoint
// such as `GET /api/transcriptions/:id` and the list endpoint does NOT support
// an `?id=<uuid>` filter param. To resolve a single transcription by id, the
// Client pages forward through the list with `limit=50, before=<last>` up to a
// hard cap (5 pages = 250 rows). If the target id is older than the 250 most
// recent rows the user sees the "not found" empty state.
//
// Phase 7.x backlog (recorded in .planning/STATE.md): add
// `GET /api/transcriptions/:id` so this U7 RSC can prefetch a single row
// without paginating. Refs: WEB-IMPL-02 (Phase 07.1).
//
// We intentionally do NOT prefetch on the server for the detail screen — the
// list-then-filter scan can fan out multiple round-trips and we want to keep
// the time-to-first-byte budget tight. The Client renders a Skeleton during
// the scan and the empty/error states cover the rest of the matrix.
import { TranscriptionDetailClient } from "@/components/screens/transcriptions/TranscriptionDetailClient";

export default async function TranscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <TranscriptionDetailClient transcriptionId={id} />;
}
