// Phase 07.1 / Plan 10 — U10 Notes search (Client Component).
//
// D-API verified (Plan 01): search is POST /api/notes/search with body
// `{ query, limit }`. NOT GET. NOT the list endpoint.
//
// Query is GATED on q.length >= 2 (TanStack Query `enabled`). Below the
// gate we render the empty-type guidance copy; over the gate we render
// loading / error / empty-none / success per the state matrix.
//
// Score badge is formatted to 2 decimals per upstream SearchResult shape.
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import type { CloudNote } from "./NotesListClient";

interface SearchResult extends CloudNote {
  score: number;
}

interface SearchResponse {
  notes: SearchResult[];
}

const MIN_QUERY_LENGTH = 2;
const SEARCH_LIMIT = 20;

export function NotesSearchClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState(urlQ);

  // Keep the input synced if the URL changes externally (back/forward).
  useEffect(() => {
    setDraft(urlQ);
  }, [urlQ]);

  const trimmed = urlQ.trim();
  const enabled = trimmed.length >= MIN_QUERY_LENGTH;

  const search = useQuery({
    queryKey: queryKeys.notes.search(trimmed),
    enabled,
    queryFn: () =>
      clientFetch<SearchResponse>("/api/notes/search", {
        method: "POST",
        body: { query: trimmed, limit: SEARCH_LIMIT },
      }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const q = draft.trim();
    if (q.length === 0) {
      router.push("/app/notes/search");
    } else {
      router.push(`/app/notes/search?q=${encodeURIComponent(q)}`);
    }
  }

  function handleClear(): void {
    setDraft("");
    router.push("/app/notes/search");
  }

  const showTypeEmpty = !enabled;
  const showLoading = enabled && search.isPending;
  const showError = enabled && search.isError;
  const items = search.data?.notes ?? [];
  const showNoneEmpty = enabled && !search.isPending && !search.isError && items.length === 0;
  const showResults = enabled && !search.isPending && !search.isError && items.length > 0;

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-2xl">
        {t("end-user:end-user.notes-search.title.heading.text")}
      </h1>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="search"
          role="searchbox"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("end-user:end-user.notes-search.input.placeholder.text")}
          aria-label={t("end-user:end-user.notes-search.title.heading.text")}
          className="max-w-md"
        />
        <Button type="submit" size="sm" variant="outline">
          {t("end-user:end-user.notes-search.action.submit.label")}
        </Button>
        <Button type="button" onClick={handleClear} size="sm" variant="ghost">
          {t("end-user:end-user.notes-search.action.clear.label")}
        </Button>
      </form>
      <Separator />

      {showTypeEmpty ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.notes-search.title.heading.text")}</CardTitle>
            <CardDescription>{t("end-user:end-user.notes-search.empty.type.text")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : null}

      {showLoading ? (
        <div className="space-y-2" data-testid="notes-search-skeleton">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : null}

      {showError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("end-user:end-user.notes-search.error.title.text")}</AlertTitle>
          <AlertDescription>
            <Button onClick={() => search.refetch()} size="sm" variant="outline">
              {t("end-user:end-user.notes-search.error.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {showNoneEmpty ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user:end-user.notes-search.title.heading.text")}</CardTitle>
            <CardDescription>{t("end-user:end-user.notes-search.empty.none.text")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : null}

      {showResults ? (
        <ul className="space-y-2">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between rounded-md border border-border bg-panel p-3"
            >
              <a className="hover:underline" href={`/app/notes/${row.id}`}>
                {row.title ?? "(untitled)"}
              </a>
              <Badge
                variant="secondary"
                aria-label={t("end-user:end-user.notes-search.result.score.label")}
              >
                {row.score.toFixed(2)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
