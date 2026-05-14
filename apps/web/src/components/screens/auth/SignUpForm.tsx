// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U2 Sign-up form.
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
import { signUpSchema } from "@/lib/schemas/auth";
import { OidcButtons } from "./OidcButtons";

type ErrorKind = "duplicate" | "generic" | null;

export function SignUpForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [success, setSuccess] = useState(false);

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
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("end-user.signup.success.title.text")}</CardTitle>
          <CardDescription>{t("end-user.signup.success.body.text")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/sign-in" className="text-sm underline underline-offset-4">
            {t("end-user.signup.action.signin-link.label")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("end-user.signup.title.heading.text")}</CardTitle>
        <CardDescription>{t("end-user.signup.subtitle.body.text")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorKind ? (
          // Plan 12-04 / UICONF-06: title and body resolve to DISTINCT i18n
          // keys per errorKind. Mirrors the SignInForm.tsx:83-84 shape and
          // closes the duplicate-banner regression at the bug locus (the
          // previous AlertTitle + AlertDescription pair rendered the same
          // i18n key twice — RESEARCH §11 root cause).
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
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {t("end-user.signup.form.submit.label")}
            </Button>
          </form>
        </Form>
        <Separator />
        <OidcButtons namespace="signup" />
      </CardContent>
      <CardFooter>
        <Link href="/sign-in" className="text-sm underline underline-offset-4">
          {t("end-user.signup.action.signin-link.label")}
        </Link>
      </CardFooter>
    </Card>
  );
}
