// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a / Task 2 GREEN — /forgot-password client form.
//
// Closes BUG-54-PRD-RESET-UI-MISSING: surfaces the previously-missing
// web UI for Better Auth's request-password-reset endpoint. The wire
// surface (POST /api/auth/request-password-reset) has been GREEN since
// Phase 19.1 — see tests/e2e-cjm/steps/password-reset.steps.ts:65-71.
//
// Anti-enumeration invariant: the success panel renders for ALL
// outcomes (Better Auth success, Better Auth error, network failure).
// The server already anti-enumerates; the client mirrors that posture
// so failure modes do not leak "address registered" vs "address not
// registered" via copy or rendering branch.
//
// Better Auth 1.6.9 client surface: `authClient.forgetPassword({ email })`
// is exposed via the runtime Proxy. The wire path is identical to the
// CJM step's raw fetch (`/api/auth/request-password-reset`). If the
// typed React-client surface ever drops `forgetPassword`, fall back to
// a raw `fetch('/api/auth/request-password-reset', …)` POST — Better
// Auth gates CSRF by Origin and the web origin is trusted.
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useZodForm } from "@/lib/form-utils";
import { AuthShell } from "./AuthShell";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Better Auth 1.6.9 exposes forgetPassword via the runtime Proxy but
// the inferred typed surface omits it. Match the ExtendedAuthClient
// pattern from auth-client.ts: declare a narrow typed surface so the
// cast at the call site is precise (LOCKER-02 — no wildcard escape).
type ForgetPassword = (args: {
  email: string;
  redirectTo?: string;
}) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
type AuthClientWithForget = typeof authClient & { forgetPassword: ForgetPassword };

export function ForgotPasswordForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useZodForm({
    schema: forgotPasswordSchema,
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  async function onSubmit(values: { email: string }): Promise<void> {
    setSubmitting(true);
    try {
      // Anti-enumeration: we deliberately ignore success/error here.
      // The server returns 200 in both cases (registered vs not); a
      // thrown promise (network failure) is also swallowed so the
      // success panel renders unconditionally.
      const extended = authClient as AuthClientWithForget;
      await extended.forgetPassword({ email: values.email });
    } catch {
      // Swallow — anti-enumeration.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl tracking-tight">
              {t("end-user.forgot-password.success.title.text")}
            </h1>
          </header>
          <Alert role="status">
            <AlertTitle>{t("end-user.forgot-password.success.title.text")}</AlertTitle>
            <AlertDescription>{t("end-user.forgot-password.success.body.text")}</AlertDescription>
          </Alert>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">
            {t("end-user.forgot-password.title.heading.text")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("end-user.forgot-password.subtitle.body.text")}
          </p>
        </header>
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
                  <FormLabel>{t("end-user.forgot-password.form.email.label")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" disabled={submitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {t("end-user.forgot-password.form.submit.label")}
            </Button>
          </form>
        </Form>
      </div>
    </AuthShell>
  );
}
