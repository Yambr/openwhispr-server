// Phase 07.1 / Plan 11 — U13 Conversations search (Client Component).
//
// Reads `?q=<query>` from useSearchParams() and POSTs to
// /api/conversations/search with body `{ query, limit }`
// (Plan 01 verified: POST, not GET).
//
// Renders result rows with title + score badge. Submit pushes the input
// value to ?q=<value>. Clear pushes ?q=.
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";

const SEARCH_LIMIT = 20;

interface SearchResult {
  id: string;
  client_conversation_id: string | null;
  title: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  score: number;
}

interface SearchResponse {
  conversations: SearchResult[];
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function ConversationsSearchClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState<string>(q);

  const search = useQuery({
    queryKey: queryKeys.conversations.search(q),
    queryFn: () =>
      clientFetch<SearchResponse>("/api/conversations/search", {
        method: "POST",
        body: { query: q, limit: SEARCH_LIMIT },
      }),
    enabled: q.trim().length > 0,
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const value = draft.trim();
    const next = value.length > 0 ? `?q=${encodeURIComponent(value)}` : "";
    router.push(`/app/conversations/search${next}`);
  }

  function handleClear(): void {
    setDraft("");
    router.push("/app/conversations/search");
  }

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-2xl">
        {t("end-user:end-user.conv-search.title.heading.text")}
      </h1>
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <Input
          aria-label={t("end-user:end-user.conv-search.input.placeholder.text")}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("end-user:end-user.conv-search.input.placeholder.text")}
          value={draft}
        />
        <Button size="sm" type="submit">
          {t("end-user:end-user.conv-search.action.submit.label")}
        </Button>
        <Button onClick={handleClear} size="sm" type="button" variant="outline">
          {t("end-user:end-user.conv-search.action.clear.label")}
        </Button>
      </form>
      <Separator />
      {q.trim().length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>{t("end-user:end-user.conv-search.empty.type.text")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : null}
      {q.trim().length > 0 && search.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
            <Skeleton className="h-10 w-full" data-testid="conv-search-skeleton-row" key={i} />
          ))}
        </div>
      ) : null}
      {q.trim().length > 0 && search.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("end-user:end-user.conv-search.error.title.text")}</AlertTitle>
          <AlertDescription>
            <Button onClick={() => search.refetch()} size="sm" variant="outline">
              {t("end-user:end-user.conv-search.error.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {q.trim().length > 0 && search.isSuccess ? (
        <ResultList rows={search.data?.conversations ?? []} />
      ) : null}
    </div>
  );
}

function ResultList({ rows }: { rows: SearchResult[] }): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.conv-search.empty.none.text")}</CardTitle>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const titleDisplay = row.title && row.title.length > 0 ? row.title : "—";
        return (
          <li className="flex items-center justify-between rounded-md border p-3" key={row.id}>
            <a className="hover:underline" href={`/app/conversations/${row.id}`}>
              {titleDisplay}
            </a>
            <div className="flex items-center gap-3">
              <span className="text-text-muted text-xs">{formatDate(row.updated_at)}</span>
              <Badge variant="secondary">
                {t("end-user:end-user.conv-search.result.score.label")}{" "}
                {Number(row.score).toFixed(2)}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
