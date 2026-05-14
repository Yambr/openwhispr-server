// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U7 Transcription detail (Client Component).
//
// === U7 access-pattern decision: Branch B (list-then-filter) ===
// `apps/api/src/routes/transcriptions/list.ts` (parseListQuery from
// apps/api/src/lib/keyset-pagination.ts) only accepts `limit / before /
// since`, so there is no single-row endpoint. We page through the list with
// `limit=50, before=<last_created_at>` up to a hard cap (5 pages = 250 rows);
// if the target id is past that cap we render the "not found" empty state.
// Phase 7.x backlog: add `GET /api/transcriptions/:id` to drop this.
//
// D-API1 constitutional: the transcript renders as flat paragraphs split on
// `/\n\s*\n/`. No timestamps, no word-level markers. Tests assert no
// `\d{1,2}:\d{2}` pattern appears inside any [data-testid="trx-paragraph"].
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { CloudTranscription } from "./TranscriptionsListClient";

const PAGE_LIMIT = 50;
const MAX_PAGES = 5; // 250 rows cap — past this, render "not found".

interface ListResponse {
  transcriptions: CloudTranscription[];
}

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

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function findTranscriptionByPaging(
  id: string,
  signal: AbortSignal,
): Promise<CloudTranscription | null> {
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (before) params.set("before", before);
    const res = await clientFetch<ListResponse>(`/api/transcriptions/list?${params.toString()}`, {
      signal,
    });
    const rows = res.transcriptions;
    const match = rows.find((r) => r.id === id);
    if (match) return match;
    if (rows.length < PAGE_LIMIT) return null;
    // rows.length === PAGE_LIMIT guarantees an element at length-1.
    const last = rows[rows.length - 1] as CloudTranscription;
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
  // Give the click handler a tick to complete before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface TranscriptionDetailClientProps {
  transcriptionId: string;
}

export function TranscriptionDetailClient({
  transcriptionId,
}: TranscriptionDetailClientProps): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.transcriptions.detail(transcriptionId),
    queryFn: ({ signal }) => findTranscriptionByPaging(transcriptionId, signal),
  });

  const del = useMutation({
    mutationFn: () =>
      clientFetch<{ ok: true }>("/api/transcriptions/delete", {
        method: "DELETE",
        body: { id: transcriptionId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transcriptions", "list"] });
      router.push("/app/transcriptions");
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-4" data-testid="trx-detail-skeleton">
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
        <AlertTitle>{t("end-user:end-user.trx-detail.error.title.text")}</AlertTitle>
        <AlertDescription>
          <Button onClick={() => detail.refetch()} size="sm" variant="outline">
            {t("end-user:end-user.trx-detail.error.retry.label")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const rowOrNull = detail.data;
  if (!rowOrNull) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.trx-detail.empty.title.text")}</CardTitle>
          <CardDescription>{t("end-user:end-user.trx-detail.empty.body.text")}</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm hover:underline" href="/app/transcriptions">
            {t("end-user:end-user.trx-detail.action.back.label")}
          </a>
        </CardContent>
      </Card>
    );
  }

  const row: CloudTranscription = rowOrNull;
  const transcriptText = row.text.length > 0 ? row.text : (row.raw_text ?? "");
  const paragraphs = splitParagraphs(transcriptText);

  function handleCopy(): void {
    void navigator.clipboard.writeText(transcriptText).then(() => {
      toast.success(t("end-user:end-user.trx-detail.action.copy.label"));
    });
  }

  function handleExportJson(): void {
    const blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
    downloadBlob(blob, `transcription-${row.id}.json`);
  }

  function handleExportMd(): void {
    const lines = [
      `# Transcription ${row.id}`,
      "",
      `- Created: ${row.created_at}`,
      `- Provider: ${row.provider ?? ""}`,
      `- Model: ${row.model ?? ""}`,
      `- Language: ${row.language ?? ""}`,
      `- Word count: ${row.word_count}`,
      "",
      ...paragraphs,
    ];
    const blob = new Blob([lines.join("\n\n")], { type: "text/markdown" });
    downloadBlob(blob, `transcription-${row.id}.md`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <main className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h1 className="font-semibold text-2xl">
            {t("end-user:end-user.trx-detail.title.heading.text")}
          </h1>
          <div className="flex gap-2">
            <Button onClick={handleCopy} size="sm" variant="outline">
              {t("end-user:end-user.trx-detail.action.copy.label")}
            </Button>
            <Button onClick={handleExportJson} size="sm" variant="outline">
              {t("end-user:end-user.trx-detail.action.export-json.label")}
            </Button>
            <Button onClick={handleExportMd} size="sm" variant="outline">
              {t("end-user:end-user.trx-detail.action.export-md.label")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  {t("end-user:end-user.trx-detail.action.delete.label")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("end-user:end-user.trx-detail.action.delete.label")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("end-user:end-user.trx-detail.empty.body.text")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate()}>
                    {t("end-user:end-user.trx-detail.action.delete.label")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>
        <Separator />
        <article className="prose prose-sm max-w-none space-y-3">
          {paragraphs.map((p, i) => (
            // Paragraph index is stable for the lifetime of a given transcript's render —
            // the array is derived from immutable row.text on each render. Index key is
            // safe here per react/no-array-index-key § "stable list" exception.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable across renders
            <p key={`p-${i}`} data-testid="trx-paragraph">
              {p}
            </p>
          ))}
        </article>
      </main>
      <aside>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.trx-detail.metadata.title.label")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.words.label")}
              value={String(row.word_count)}
            />
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.duration.label")}
              value={formatDuration(row.audio_duration_ms)}
            />
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.provider.label")}
              value={row.provider ?? "—"}
            />
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.model.label")}
              value={row.model ?? "—"}
            />
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.language.label")}
              value={row.language ?? "—"}
            />
            <div className="flex items-center justify-between">
              <span className="text-text-muted">
                {t("end-user:end-user.trx-detail.metadata.status.label")}
              </span>
              <Badge variant="secondary">{row.status}</Badge>
            </div>
            <MetaRow
              label={t("end-user:end-user.trx-detail.metadata.created.label")}
              value={row.created_at}
            />
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
