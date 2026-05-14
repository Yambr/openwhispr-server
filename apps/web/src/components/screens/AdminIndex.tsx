// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-04 — /admin index AdminIndex component (closes TD-12.a).
//
// Conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:445-628
//   (ScreenConfig) — the canonical UICONF-04 oracle for the /admin index.
//
// Structural mirror (NOT pixel-identical):
//   - <h1>Configuration</h1>                        (screens-admin.jsx:451)
//   - lede paragraph                                 (screens-admin.jsx:452-455)
//   - read-only alert with role='status'             (screens-admin.jsx:462-476)
//   - 2-column card grid                              (screens-admin.jsx:478-582)
//     · card 1: STT config (endpoint label only)
//     · card 2: Note recording (endpoint label only)
//
// Phase 12 boundary (RESEARCH §15(h) / T-12.04-01):
//   - We mirror ONLY A3 (ScreenConfig). A1 ScreenAudit + A2 ScreenObservability
//     are explicitly OUT OF SCOPE for Plan 12-04 — they surface user PII
//     (actor emails, IPs, audit rows) and ship in Phase 13+ behind
//     RLS-gated admin queries.
//   - The cards intentionally render ONLY env-var endpoint LABELS. The
//     actual values (which legitimately route through admin/config) live
//     on /admin/config (Phase 07.1 ConfigClient) and are reached via the
//     sidebar; rendering them here would duplicate the surface and
//     widen the trust boundary unnecessarily.
//
// Phase 07.1 D-ADMIN-1: Sidebar + shell are provided by AdminLayout
// (apps/web/src/app/(admin)/layout.tsx). AdminIndex renders its own
// content only — no Shell/Sidebar wrap here.
//
// Client Component — `useTranslation` from react-i18next consumes the
// I18nProvider context that AdminLayout boots. There is no client-side
// state or network call beyond that; the component is effectively static.
// Coverage policy: page.tsx is excluded from the coverage floor per
// vitest.config; AdminIndex itself IS covered.
"use client";

import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AdminIndex(): React.JSX.Element {
  const { t } = useTranslation(["admin"]);

  return (
    <div className="flex flex-col gap-6">
      {/* page-head */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.index.title.heading.text")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("admin.index.lede.body.text")}</p>
      </header>

      {/* read-only alert — role='status' (informational, NOT destructive) */}
      <Alert role="status">
        <AlertTitle>{t("admin.index.readonly.title.text")}</AlertTitle>
        <AlertDescription>{t("admin.index.readonly.body.text")}</AlertDescription>
      </Alert>

      {/* 2-column card grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.index.card-stt.title.text")}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {t("admin.index.card-stt.endpoint.text")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.index.card-note.title.text")}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {t("admin.index.card-note.endpoint.text")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
