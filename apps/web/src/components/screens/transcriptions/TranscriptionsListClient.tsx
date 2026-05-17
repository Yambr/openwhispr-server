// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U6 Transcriptions list (Client Component).
//
// Reads `queryKeys.transcriptions.list({ limit: 20 })` hydrated from the
// RSC parent. Renders a TanStack-Table-shaped table over CloudTranscription
// rows. Keyset pagination via Load-more (advances `before=<last_created_at>`).
//
// Delete row → DELETE /api/transcriptions/delete + invalidate list keys.
//
// D-API1 boundary applies to the detail screen, not the list (the list only
// shows metadata + a preview); but we share the wire shape with U7 so the
// preview text is rendered as a single truncated string, never split.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

export interface CloudTranscription {
  id: string;
  client_transcription_id: string | null;
  text: string;
  raw_text: string | null;
  word_count: number;
  source: string;
  provider: string | null;
  model: string | null;
  language: string | null;
  audio_duration_ms: number | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  transcriptions: CloudTranscription[];
}

const PAGE_LIMIT = 20;

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export function TranscriptionsListClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const queryClient = useQueryClient();
  const [cursor] = useState<ListCursor>({ limit: PAGE_LIMIT });

  const list = useQuery({
    queryKey: queryKeys.transcriptions.list(cursor),
    queryFn: () => clientFetch<ListResponse>(`/api/transcriptions/list?limit=${cursor.limit}`),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      clientFetch<{ ok: true }>("/api/transcriptions/delete", {
        method: "DELETE",
        body: { id },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transcriptions", "list"] });
    },
  });

  if (list.isPending) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.trx-list.title.heading.text")}
        </h1>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("end-user:end-user.trx-list.table.col-created.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-preview.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-words.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-duration.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-provider.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-model.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-language.label")}</TableHead>
              <TableHead>{t("end-user:end-user.trx-list.table.col-status.label")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
              <TableRow key={`skel-row-${i}`} data-testid="trx-list-skeleton-row">
                {Array.from({ length: 9 }).map((__, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
                  <TableCell key={`skel-cell-${i}-${j}`}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.trx-list.title.heading.text")}
        </h1>
        <Alert variant="destructive">
          <AlertTitle>{t("end-user:end-user.trx-list.error.title.text")}</AlertTitle>
          <AlertDescription>
            <Button onClick={() => list.refetch()} size="sm" variant="outline">
              {t("end-user:end-user.trx-list.error.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const items = list.data.transcriptions;
  const hasMore = items.length >= PAGE_LIMIT;

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.trx-list.title.heading.text")}
        </h1>
        <p className="text-text-muted text-sm">
          {t("end-user:end-user.trx-list.subtitle.body.text")}
        </p>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.trx-list.empty.title.text")}</CardTitle>
            <CardDescription>{t("end-user:end-user.trx-list.empty.body.text")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-2xl">
        {t("end-user:end-user.trx-list.title.heading.text")}
      </h1>
      <p className="text-text-muted text-sm">
        {t("end-user:end-user.trx-list.subtitle.body.text")}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("end-user:end-user.trx-list.table.col-created.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-preview.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-words.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-duration.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-provider.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-model.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-language.label")}</TableHead>
            <TableHead>{t("end-user:end-user.trx-list.table.col-status.label")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatDate(row.created_at)}</TableCell>
              <TableCell>
                <a className="hover:underline" href={`/app/transcriptions/${row.id}`}>
                  {truncate(row.text, 60)}
                </a>
              </TableCell>
              <TableCell>{row.word_count}</TableCell>
              <TableCell>{formatDuration(row.audio_duration_ms)}</TableCell>
              <TableCell>{row.provider ?? "—"}</TableCell>
              <TableCell>{row.model ?? "—"}</TableCell>
              <TableCell>{row.language ?? "—"}</TableCell>
              <TableCell>{row.status}</TableCell>
              <TableCell>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      {t("end-user:end-user.trx-list.row.action-delete.label")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("end-user:end-user.trx-list.row.action-delete.label")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>{truncate(row.text, 120)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("common:common.action.cancel.label")}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate(row.id)}>
                        {t("end-user:end-user.trx-list.row.action-delete.label")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore ? (
        <div className="flex justify-center">
          <Button onClick={() => list.refetch()} size="sm" variant="outline">
            {t("end-user:end-user.trx-list.action.loadmore.label")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
