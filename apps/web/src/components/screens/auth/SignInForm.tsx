// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U1 Sign-in form.
// Phase 12 / Plan 12-04 — UICONF-07 resend-verification CTA on 403.
// Phase 18.1.1 / Plan 04 / Task 04 — D-16..D-23 visual-oracle alignment:
//   - D-16: wrap in <AuthShell> (drop <Card> chrome).
//   - D-17: render <OidcButtons> BEFORE separator BEFORE form.
//   - D-19: "Or with email" separator with text-in-rule label.
//   - D-21: "Remember this device" RHF checkbox; pass through to Better
//           Auth as `rememberMe`.
//   - D-23: password show/hide eye toggle (Eye/EyeOff from lucide-react,
//           already in deps — D-44 no new top-level deps).
//   - D-UX2 sentinel: forgot-password remains muted static text. The
//     anchor lands with Phase 19.1 reset-mail.
//
// Phase 55-01-a — D-UX2 REVERSED with user authorisation.
//   Source of authority: Phase 55 UC coverage audit (RESEARCH.md
//   §"Top 10 gaps" #1) PLUS explicit user sign-off recorded on
//   2026-05-19 in the executor prompt for Plan 55-01-a. The audit
//   found this was the single BLOCKED UC in the entire surface —
//   every user who forgot their password was stuck because the
//   /forgot-password Next.js route never shipped after Phase 19.1
//   put the API wire in place. This reversal flips lines ~247-253
//   from a muted <p aria-disabled="true"> sentinel into a live
//   <Link href="/forgot-password"> CTA, closing
//   BUG-54-PRD-RESET-UI-MISSING. The reversal is NOT a unilateral
//   executor decision — the audit + user are the chain of authority.
//
// Client Component. RHF + zod + Better Auth signIn.email + OIDC row.
// D-S1: no custom fetch. Every call goes through authClient.* directly.
// Open-redirect mitigation: post-signin redirect is HARDCODED to "/app".
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { signInSchema } from "@/lib/schemas/auth";
import { AuthShell } from "./AuthShell";
import { OidcButtons } from "./OidcButtons";
import { PasswordInputWithToggle } from "./PasswordInputWithToggle";

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
    defaultValues: { email: "", password: "", rememberDevice: false },
    mode: "onSubmit",
  });

  async function onSubmit(values: {
    email: string;
    password: string;
    rememberDevice: boolean;
  }): Promise<void> {
    setSubmitting(true);
    setState({ kind: "idle" });
    try {
      // Plan 51-11b — typed access via ExtendedAuthClient
      // (eliminates the local double-cast at the call site).
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
        // D-21: pass-through to Better Auth.
        rememberMe: values.rememberDevice,
        // Open-redirect mitigation: hardcoded — never read ?next= from URL.
        callbackURL: "/app",
      });
      if (result.error) {
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
      // Plan 51-11b — typed access via ExtendedAuthClient.
      await authClient.sendVerificationEmail({ email: form.getValues("email") });
      setState({ kind: "error-unverified", resend: "sent" });
    } catch {
      setState({ kind: "error-generic" });
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">
            {t("end-user.signin.title.heading.text")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("end-user.signin.subtitle.body.text")}</p>
        </header>
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
            <AlertTitle>{t("end-user.signin.error-unverified.title.text")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                {state.resend === "sent"
                  ? t("end-user.signin.error-unverified.sent.text")
                  : t("end-user.signin.error-unverified.body.text")}
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
        {/* D-17 order: OIDC row FIRST, then text-in-rule separator, then form. */}
        <OidcButtons namespace="signin" />
        {/* D-19 text-in-rule separator. */}
        <div className="relative my-1 flex items-center" aria-hidden={false}>
          <span className="h-px flex-1 bg-border" />
          <span className="px-3 text-muted-foreground text-xs uppercase tracking-wider">
            {t("end-user.signin.separator.email.text")}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
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
                  {/*
                    Phase 55-02-b — inline eye-toggle block extracted to
                    `PasswordInputWithToggle.tsx`. The component renders the
                    same <div className="relative"> wrapper + <FormControl>
                    + absolutely-positioned <button> as the original D-23
                    inline pattern (DOM-equivalent → no visual-baseline
                    drift). FormControl lives INSIDE the component so the
                    Radix Slot forwards id/aria-describedby to <Input>, not
                    the wrapper div (see PasswordInputWithToggle.tsx header).
                  */}
                  <PasswordInputWithToggle
                    autoComplete="current-password"
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
              name="rememberDevice"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value === true}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      disabled={submitting}
                      aria-label={t("end-user.signin.action.rememberDevice.label")}
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal text-sm">
                    {t("end-user.signin.action.rememberDevice.label")}
                  </FormLabel>
                </FormItem>
              )}
            />
            {/*
              Phase 55-01-a: user-authorized reversal of D-UX2 (Phase 18.1.1).
              The previous muted "Forgot password? — coming soon" sentinel
              is replaced with a live link to the /forgot-password route
              shipped in this same plan. Chain of authority: Phase 55 UC
              coverage audit + explicit user sign-off (see file header).
              Closes BUG-54-PRD-RESET-UI-MISSING.
            */}
            <Link
              href="/forgot-password"
              className="text-sm text-primary underline underline-offset-4 hover:opacity-80"
            >
              {t("end-user.signin.action.forgotPassword.link.label")}
            </Link>
            <Button type="submit" disabled={submitting}>
              {t("end-user.signin.form.submit.label")}
            </Button>
          </form>
        </Form>
        <p className="text-center text-sm">
          <Link
            href="/sign-up"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            {t("end-user.signin.action.signup-link.label")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
