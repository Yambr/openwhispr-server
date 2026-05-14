// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A2 Observability hub Client Component (D-ADMIN-1, D-S1).
//
// Renders a static grid of deep-links into the operator's external
// Grafana / Tempo / Mimir / Loki stack. ZERO API calls on this server —
// the screen is a navigation surface only. The Grafana base URL is read
// from `NEXT_PUBLIC_GRAFANA_BASE_URL`, which Next.js inlines at build time;
// operators must rebuild the web container after changing the env value.
//
// Routing:
//   - Each dashboard card anchors to `${grafana}/d/<slug>` per the canonical
//     Grafana dashboard slug convention. Slugs match Phase 6 Plan 11
//     dashboard ids and are stable for the lifetime of v1.
//   - Quick-links target each LGTM component's own UI when the matching
//     NEXT_PUBLIC_*_BASE_URL is set; otherwise they fall back to the
//     Grafana root (so the operator still lands somewhere useful).
//
// Error state: when `env.grafana` is empty/undefined the screen renders a
// destructive Alert telling the operator to set the env var and redeploy.
"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export interface ObservabilityEnv {
  grafana?: string | undefined;
  tempo?: string | undefined;
  mimir?: string | undefined;
  loki?: string | undefined;
}

interface DashboardCard {
  slug: string;
  titleKey: string;
  bodyKey?: string;
}

const DASHBOARDS: DashboardCard[] = [
  {
    slug: "api-latency",
    titleKey: "admin.observability.card-api-latency.title.label",
    bodyKey: "admin.observability.card-api-latency.body.label",
  },
  {
    slug: "worker-queue",
    titleKey: "admin.observability.card-worker-queue.title.label",
    bodyKey: "admin.observability.card-worker-queue.body.label",
  },
  {
    slug: "postgres",
    titleKey: "admin.observability.card-postgres.title.label",
  },
  {
    slug: "litellm",
    titleKey: "admin.observability.card-litellm.title.label",
  },
  {
    slug: "security",
    titleKey: "admin.observability.card-security.title.label",
  },
  {
    slug: "system",
    titleKey: "admin.observability.card-system.title.label",
  },
];

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function ObservabilityClient({ env }: { env: ObservabilityEnv }): React.JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const grafana = env.grafana ? trimSlash(env.grafana) : "";

  if (!grafana) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="font-semibold text-[22px] tracking-tight">
            {t("admin.observability.title.heading.text")}
          </h1>
          <p className="text-sm text-text-muted">{t("admin.observability.subtitle.body.text")}</p>
        </header>
        <Alert variant="destructive">
          <AlertTitle>{t("admin.observability.error-env-missing.title.label")}</AlertTitle>
          <AlertDescription>
            {t("admin.observability.error-env-missing.body.label")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const tempo = env.tempo ? trimSlash(env.tempo) : grafana;
  const mimir = env.mimir ? trimSlash(env.mimir) : grafana;
  const loki = env.loki ? trimSlash(env.loki) : grafana;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-[22px] tracking-tight">
            {t("admin.observability.title.heading.text")}
          </h1>
          <p className="text-sm text-text-muted">{t("admin.observability.subtitle.body.text")}</p>
        </div>
        <Button asChild variant="default">
          <a href={grafana} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden className="mr-2 h-4 w-4" />
            {t("admin.observability.action.open-grafana.label")}
          </a>
        </Button>
      </header>

      <section
        aria-label={t("admin.observability.title.heading.text") as string}
        className="grid gap-4 lg:grid-cols-2"
      >
        {DASHBOARDS.map((d) => {
          const href = `${grafana}/d/${d.slug}`;
          return (
            <a
              key={d.slug}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-observability-card
              className="block rounded-md focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Card className="h-full transition-colors hover:bg-panel-2">
                <CardHeader>
                  <CardTitle>{t(d.titleKey)}</CardTitle>
                  {d.bodyKey ? <CardDescription>{t(d.bodyKey)}</CardDescription> : null}
                </CardHeader>
              </Card>
            </a>
          );
        })}
      </section>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.observability.quicklinks.title.label")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            <li>
              <a
                href={loki}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("admin.observability.quicklinks.loki.label")}
              </a>
            </li>
            <li>
              <a
                href={mimir}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("admin.observability.quicklinks.mimir.label")}
              </a>
            </li>
            <li>
              <a
                href={tempo}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("admin.observability.quicklinks.tempo.label")}
              </a>
            </li>
            <li>
              <a
                href={grafana}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("admin.observability.quicklinks.alertmanager.label")}
              </a>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
