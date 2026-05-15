// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U3 Verify-email client.
// Phase 18.1.1 / Plan 05 / Task 05-01 — AuthShell wrap + status badge
// (D-29..D-31). Mirrors the Phase 07 design oracle: status badge with
// per-state lucide icon, centered card content, AuthShell side panel.
//
// Mounted by app/(public)/verify-email/page.tsx after the RSC validates
// `?token=` against a tight regex (XSS defense — never render the raw
// token). On mount we POST the token to Better Auth via `authClient.
// verifyEmail` and surface loading/success/error states.
"use client";

import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./AuthShell";

type Status = "loading" | "success" | "error";

export interface VerifyEmailClientProps {
  /** Validated token from the RSC. Undefined when missing/invalid. */
  token: string | undefined;
}

/**
 * Per-state badge icon. The no-token error branch uses `Mail` to hint
 * the channel; in-flight requests show `Loader2` (spinning); success
 * shows `CheckCircle2`; verification failure shows `AlertCircle`.
 */
function StatusBadgeIcon({
  status,
  hasToken,
}: {
  status: Status;
  hasToken: boolean;
}): React.JSX.Element {
  if (status === "loading") return <Loader2 className="size-7 animate-spin" aria-hidden="true" />;
  if (status === "success") return <CheckCircle2 className="size-7" aria-hidden="true" />;
  if (!hasToken) return <Mail className="size-7" aria-hidden="true" />;
  return <AlertCircle className="size-7" aria-hidden="true" />;
}

function StatusBadge({
  status,
  hasToken,
}: {
  status: Status;
  hasToken: boolean;
}): React.JSX.Element {
  return (
    <div
      className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"
      data-testid="status-badge"
    >
      <StatusBadgeIcon status={status} hasToken={hasToken} />
    </div>
  );
}

export function VerifyEmailClient({ token }: VerifyEmailClientProps): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const [status, setStatus] = useState<Status>(token ? "loading" : "error");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const result = (await (
          authClient as unknown as {
            verifyEmail: (args: {
              query: { token: string };
            }) => Promise<{ data: unknown; error: { message?: string } | null }>;
          }
        ).verifyEmail({ query: { token } })) ?? { data: null, error: { message: "no response" } };
        if (cancelled) return;
        if (result.error) {
          setStatus("error");
          return;
        }
        setStatus("success");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const sideTitle = t("end-user.verify.shell.sideTitle.text");
  const sideQuote = t("end-user.verify.shell.sideQuote.text");
  const hasToken = Boolean(token);

  if (status === "loading") {
    return (
      <AuthShell sideTitle={sideTitle} sideQuote={sideQuote}>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user.verify.title.heading.text")}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <StatusBadge status="loading" hasToken={hasToken} />
            <p className="text-sm text-muted-foreground">
              {t("end-user.verify.loading.body.text")}
            </p>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  if (status === "success") {
    return (
      <AuthShell sideTitle={sideTitle} sideQuote={sideQuote}>
        <Card>
          <CardHeader>
            <CardTitle>{t("end-user.verify.success.title.text")}</CardTitle>
            <CardDescription>{t("end-user.verify.success.body.text")}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <StatusBadge status="success" hasToken={hasToken} />
          </CardContent>
          <CardFooter>
            <Button asChild>
              <Link href="/sign-in">{t("end-user.verify.success.cta.label")}</Link>
            </Button>
          </CardFooter>
        </Card>
      </AuthShell>
    );
  }

  // error (including no-token branch)
  return (
    <AuthShell sideTitle={sideTitle} sideQuote={sideQuote}>
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user.verify.title.heading.text")}</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <StatusBadge status="error" hasToken={hasToken} />
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("end-user.verify.error.title.text")}</AlertTitle>
            <AlertDescription>{t("end-user.verify.error.body.text")}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/sign-up">{t("end-user.verify.error.cta.label")}</Link>
          </Button>
        </CardFooter>
      </Card>
    </AuthShell>
  );
}
