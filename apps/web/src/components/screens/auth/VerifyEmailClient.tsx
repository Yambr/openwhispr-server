// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U3 Verify-email client.
//
// Mounted by app/(public)/verify-email/page.tsx after the RSC validates
// `?token=` against a tight regex (XSS defense — never render the raw
// token). On mount we POST the token to Better Auth via `authClient.
// verifyEmail` and surface loading/success/error states.
"use client";

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

type Status = "loading" | "success" | "error";

export interface VerifyEmailClientProps {
  /** Validated token from the RSC. Undefined when missing/invalid. */
  token: string | undefined;
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

  if (status === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("end-user.verify.title.heading.text")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("end-user.verify.loading.body.text")}</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("end-user.verify.success.title.text")}</CardTitle>
          <CardDescription>{t("end-user.verify.success.body.text")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <Link href="/sign-in">{t("end-user.verify.success.cta.label")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // error (including no-token branch)
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("end-user.verify.title.heading.text")}</CardTitle>
      </CardHeader>
      <CardContent>
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
  );
}
