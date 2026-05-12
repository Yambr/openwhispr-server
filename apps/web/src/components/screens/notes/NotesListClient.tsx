// Phase 07.1 / Plan 10 — U8 Notes list (Client Component).
//
// Reads `queryKeys.notes.list({ limit: 20 })` and `queryKeys.folders()` in
// parallel (two useQuery calls). The folder cache resolves folder_id → name
// in the Table's Folder column without an N+1 fetch.
//
// Folder filter is driven by the `?folder=<id>` search param so the URL is
// the single source of truth (D-UX5 — the URL fully encodes the filter
// state). Sidebar updates the param, list re-fetches by re-keying on cursor.
//
// D-S1: only GET /api/notes/list + GET /api/folders/list + DELETE /api/notes/delete.
// D-API verified: search is POST /api/notes/search; top search bar navigates
// to /app/notes/search?q=... instead of issuing a query here.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientFetch } from "@/lib/client-fetch";
import { type ListCursor, queryKeys } from "@/lib/query-keys";
import { FoldersSidebar } from "./FoldersSidebar";

export interface CloudNote {
  id: string;
  client_note_id: string | null;
  title: string | null;
  content: string;
  enhanced_content: string | null;
  note_type: string;
  enhancement_prompt: string | null;
  source_file: string | null;
  audio_duration_seconds: number | null;
  folder_id: string | null;
  transcript: string | null;
  enhanced_at_content_hash: string | null;
  participants: string | null;
  calendar_event_id: string | null;
  diarization_enabled: number | null;
  expected_speaker_count: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudFolder {
  id: string;
  client_folder_id: string | null;
  name: string;
  is_default: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NotesListResponse {
  notes: CloudNote[];
}

interface FoldersListResponse {
  folders: CloudFolder[];
}

const PAGE_LIMIT = 20;

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function NotesListClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const folderFilter = searchParams.get("folder") ?? null;
  const [cursor] = useState<ListCursor>({ limit: PAGE_LIMIT });
  const [searchTerm, setSearchTerm] = useState("");

  const folders = useQuery({
    queryKey: queryKeys.folders(),
    queryFn: () => clientFetch<FoldersListResponse>("/api/folders/list?limit=200"),
  });

  const list = useQuery({
    queryKey: [...queryKeys.notes.list(cursor), { folder: folderFilter }],
    queryFn: () => clientFetch<NotesListResponse>(`/api/notes/list?limit=${cursor.limit}`),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      clientFetch<{ ok: true }>("/api/notes/delete", {
        method: "DELETE",
        body: { id },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
    },
  });

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders.data?.folders ?? []) {
      map.set(f.id, f.name);
    }
    return map;
  }, [folders.data]);

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const q = searchTerm.trim();
    if (q.length === 0) return;
    router.push(`/app/notes/search?q=${encodeURIComponent(q)}`);
  }

  const items = (list.data?.notes ?? []).filter((n) =>
    folderFilter === null ? true : n.folder_id === folderFilter,
  );
  const hasMore = (list.data?.notes ?? []).length >= PAGE_LIMIT;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <FoldersSidebar />
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-semibold text-2xl">
            {t("end-user:end-user.notes-list.title.heading.text")}
          </h1>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <Input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("end-user:end-user.notes-list.action.search.label")}
              aria-label={t("end-user:end-user.notes-list.action.search.label")}
              className="w-64"
            />
            <Button type="submit" size="sm" variant="outline">
              {t("end-user:end-user.notes-list.action.search.label")}
            </Button>
          </form>
        </header>
        <p className="text-text-muted text-sm">
          {t("end-user:end-user.notes-list.subtitle.body.text")}
        </p>

        {list.isPending ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("end-user:end-user.notes-list.table.col-title.label")}</TableHead>
                <TableHead>{t("end-user:end-user.notes-list.table.col-folder.label")}</TableHead>
                <TableHead>{t("end-user:end-user.notes-list.table.col-words.label")}</TableHead>
                <TableHead>{t("end-user:end-user.notes-list.table.col-created.label")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
                <TableRow key={`skel-row-${i}`} data-testid="notes-list-skeleton-row">
                  {Array.from({ length: 5 }).map((__, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
                    <TableCell key={`skel-cell-${i}-${j}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : list.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("end-user:end-user.notes-list.error.title.text")}</AlertTitle>
            <AlertDescription>
              <Button onClick={() => list.refetch()} size="sm" variant="outline">
                {t("end-user:end-user.notes-list.error.retry.label")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("end-user:end-user.notes-list.empty.title.text")}</CardTitle>
              <CardDescription>{t("end-user:end-user.notes-list.empty.body.text")}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("end-user:end-user.notes-list.table.col-title.label")}</TableHead>
                  <TableHead>{t("end-user:end-user.notes-list.table.col-folder.label")}</TableHead>
                  <TableHead>{t("end-user:end-user.notes-list.table.col-words.label")}</TableHead>
                  <TableHead>{t("end-user:end-user.notes-list.table.col-created.label")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => {
                  const folderName =
                    row.folder_id !== null ? (folderNameById.get(row.folder_id) ?? "—") : "—";
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <a className="hover:underline" href={`/app/notes/${row.id}`}>
                          {row.title ?? "(untitled)"}
                        </a>
                      </TableCell>
                      <TableCell>{folderName}</TableCell>
                      <TableCell>{wordCount(row.content)}</TableCell>
                      <TableCell>{formatDate(row.created_at)}</TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              {t("end-user:end-user.notes-list.row.action-delete.label")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("end-user:end-user.notes-list.row.action-delete.label")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {row.title ?? row.content.slice(0, 80)}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(row.id)}>
                                {t("end-user:end-user.notes-list.row.action-delete.label")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasMore ? (
              <div className="flex justify-center">
                <Button onClick={() => list.refetch()} size="sm" variant="outline">
                  {t("end-user:end-user.notes-list.action.loadmore.label")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
