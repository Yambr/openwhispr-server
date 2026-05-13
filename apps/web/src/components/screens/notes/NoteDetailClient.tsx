// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 10 — U9 Note detail (Client Component).
//
// === Access pattern: Branch B (list-then-filter) ===
// apps/api has no GET /api/notes/:id. We page through GET /api/notes/list
// with `limit=50, before=<last_created_at>` up to a hard cap (5 pages = 250
// rows); if the target id is past that cap we render the "not found" state.
// Phase 7.x backlog: add GET /api/notes/:id endpoint.
//
// Tabs are rendered ONLY for the fields that have content:
//   - "Content" — always present (content is non-nullable per upstream wire)
//   - "Transcript" — only if transcript !== null && trimmed length > 0
//   - "Enhanced" — only if enhanced_content !== null && trimmed length > 0
//
// Metadata Card:
//   - Created, Folder (resolved from folders cache), Audio duration (mm:ss),
//     Note type. Participants ONLY when note_type === 'meeting'.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { CloudFolder, CloudNote } from "./NotesListClient";

const PAGE_LIMIT = 50;
const MAX_PAGES = 5;

interface NotesListResponse {
  notes: CloudNote[];
}
interface FoldersListResponse {
  folders: CloudFolder[];
}

function formatDurationSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const totalSec = Math.floor(s);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

async function findNoteByPaging(id: string, signal?: AbortSignal): Promise<CloudNote | null> {
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (before) params.set("before", before);
    const init: { signal?: AbortSignal } = {};
    if (signal !== undefined) init.signal = signal;
    const res = await clientFetch<NotesListResponse>(`/api/notes/list?${params.toString()}`, init);
    const rows = res.notes ?? [];
    const match = rows.find((r) => r.id === id);
    if (match) return match;
    if (rows.length < PAGE_LIMIT) return null;
    const last = rows[rows.length - 1];
    if (!last) return null;
    before = last.created_at;
  }
  return null;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface NoteDetailClientProps {
  noteId: string;
}

export function NoteDetailClient({ noteId }: NoteDetailClientProps): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.notes.detail(noteId),
    queryFn: ({ signal }) => findNoteByPaging(noteId, signal),
  });

  const folders = useQuery({
    queryKey: queryKeys.folders(),
    queryFn: () => clientFetch<FoldersListResponse>("/api/folders/list?limit=200"),
  });

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders.data?.folders ?? []) map.set(f.id, f.name);
    return map;
  }, [folders.data]);

  const del = useMutation({
    mutationFn: () =>
      clientFetch<{ ok: true }>("/api/notes/delete", {
        method: "DELETE",
        body: { id: noteId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      router.push("/app/notes");
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-4" data-testid="note-detail-skeleton">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (detail.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("end-user:end-user.note-detail.error.title.text")}</AlertTitle>
        <AlertDescription>
          <Button onClick={() => detail.refetch()} size="sm" variant="outline">
            {t("end-user:end-user.note-detail.error.retry.label")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const row = detail.data;
  if (!row) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.note-detail.empty.title.text")}</CardTitle>
          <CardDescription>{t("end-user:end-user.note-detail.empty.body.text")}</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm hover:underline" href="/app/notes">
            {t("end-user:end-user.note-detail.action.back.label")}
          </a>
        </CardContent>
      </Card>
    );
  }

  const hasTranscript = nonEmpty(row.transcript);
  const hasEnhanced = nonEmpty(row.enhanced_content);
  const folderName = row.folder_id !== null ? (folderNameById.get(row.folder_id) ?? "—") : "—";
  const isMeeting = row.note_type === "meeting";

  // `row` is guaranteed non-null inside this scope (the !row branch above
  // returns early). The handlers close over it as a plain const.
  const rowNonNull = row;
  function handleCopy(): void {
    void navigator.clipboard.writeText(rowNonNull.content).then(() => {
      toast.success(t("end-user:end-user.note-detail.action.copy.label"));
    });
  }

  function handleExportJson(): void {
    const blob = new Blob([JSON.stringify(rowNonNull, null, 2)], { type: "application/json" });
    downloadBlob(blob, `note-${rowNonNull.id}.json`);
  }

  function handleExportMd(): void {
    const lines = [
      `# ${rowNonNull.title ?? rowNonNull.id}`,
      "",
      `- Created: ${rowNonNull.created_at}`,
      `- Note type: ${rowNonNull.note_type}`,
      `- Folder: ${folderName}`,
      "",
      "## Content",
      "",
      rowNonNull.content,
    ];
    if (hasTranscript && rowNonNull.transcript) {
      lines.push("", "## Transcript", "", rowNonNull.transcript);
    }
    if (hasEnhanced && rowNonNull.enhanced_content) {
      lines.push("", "## Enhanced", "", rowNonNull.enhanced_content);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    downloadBlob(blob, `note-${rowNonNull.id}.md`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <main className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h1 className="font-semibold text-2xl">
            {row.title ?? t("end-user:end-user.note-detail.title.heading.text")}
          </h1>
          <div className="flex gap-2">
            <Button onClick={handleCopy} size="sm" variant="outline">
              {t("end-user:end-user.note-detail.action.copy.label")}
            </Button>
            <Button onClick={handleExportJson} size="sm" variant="outline">
              {t("end-user:end-user.note-detail.action.export-json.label")}
            </Button>
            <Button onClick={handleExportMd} size="sm" variant="outline">
              {t("end-user:end-user.note-detail.action.export-md.label")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  {t("end-user:end-user.note-detail.action.delete.label")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("end-user:end-user.note-detail.action.delete.label")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("end-user:end-user.note-detail.empty.body.text")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate()}>
                    {t("end-user:end-user.note-detail.action.delete.label")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>
        <Separator />
        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">
              {t("end-user:end-user.note-detail.tabs.content.label")}
            </TabsTrigger>
            {hasTranscript ? (
              <TabsTrigger value="transcript">
                {t("end-user:end-user.note-detail.tabs.transcript.label")}
              </TabsTrigger>
            ) : null}
            {hasEnhanced ? (
              <TabsTrigger value="enhanced">
                {t("end-user:end-user.note-detail.tabs.enhanced.label")}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value="content">
            <article className="prose prose-sm max-w-none whitespace-pre-wrap">
              {row.content}
            </article>
          </TabsContent>
          {hasTranscript ? (
            <TabsContent value="transcript">
              <article className="prose prose-sm max-w-none whitespace-pre-wrap">
                {row.transcript}
              </article>
            </TabsContent>
          ) : null}
          {hasEnhanced ? (
            <TabsContent value="enhanced">
              <article className="prose prose-sm max-w-none whitespace-pre-wrap">
                {row.enhanced_content}
                {row.enhancement_prompt ? (
                  <p className="mt-4 text-text-muted text-xs">Prompt: {row.enhancement_prompt}</p>
                ) : null}
              </article>
            </TabsContent>
          ) : null}
        </Tabs>
      </main>
      <aside>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.note-detail.metadata.title.label")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <MetaRow
              label={t("end-user:end-user.note-detail.metadata.created.label")}
              value={row.created_at}
            />
            <MetaRow
              label={t("end-user:end-user.note-detail.metadata.folder.label")}
              value={folderName}
            />
            <MetaRow
              label={t("end-user:end-user.note-detail.metadata.duration.label")}
              value={formatDurationSeconds(row.audio_duration_seconds)}
            />
            <div className="flex items-center justify-between">
              <span className="text-text-muted">
                {t("end-user:end-user.note-detail.metadata.type.label")}
              </span>
              <Badge variant="secondary">{row.note_type}</Badge>
            </div>
            {isMeeting ? (
              <MetaRow
                label={t("end-user:end-user.note-detail.metadata.participants.label")}
                value={row.participants ?? "—"}
              />
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
