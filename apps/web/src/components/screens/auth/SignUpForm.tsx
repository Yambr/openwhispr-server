// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U2 Sign-up form.
// Phase 18.1.1 / Plan 04 / Task 05 — D-24..D-28 visual-oracle alignment:
//   - D-24: wrap in <AuthShell> with signup-specific side-panel copy.
//   - D-25: inline passwordStrength helper + 4px progress bar with
//           band label (Weak / Fair / Good / Strong). Bands map to
//           bg-red-500 / orange-500 / yellow-500 / green-500.
//   - D-27 SCOPE-OUT (planner W-1): terms checkbox deferred to Phase
//           19.x — /terms and /privacy routes do not yet exist under
//           apps/web/src/app/(public)/. Tracked in deferred-items.md.
//   - D-28: footer cosmetic — centered accent link to sign-in.
//
// Client Component. RHF + zod + Better Auth signUp.email. Success state
// renders the "Check your email" verification notice; duplicate-email
// error renders the dedicated copy key per D-UX1.
"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { useZodForm } from "@/lib/form-utils";
import { signUpSchema } from "@/lib/schemas/auth";
import { AuthShell } from "./AuthShell";
import { OidcButtons } from "./OidcButtons";

type ErrorKind = "duplicate" | "generic" | null;

interface StrengthSlot {
  score: 0 | 1 | 2 | 3 | 4;
  bandKey: "weak" | "fair" | "good" | "strong";
  /** Tailwind bg-* class for the filled portion of the meter. */
  fillClass: string;
}

/**
 * D-25 — inline password-strength helper colocated with the SignUpForm
 * to avoid a new top-level dependency (D-44). Maps password content to
 * one of four bands by counting four signal classes (length≥12, upper,
 * digit, symbol). Bands: 0-1 weak, 2 fair, 3 good, 4 strong.
 */
export function passwordStrength(value: string): StrengthSlot {
  let s = 0;
  if (value.length >= 12) s++;
  if (/[A-Z]/.test(value)) s++;
  if (/[0-9]/.test(value)) s++;
  if (/[^A-Za-z0-9]/.test(value)) s++;
  if (s <= 1) return { score: 1, bandKey: "weak", fillClass: "bg-red-500" };
  if (s === 2) return { score: 2, bandKey: "fair", fillClass: "bg-orange-500" };
  if (s === 3) return { score: 3, bandKey: "good", fillClass: "bg-yellow-500" };
  return { score: 4, bandKey: "strong", fillClass: "bg-green-500" };
}

export function SignUpForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [success, setSuccess] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");

  const form = useZodForm({
    schema: signUpSchema,
    defaultValues: { name: "", email: "", password: "" },
    mode: "onSubmit",
  });

  async function onSubmit(values: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    setSubmitting(true);
    setErrorKind(null);
    try {
      const result = (await authClient.signUp.email({
        name: values.name,
        email: values.email,
        password: values.password,
      })) as { data: unknown; error: { code?: string; message?: string } | null };
      if (result.error) {
        const code = result.error.code ?? "";
        const msg = result.error.message ?? "";
        const isDup = code === "USER_ALREADY_EXISTS" || /already exists/i.test(msg);
        setErrorKind(isDup ? "duplicate" : "generic");
        return;
      }
      setSuccess(true);
    } catch {
      setErrorKind("generic");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <AuthShell
        sideTitle={t("end-user.signup.shell.sideTitle.text")}
        sideQuote={t("end-user.signup.shell.sideQuote.text")}
      >
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl tracking-tight">
              {t("end-user.signup.success.title.text")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("end-user.signup.success.body.text")}
            </p>
          </header>
          <p className="text-center text-sm">
            <Link
              href="/sign-in"
              className="text-primary underline underline-offset-4 hover:opacity-80"
            >
              {t("end-user.signup.action.signin-link.label")}
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const strength = passwordStrength(passwordValue);
  const bandLabel = t(`end-user.signup.form.passwordStrength.${strength.bandKey}.label`);

  return (
    <AuthShell
      sideTitle={t("end-user.signup.shell.sideTitle.text")}
      sideQuote={t("end-user.signup.shell.sideQuote.text")}
    >
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">
            {t("end-user.signup.title.heading.text")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("end-user.signup.subtitle.body.text")}</p>
        </header>
        {errorKind ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>
              {errorKind === "duplicate"
                ? t("end-user.signup.error-duplicate.title.text")
                : t("end-user.signup.error-generic.title.text")}
            </AlertTitle>
            <AlertDescription>
              {errorKind === "duplicate"
                ? t("end-user.signup.error-duplicate.body.text")
                : t("end-user.signup.error-generic.body.text")}
            </AlertDescription>
          </Alert>
        ) : null}
        <OidcButtons namespace="signup" />
        <Separator />
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit as never)}
            className="flex flex-col gap-3"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.signup.form.name.label")}</FormLabel>
                  <FormControl>
                    <Input type="text" autoComplete="name" disabled={submitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("end-user.signup.form.email.label")}</FormLabel>
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
                  <FormLabel>{t("end-user.signup.form.password.label")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      disabled={submitting}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        setPasswordValue(e.target.value);
                      }}
                    />
                  </FormControl>
                  {/* D-25 — 4px strength meter; bands map to red/orange/yellow/green. */}
                  {passwordValue.length > 0 ? (
                    <div data-testid="password-strength-meter" className="flex flex-col gap-1">
                      <div className="h-1 w-full overflow-hidden rounded bg-muted">
                        <div
                          className={`h-full transition-all ${strength.fillClass}`}
                          style={{ width: `${(strength.score / 4) * 100}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <span
                        className="text-muted-foreground text-xs"
                        data-strength-band={strength.bandKey}
                      >
                        {bandLabel}
                      </span>
                    </div>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            {/*
              W-1 SCOPE-OUT (Phase 18.1.1-04-05): terms checkbox deferred
              to Phase 19.x. The /terms and /privacy routes do not yet
              exist under apps/web/src/app/(public)/; the planner W-1
              guard mandates that the checkbox stays out until they ship.
              Tracked in .planning/deferred-items.md §18.1.1-04-05.
            */}
            <Button type="submit" disabled={submitting}>
              {t("end-user.signup.form.submit.label")}
            </Button>
          </form>
        </Form>
        <p className="text-center text-sm">
          <Link
            href="/sign-in"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            {t("end-user.signup.action.signin-link.label")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
