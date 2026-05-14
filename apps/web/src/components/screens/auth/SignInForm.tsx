// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — U1 Sign-in form.
// Phase 12 / Plan 12-04 — UICONF-07 resend-verification CTA on 403.
//
// Client Component. RHF + zod + Better Auth signIn.email + OIDC row.
// D-UX2: Forgot-password is rendered as muted static text (no anchor / no
// button) — password reset is on the Phase 7.x backlog.
// D-S1: no custom fetch. Every call goes through authClient.* directly.
// Open-redirect mitigation: post-signin redirect is HARDCODED to "/app".
//
// UICONF-07 (Plan 12-04, RESEARCH §13):
//   On a sign-in `EMAIL_NOT_VERIFIED` error from Better Auth, surface a
//   dedicated alert + a "Resend verification email" button that calls
//   `authClient.sendVerificationEmail({ email })`. On success, the alert
//   variant flips and shows the "sent" copy. No new endpoint is
//   introduced — we reuse the Better Auth verification-send route the
//   VerifyEmail flow already exercises.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { useZodForm } from "@/lib/form-utils";
import { signInSchema } from "@/lib/schemas/auth";
import { OidcButtons } from "./OidcButtons";

type SignInState =
  | { kind: "idle" }
  | { kind: "error-generic" }
  | { kind: "error-unverified"; resend: "idle" | "sending" | "sent" };

export function SignInForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<SignInState>({ kind: "idle" });

  const form = useZodForm({
    schema: signInSchema,
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  async function onSubmit(values: { email: string; password: string }): Promise<void> {
    setSubmitting(true);
    setState({ kind: "idle" });
    try {
      const result = (await authClient.signIn.email({
        email: values.email,
        password: values.password,
        // Open-redirect mitigation: hardcoded — never read ?next= from URL.
        callbackURL: "/app",
      })) as { data: unknown; error: { code?: string; message?: string } | null };
      if (result.error) {
        // UICONF-07: dedicated branch for the verification gate; everything
        // else falls back to the generic sign-in failure alert.
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setState({ kind: "error-unverified", resend: "idle" });
        } else {
          setState({ kind: "error-generic" });
        }
        return;
      }
      router.push("/app");
    } catch {
      setState({ kind: "error-generic" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onResendVerification(): Promise<void> {
    if (state.kind !== "error-unverified") return;
    setState({ kind: "error-unverified", resend: "sending" });
    try {
      // Reuse Better Auth's existing resend endpoint — no new route added.
      await (
        authClient as unknown as {
          sendVerificationEmail: (args: {
            email: string;
          }) => Promise<{ data: unknown; error: unknown }>;
        }
      ).sendVerificationEmail({ email: form.getValues("email") });
      setState({ kind: "error-unverified", resend: "sent" });
    } catch {
      // Surface as the generic branch — operators can correlate via api logs.
      setState({ kind: "error-generic" });
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("end-user.signin.title.heading.text")}</CardTitle>
        <CardDescription>{t("end-user.signin.subtitle.body.text")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.kind === "error-generic" ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("end-user.signin.error.title.text")}</AlertTitle>
            <AlertDescription>{t("end-user.signin.error.body.text")}</AlertDescription>
          </Alert>
        ) : null}
        {state.kind === "error-unverified" ? (
          <Alert
            variant={state.resend === "sent" ? "default" : "destructive"}
            role="alert"
            data-testid="signin-unverified-alert"
          >
            <AlertTitle>{t("end-user.signin.error.unverified.title.text")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                {state.resend === "sent"
                  ? t("end-user.signin.error.unverified.sent.text")
                  : t("end-user.signin.error.unverified.body.text")}
              </span>
              {state.resend !== "sent" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={state.resend === "sending"}
                  onClick={onResendVerification}
                >
                  {t("end-user.signin.action.resendVerification.label")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit as never)}
            className="flex flex-col gap-3"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.signin.form.email.label")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" disabled={submitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.signin.form.password.label")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      disabled={submitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-muted-foreground text-sm" aria-disabled="true">
              {t("end-user.signin.action.forgotPassword.link.disabled")}
            </p>
            <Button type="submit" disabled={submitting}>
              {t("end-user.signin.form.submit.label")}
            </Button>
          </form>
        </Form>
        <Separator />
        <OidcButtons namespace="signin" />
      </CardContent>
      <CardFooter>
        <Link href="/sign-up" className="text-sm underline underline-offset-4">
          {t("end-user.signin.action.signup-link.label")}
        </Link>
      </CardFooter>
    </Card>
  );
}
