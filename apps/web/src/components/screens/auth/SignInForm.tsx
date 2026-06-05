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
//
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-01.
//   Open-redirect mitigation: the post-sign-in redirect honours the
//   middleware-set `?from=` deep-link param, but ONLY through the strict
//   same-origin allowlist in `lib/safe-from-param.ts` (must start with
//   `/app/` or equal `/app`; no `://`, no `\`, no leading `//`). Any
//   value failing the allowlist falls back to `/app`. This preserves the
//   middleware's deep-link recovery flow without re-opening the
//   open-redirect surface the previous hardcode guarded against.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { safeFromParam } from "@/lib/safe-from-param";
import { signInSchema } from "@/lib/schemas/auth";
import { AuthShell } from "./AuthShell";
import { OidcButtons } from "./OidcButtons";
import { PasswordInputWithToggle } from "./PasswordInputWithToggle";
import { useAuthProviders } from "./useAuthProviders";

type SignInState =
  | { kind: "idle" }
  | { kind: "error-generic" }
  | { kind: "error-unverified"; resend: "idle" | "sending" | "sent" };

export function SignInForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Upstream #9 (web half) — gate the local-login affordances on the server's
  // localLogin posture. A SECOND useAuthProviders instance (OidcButtons calls
  // it internally too) → 2 GET /api/auth/providers per screen; the endpoint is
  // public + ETag-cached + credentials:'omit', so the cost is negligible and we
  // do NOT lift state into props (that would break OidcButtons' standalone
  // contract + conformance). `localLoginEnabled` is default-safe: absent flag
  // (old server) / loading / network failure ⇒ true (never hide the only form
  // on uncertainty); only an explicit {enabled:false} hides it.
  const { localLoginEnabled } = useAuthProviders();
  // HI-01 — validated post-sign-in destination from the `?from=` param.
  const destination = safeFromParam(searchParams.get("from"));
  // F8 — verify-email-complete 302s back here with `?verified=1` after a
  // web-flow sign-up. Show a success banner so the user understands their
  // email is now confirmed and they can sign in normally. The Better Auth
  // session cookie is already in the browser jar from the verify-email
  // handler one hop ago, so the user could in principle be auto-redirected
  // to `/app`; we deliberately keep them on /sign-in so the password-entry
  // confirms intent (defense against shared-device credential phishing).
  const verifiedJustNow = searchParams.get("verified") === "1";
  // SEED-F8-UX — verify-email-complete 302s back here with `?error=<code>`
  // when the verification link expired / was invalid / etc. Replaces the
  // raw JSON envelope the user used to see in their address bar with an
  // actionable banner. `?error=link-expired` is the default; Better Auth's
  // upstream `?error=` query is passed through verbatim (regex-validated
  // on the server to `[a-zA-Z0-9_-]+`).
  const verifyError = searchParams.get("error");
  const verifyErrorCode = verifyError && /^[a-zA-Z0-9_-]+$/.test(verifyError) ? verifyError : null;
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
        // HI-01: allowlist-validated `?from=` deep-link destination.
        callbackURL: destination,
      });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setState({ kind: "error-unverified", resend: "idle" });
        } else {
          setState({ kind: "error-generic" });
        }
        return;
      }
      router.push(destination);
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
        {verifiedJustNow && state.kind === "idle" ? (
          <Alert role="status" data-testid="signin-verified-alert">
            <AlertTitle>{t("end-user.signin.verified.title.text")}</AlertTitle>
            <AlertDescription>{t("end-user.signin.verified.body.text")}</AlertDescription>
          </Alert>
        ) : null}
        {verifyErrorCode && state.kind === "idle" ? (
          <Alert variant="destructive" role="alert" data-testid="signin-verify-error-alert">
            <AlertTitle>
              {t(`end-user.signin.verify-error.${verifyErrorCode}.title.text`, {
                defaultValue: t("end-user.signin.verify-error.default.title.text"),
              })}
            </AlertTitle>
            <AlertDescription>
              {t(`end-user.signin.verify-error.${verifyErrorCode}.body.text`, {
                defaultValue: t("end-user.signin.verify-error.default.body.text"),
              })}
            </AlertDescription>
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
        {/*
          Upstream #9 — when the server disables local login
          (OPENWHISPR_DISABLE_LOCAL_LOGIN=1 → localLogin.enabled:false), hide the
          email/password form, the "or with email" separator, forgot-password,
          submit, and the sign-up cross-link — leaving ONLY the SSO buttons above
          plus a localized explanatory line. Default-safe: absent flag / old
          server / fetch failure keeps the form (see useAuthProviders).
        */}
        {localLoginEnabled ? (
          <>
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
                        togglePasswordShowLabel={t(
                          "end-user.common.action.togglePassword.show.label",
                        )}
                        togglePasswordHideLabel={t(
                          "end-user.common.action.togglePassword.hide.label",
                        )}
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
          </>
        ) : (
          // Upstream #9 — OIDC-only: explain the absent local form so a screen
          // with the SSO button(s) above is self-evident (and not blank if zero
          // providers happen to be configured).
          <p role="status" className="text-muted-foreground text-sm">
            {t("end-user.signin.local-login-disabled.body.text")}
          </p>
        )}
        {/*
          Desktop-client discoverability — rendered OUTSIDE the localLogin
          ternary so the CTA appears in BOTH local-login and OIDC-only modes.
          Targets the existing internal /download route (never GitHub directly).
        */}
        <p className="text-center text-sm">
          <Link
            href="/download"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            {t("end-user.signin.action.download-link.label")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
