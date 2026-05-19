// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U12 Conversation detail (Client Component).
//
// Uses GET /api/conversations/messages?conversation_id=<id>&limit=&before=
// (dual-method endpoint — Plan 01 verified the GET branch lines 145-208 of
// apps/api/src/routes/conversations/messages.ts; POST is desktop-client only).
//
// Keyset pagination: messages ordered created_at DESC (newest first per the
// route's `buildKeysetOrderLimit`). "Load earlier messages" advances
// `before=<oldest_created_at>`. Pages accumulate in component state.
//
// Actions: Copy transcript, Export JSON, Delete conversation.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";
import { type CloudMessage, MessageBubble, roleLabelKey } from "./MessageBubble";

const PAGE_LIMIT = 50;

interface MessagesResponse {
  messages: CloudMessage[];
}

function buildMessagesUrl(conversationId: string, before?: string): string {
  const params = new URLSearchParams({
    conversation_id: conversationId,
    limit: String(PAGE_LIMIT),
  });
  if (before) params.set("before", before);
  return `/api/conversations/messages?${params.toString()}`;
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

export interface ConversationDetailClientProps {
  conversationId: string;
}

export function ConversationDetailClient({
  conversationId,
}: ConversationDetailClientProps): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [before, setBefore] = useState<string | undefined>(undefined);
  // Accumulated older pages, prepended in chronological-ascending order to the
  // first-page DESC-ordered tail. Index 0 is the oldest accumulated row.
  const [olderPages, setOlderPages] = useState<CloudMessage[]>([]);

  const first = useQuery({
    queryKey: queryKeys.conversations.messages(conversationId, { limit: PAGE_LIMIT }),
    queryFn: () => clientFetch<MessagesResponse>(buildMessagesUrl(conversationId)),
  });

  const del = useMutation({
    mutationFn: () =>
      clientFetch<{ ok: true }>("/api/conversations/delete", {
        method: "DELETE",
        body: { id: conversationId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
      router.push("/app/conversations");
    },
  });

  async function handleLoadEarlier(): Promise<void> {
    const firstPage = first.data?.messages ?? [];
    // Oldest seen row's created_at = last item of either accumulated older
    // pages (older[0]) or first page tail (DESC → last index is oldest).
    let cursor: string | undefined = before;
    if (!cursor) {
      if (olderPages.length > 0) {
        cursor = olderPages[0]?.created_at;
      } else if (firstPage.length > 0) {
        cursor = firstPage[firstPage.length - 1]?.created_at;
      }
    }
    if (!cursor) return;
    const res = await clientFetch<MessagesResponse>(buildMessagesUrl(conversationId, cursor));
    const rows = res.messages ?? [];
    if (rows.length === 0) {
      setBefore(cursor);
      return;
    }
    // Prepend (oldest first). API returns DESC so the actually-oldest in this
    // page is rows[rows.length - 1].
    setOlderPages((prev) => {
      const asAscending = [...rows].reverse();
      return [...asAscending, ...prev];
    });
    const oldest = rows[rows.length - 1]?.created_at;
    setBefore(oldest ?? cursor);
  }

  if (first.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" data-testid="conv-detail-skeleton" />
        <Skeleton className="h-16 w-3/4" data-testid="conv-detail-skeleton" />
        <Skeleton className="ml-auto h-16 w-3/4" data-testid="conv-detail-skeleton" />
        <Skeleton className="h-16 w-3/4" data-testid="conv-detail-skeleton" />
      </div>
    );
  }

  if (first.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("end-user:end-user.conv-detail.error.title.text")}</AlertTitle>
        <AlertDescription>
          <Button onClick={() => first.refetch()} size="sm" variant="outline">
            {t("end-user:end-user.conv-detail.error.retry.label")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const firstPageMessages = first.data?.messages ?? [];
  // Chronological-ascending render order. API returns DESC, so reverse the
  // first page; older accumulated pages are already ascending.
  const ascendingMessages: CloudMessage[] = [...olderPages, ...[...firstPageMessages].reverse()];

  if (ascendingMessages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.conv-detail.empty.title.text")}</CardTitle>
          <CardDescription>{t("end-user:end-user.conv-detail.empty.body.text")}</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm hover:underline" href="/app/conversations">
            {t("end-user:end-user.conv-detail.action.back.label")}
          </a>
        </CardContent>
      </Card>
    );
  }

  function handleCopy(): void {
    const lines: string[] = [];
    for (const m of ascendingMessages) {
      const label = t(roleLabelKey(m.role));
      lines.push(`### ${label}`, m.content, "");
    }
    const text = lines.join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      toast.success(t("end-user:end-user.conv-detail.action.copy.label"));
    });
  }

  function handleExportJson(): void {
    const payload = {
      conversation: { id: conversationId },
      messages: ascendingMessages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `conversation-${conversationId}.json`);
  }

  const showLoadEarlier = firstPageMessages.length >= PAGE_LIMIT;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.conv-detail.title.heading.text")}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ["conversations", "messages", conversationId],
              })
            }
            size="sm"
            variant="outline"
          >
            {t("end-user:end-user.conv-detail.action.refresh.label")}
          </Button>
          <Button onClick={handleCopy} size="sm" variant="outline">
            {t("end-user:end-user.conv-detail.action.copy.label")}
          </Button>
          <Button onClick={handleExportJson} size="sm" variant="outline">
            {t("end-user:end-user.conv-detail.action.export-json.label")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                {t("end-user:end-user.conv-detail.action.delete.label")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("end-user:end-user.conv-detail.action.delete.label")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("end-user:end-user.conv-detail.empty.body.text")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common:common.action.cancel.label")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => del.mutate()}>
                  {t("end-user:end-user.conv-detail.action.delete.label")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>
      <Separator />
      <ScrollArea className="max-h-[70vh]">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {showLoadEarlier ? (
            <div className="flex justify-center">
              <Button
                onClick={() => {
                  void handleLoadEarlier();
                }}
                size="sm"
                variant="outline"
              >
                {t("end-user:end-user.conv-detail.action.loadearlier.label")}
              </Button>
            </div>
          ) : null}
          {ascendingMessages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </ScrollArea>
      <a className="text-sm hover:underline" href="/app/conversations">
        {t("end-user:end-user.conv-detail.action.back.label")}
      </a>
    </div>
  );
}
