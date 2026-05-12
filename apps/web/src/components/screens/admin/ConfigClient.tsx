// Phase 07.1 / Plan 12 — A3 Config view Client Component (D-API4, D-S1, D-ADMIN-1).
//
// Read-only operator view of STT pipeline + note recording config.
// Two parallel queries against existing endpoints:
//   - GET /api/stt-config           (apps/api/src/routes/stt-config.ts)
//   - GET /api/note-recording-config (apps/api/src/routes/note-recording-config.ts)
//
// D-API4: NO "Effective env" block — exposing env-var names (even redacted) is a
//          security hot zone with no backing endpoint. Operator docs explain
//          override mechanics via the "Docs: how to override" external link.
// D-S1:   No new API endpoints; we only read existing routes.
// D-ADMIN-1: NO application-layer role check; Traefik basic-auth gates the surface.
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query-keys";

interface SttConfig {
  defaultModel: string;
  defaultLanguage: string;
  availableProviders: string[];
}

interface NoteRecordingConfig {
  maxDurationSeconds: number;
  sampleRateHz: number;
  allowedFormats: string[];
  diarizationEnabled: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const DOCS_HREF = "/docs/litellm-target-spec.md";

function SkeletonTable(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" data-testid="config-skeleton">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  );
}

export function ConfigClient(): React.JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const qc = useQueryClient();
  const stt = useQuery<SttConfig, Error>({
    queryKey: queryKeys.sttConfig(),
    queryFn: () => fetchJson<SttConfig>("/api/stt-config"),
  });
  const note = useQuery<NoteRecordingConfig, Error>({
    queryKey: queryKeys.noteRecordingConfig(),
    queryFn: () => fetchJson<NoteRecordingConfig>("/api/note-recording-config"),
  });

  const onRefresh = (): void => {
    void qc.invalidateQueries({ queryKey: queryKeys.sttConfig() });
    void qc.invalidateQueries({ queryKey: queryKeys.noteRecordingConfig() });
  };

  const onRetry = (): void => {
    void stt.refetch();
    void note.refetch();
  };

  const isLoading = stt.isPending || note.isPending;
  const isErrored = stt.isError || note.isError;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-[22px] tracking-tight">
            {t("admin.config.title.heading.text")}
          </h1>
          <p className="text-sm text-text-muted">{t("admin.config.subtitle.body.text")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href={DOCS_HREF} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden className="mr-2 h-4 w-4" />
              {t("admin.config.link.override-docs.label")}
            </a>
          </Button>
          <Button onClick={onRefresh} variant="default">
            <RefreshCwIcon aria-hidden className="mr-2 h-4 w-4" />
            {t("admin.config.action.refresh.label")}
          </Button>
        </div>
      </header>

      <Alert>
        <AlertDescription>{t("admin.config.alert-readonly.body.label")}</AlertDescription>
      </Alert>

      {isErrored ? (
        <Alert variant="destructive">
          <AlertTitle>{t("admin.config.error-fetch-failed.title.label")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{t("admin.config.error-fetch-failed.body.label")}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t("admin.config.error-fetch-failed.retry.label")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.config.stt.title.label")}</CardTitle>
            <CardDescription>{t("admin.config.stt.endpoint.label")}</CardDescription>
          </CardHeader>
          <CardContent>
            {stt.isPending ? (
              <SkeletonTable />
            ) : stt.isError ? (
              <p className="text-sm text-text-muted">
                {t("admin.config.error-fetch-failed.body.label")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">{/* labels */}</TableHead>
                    <TableHead>{/* values */}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.stt.row-default-model.label")}
                    </TableCell>
                    <TableCell>{stt.data.defaultModel}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.stt.row-default-language.label")}
                    </TableCell>
                    <TableCell>{stt.data.defaultLanguage}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.stt.row-providers.label")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {stt.data.availableProviders.map((p) => (
                          <Badge key={p} variant="secondary">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.config.note.title.label")}</CardTitle>
            <CardDescription>{t("admin.config.note.endpoint.label")}</CardDescription>
          </CardHeader>
          <CardContent>
            {note.isPending ? (
              <SkeletonTable />
            ) : note.isError ? (
              <p className="text-sm text-text-muted">
                {t("admin.config.error-fetch-failed.body.label")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">{/* labels */}</TableHead>
                    <TableHead>{/* values */}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.note.row-max-duration.label")}
                    </TableCell>
                    <TableCell>{note.data.maxDurationSeconds}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.note.row-sample-rate.label")}
                    </TableCell>
                    <TableCell>{note.data.sampleRateHz}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.note.row-allowed-formats.label")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {note.data.allowedFormats.map((f) => (
                          <Badge key={f} variant="secondary">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      {t("admin.config.note.row-diarization.label")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        data-testid="config-note-diarization"
                        variant={note.data.diarizationEnabled ? "default" : "outline"}
                      >
                        {note.data.diarizationEnabled ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* D-API4: NO "Effective env" block — intentional omission. */}
      {/* isLoading is consumed implicitly via per-card pending branches above. */}
      <Separator className={isLoading ? "opacity-50" : undefined} />
    </div>
  );
}
