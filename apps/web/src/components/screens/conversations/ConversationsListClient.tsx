// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U11 Conversations list (Client Component).
//
// Reads `queryKeys.conversations.list({ limit: 20 })` hydrated from the
// RSC parent. Renders a Table of CloudConversation rows. Keyset pagination
// via Load-more (advances `before=<last_created_at>`).
//
// Row Delete → DELETE /api/conversations/delete + invalidate list keys.
// Row click → /app/conversations/[id] (U12).
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

export interface CloudConversation {
  id: string;
  client_conversation_id: string | null;
  title: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  conversations: CloudConversation[];
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

function buildListUrl(cursor: ListCursor): string {
  const params = new URLSearchParams({ limit: String(cursor.limit) });
  if (cursor.before) params.set("before", cursor.before);
  if (cursor.since) params.set("since", cursor.since);
  return `/api/conversations/list?${params.toString()}`;
}

export function ConversationsListClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const queryClient = useQueryClient();
  const [cursor] = useState<ListCursor>({ limit: PAGE_LIMIT });

  const list = useQuery({
    queryKey: queryKeys.conversations.list(cursor),
    queryFn: () => clientFetch<ListResponse>(buildListUrl(cursor)),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      clientFetch<{ ok: true }>("/api/conversations/delete", {
        method: "DELETE",
        body: { id },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    },
  });

  if (list.isPending) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.conv-list.title.heading.text")}
        </h1>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("end-user:end-user.conv-list.table.col-created.label")}</TableHead>
              <TableHead>{t("end-user:end-user.conv-list.table.col-title.label")}</TableHead>
              <TableHead>{t("end-user:end-user.conv-list.table.col-updated.label")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
              <TableRow key={i} data-testid="conv-list-skeleton-row">
                {Array.from({ length: 4 }).map((__, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
                  <TableCell key={j}>
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
          {t("end-user:end-user.conv-list.title.heading.text")}
        </h1>
        <Alert variant="destructive">
          <AlertTitle>{t("end-user:end-user.conv-list.error.title.text")}</AlertTitle>
          <AlertDescription>
            <Button onClick={() => list.refetch()} size="sm" variant="outline">
              {t("end-user:end-user.conv-list.error.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const items = list.data?.conversations ?? [];
  const hasMore = items.length >= PAGE_LIMIT;

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.conv-list.title.heading.text")}
        </h1>
        <p className="text-text-muted text-sm">
          {t("end-user:end-user.conv-list.subtitle.body.text")}
        </p>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.conv-list.empty.title.text")}</CardTitle>
            <CardDescription>{t("end-user:end-user.conv-list.empty.body.text")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-2xl">
        {t("end-user:end-user.conv-list.title.heading.text")}
      </h1>
      <p className="text-text-muted text-sm">
        {t("end-user:end-user.conv-list.subtitle.body.text")}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("end-user:end-user.conv-list.table.col-created.label")}</TableHead>
            <TableHead>{t("end-user:end-user.conv-list.table.col-title.label")}</TableHead>
            <TableHead>{t("end-user:end-user.conv-list.table.col-updated.label")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => {
            const titleDisplay = row.title && row.title.length > 0 ? row.title : "—";
            return (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.created_at)}</TableCell>
                <TableCell>
                  <a className="hover:underline" href={`/app/conversations/${row.id}`}>
                    {titleDisplay}
                  </a>
                </TableCell>
                <TableCell>{formatDate(row.updated_at)}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        {t("end-user:end-user.conv-list.row.action-delete.label")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("end-user:end-user.conv-list.row.action-delete.label")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>{titleDisplay}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(row.id)}>
                          {t("end-user:end-user.conv-list.row.action-delete.label")}
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
            {t("end-user:end-user.conv-list.action.loadmore.label")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
