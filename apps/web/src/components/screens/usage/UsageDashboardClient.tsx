// Phase 07.1 / Plan 08 — U4 Usage dashboard (Client Component).
//
// KPI-only (D-STACK-6 + D-API6 + A2/A3 REFUTED): four cards from the live
// GET /api/usage response shape (apps/api/src/routes/usage.ts:67-71):
//   { wordsUsed, wordsRemaining, plan, limitReached }.
//
// No Recharts, no dailySeries chart, no providerBreakdown panel, no
// "Latest activity" feed — every underlying data field is intentionally
// absent from the API.
//
// Hydration: the RSC parent (app/(auth)/app/page.tsx) prefetches
// queryKeys.usage() with the same queryFn, so the first paint reads from
// the dehydrated cache and never round-trips.
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";

export interface UsageResponse {
  wordsUsed: number;
  wordsRemaining: number;
  plan: string;
  limitReached: boolean;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en");

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return NUMBER_FORMAT.format(n);
}

export function UsageDashboardClient(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const queryClient = useQueryClient();

  const usage = useQuery({
    queryKey: queryKeys.usage(),
    queryFn: () => clientFetch<UsageResponse>("/api/usage"),
  });

  if (usage.isPending) {
    return (
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl">
              {t("end-user:end-user.usage.title.heading.text")}
            </h1>
            <p className="text-text-muted text-sm">
              {t("end-user:end-user.usage.subtitle.body.text")}
            </p>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
            <Card key={i} data-testid="usage-skeleton">
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (usage.isError) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.usage.title.heading.text")}
        </h1>
        <Alert variant="destructive">
          <AlertTitle>{t("end-user:end-user.usage.error.title.text")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{t("end-user:end-user.usage.error.body.text")}</span>
            <Button onClick={() => usage.refetch()} size="sm" variant="outline">
              {t("end-user:end-user.usage.error.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = usage.data as UsageResponse;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl">
            {t("end-user:end-user.usage.title.heading.text")}
          </h1>
          <p className="text-text-muted text-sm">
            {t("end-user:end-user.usage.subtitle.body.text")}
          </p>
        </div>
        <Button
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.usage() })}
          size="sm"
          variant="outline"
        >
          {t("end-user:end-user.usage.action.refresh.label")}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card data-testid="kpi-words-used">
          <CardHeader>
            <CardTitle>{t("end-user:end-user.usage.kpi-words-used.title.label")}</CardTitle>
            <CardDescription>
              {t("end-user:end-user.usage.kpi-words-used.body.text")}
            </CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-3xl">
            {formatNumber(data.wordsUsed)}
          </CardContent>
        </Card>

        <Card data-testid="kpi-words-remaining">
          <CardHeader>
            <CardTitle>{t("end-user:end-user.usage.kpi-words-remaining.title.label")}</CardTitle>
            <CardDescription>
              {t("end-user:end-user.usage.kpi-words-remaining.body.text")}
            </CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-3xl">
            {formatNumber(data.wordsRemaining)}
          </CardContent>
        </Card>

        <Card data-testid="kpi-plan">
          <CardHeader>
            <CardTitle>{t("end-user:end-user.usage.kpi-plan.title.label")}</CardTitle>
            <CardDescription>{t("end-user:end-user.usage.kpi-plan.body.text")}</CardDescription>
          </CardHeader>
          <CardContent className="font-semibold text-2xl">{data.plan}</CardContent>
        </Card>

        <Card data-testid="kpi-limit-reached">
          <CardHeader>
            <CardTitle>{t("end-user:end-user.usage.kpi-limit-reached.title.label")}</CardTitle>
            <CardDescription>
              {t("end-user:end-user.usage.kpi-limit-reached.body.text")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={data.limitReached ? "destructive" : "secondary"}>
              {data.limitReached ? "Yes" : "No"}
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
