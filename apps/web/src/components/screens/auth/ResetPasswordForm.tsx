// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a / Task 2 GREEN — /reset-password client form.
//
// Closes BUG-54-PRD-RESET-UI-MISSING (web-UI half). The wire surface
// `POST /api/auth/reset-password` has been GREEN since Phase 19.1 —
// see tests/e2e-cjm/steps/password-reset.steps.ts:114-127.
//
// Token handling: the RSC parent reads `searchParams.token` and forwards
// it as a string-or-null prop. When the token is missing/empty the form
// is replaced by an Alert + back-link to /forgot-password so the user
// can request a fresh email rather than guessing at the URL shape.
//
// Better Auth 1.6.9 client surface: `authClient.resetPassword({ newPassword, token })`
// is exposed via the runtime Proxy. The wire path is identical to the
// CJM step's raw POST. Same fallback rule as ForgotPasswordForm if the
// typed React-client surface drops the method in a future release.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useZodForm } from "@/lib/form-utils";
import { AuthShell } from "./AuthShell";
import { PasswordInputWithToggle } from "./PasswordInputWithToggle";

// Better Auth 1.6.9 canonical wire path. Verified by the CJM step at
// tests/e2e-cjm/steps/password-reset.steps.ts:118. We POST raw JSON
// rather than calling authClient.resetPassword to avoid binding to a
// typed helper whose method name has shifted across Better Auth
// releases. CSRF is gated by Origin; same-origin browser fetches are
// trusted.
const RESET_PASSWORD_PATH = "/api/auth/reset-password";

export interface ResetPasswordFormProps {
  /** Reset token extracted from `?token=…` by the RSC parent. */
  token: string | null;
}

// Schema mirrors signUpSchema (min 8, max 200) + cross-field equality.
function makeResetSchema(mismatchMessage: string) {
  return z
    .object({
      newPassword: z.string().min(8).max(200),
      confirmPassword: z.string().min(8).max(200),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ["confirmPassword"],
      message: mismatchMessage,
    });
}

export function ResetPasswordForm(props: ResetPasswordFormProps): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<"generic" | null>(null);

  const schema = makeResetSchema(t("end-user.reset-password.validation.mismatch.text"));
  const form = useZodForm({
    schema,
    defaultValues: { newPassword: "", confirmPassword: "" },
    mode: "onSubmit",
  });

  // Token-missing branch — render BEFORE the form scaffolding.
  if (props.token === null || props.token.length === 0) {
    return (
      <AuthShell>
        <div className="flex flex-col gap-4">
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("end-user.reset-password.error-missing-token.title.text")}</AlertTitle>
            <AlertDescription>
              {t("end-user.reset-password.error-missing-token.body.text")}
            </AlertDescription>
          </Alert>
          <p className="text-center text-sm">
            <Link
              href="/forgot-password"
              className="text-primary underline underline-offset-4 hover:opacity-80"
            >
              {t("end-user.reset-password.action.back-to-forgot.label")}
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const token = props.token;

  async function onSubmit(values: { newPassword: string; confirmPassword: string }): Promise<void> {
    setSubmitting(true);
    setErrorKind(null);
    try {
      const res = await fetch(RESET_PASSWORD_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: values.newPassword, token }),
      });
      if (!res.ok) {
        setErrorKind("generic");
        return;
      }
      router.push("/sign-in");
    } catch {
      setErrorKind("generic");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">
            {t("end-user.reset-password.title.heading.text")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("end-user.reset-password.subtitle.body.text")}
          </p>
        </header>
        {errorKind ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("end-user.reset-password.error-generic.title.text")}</AlertTitle>
            <AlertDescription>
              {t("end-user.reset-password.error-generic.body.text")}
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
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.reset-password.form.new-password.label")}</FormLabel>
                  {/*
                    Phase 55-02-b — eye-toggle via shared building block.
                    See PasswordInputWithToggle.tsx header for the FormControl
                    embedding rationale (component owns FormControl internally
                    so Radix Slot forwards id/aria-describedby to <Input>, not
                    the wrapper div).
                  */}
                  <PasswordInputWithToggle
                    autoComplete="new-password"
                    disabled={submitting}
                    togglePasswordShowLabel={t("end-user.common.action.togglePassword.show.label")}
                    togglePasswordHideLabel={t("end-user.common.action.togglePassword.hide.label")}
                    {...field}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.reset-password.form.confirm-password.label")}</FormLabel>
                  {/*
                    Phase 55-02-b — eye-toggle via shared building block.
                    Each PasswordInputWithToggle instance keeps its OWN
                    internal showPassword useState, so the two fields toggle
                    independently (verified by Plan 55-02-b spec step 3).
                  */}
                  <PasswordInputWithToggle
                    autoComplete="new-password"
                    disabled={submitting}
                    togglePasswordShowLabel={t("end-user.common.action.togglePassword.show.label")}
                    togglePasswordHideLabel={t("end-user.common.action.togglePassword.hide.label")}
                    {...field}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {t("end-user.reset-password.form.submit.label")}
            </Button>
          </form>
        </Form>
      </div>
    </AuthShell>
  );
}
