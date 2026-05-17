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
// Client Component. RHF + zod + Better Auth signIn.email + OIDC row.
// D-S1: no custom fetch. Every call goes through authClient.* directly.
// Open-redirect mitigation: post-signin redirect is HARDCODED to "/app".
"use client";

import { Eye, EyeOff } from "lucide-react";
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

type SignInState =
  | { kind: "idle" }
  | { kind: "error-generic" }
  | { kind: "error-unverified"; resend: "idle" | "sending" | "sent" };

export function SignInForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<SignInState>({ kind: "idle" });
  const [showPassword, setShowPassword] = useState(false);

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

  const togglePasswordLabel = showPassword
    ? t("end-user.signin.action.togglePassword.hide.label")
    : t("end-user.signin.action.togglePassword.show.label");

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
                    The eye-toggle button is rendered as an absolute sibling
                    of FormControl (NOT inside it) because FormControl is a
                    Radix Slot that forwards `id` + `aria-describedby` to a
                    SINGLE direct child. Wrapping the Input in a <div>
                    would cause getByLabelText to bind the FormLabel to the
                    wrapper div instead of the input (D-23 regression).
                  */}
                  <div className="relative">
                    <FormControl>
                      <Input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        disabled={submitting}
                        {...field}
                      />
                    </FormControl>
                    {/*
                      D-23 eye toggle. lucide-react Eye/EyeOff already in
                      deps (D-44). Toggle label exposed via visually-hidden
                      <span> rather than aria-label so the toggle button's
                      accessible name does not collide with the password
                      input's FormLabel.
                    */}
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute top-1/2 right-2 grid -translate-y-1/2 size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="sr-only">{togglePasswordLabel}</span>
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
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
              D-UX2 sentinel: forgot-password remains muted static text.
              Source of truth: D-UX2 (Phase 18.1.1) — anchor lands with Phase 19.1 reset-mail.
            */}
            <p className="text-muted-foreground text-sm" aria-disabled="true">
              {t("end-user.signin.action.forgotPassword.link.disabled")}
            </p>
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
