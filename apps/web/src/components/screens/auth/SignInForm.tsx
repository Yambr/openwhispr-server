// Phase 07.1 / Plan 07 — U1 Sign-in form.
//
// Client Component. RHF + zod + Better Auth signIn.email + OIDC row.
// D-UX2: Forgot-password is rendered as muted static text (no anchor / no
// button) — password reset is on the Phase 7.x backlog.
// D-S1: no custom fetch. Every call goes through authClient.* directly.
// Open-redirect mitigation: post-signin redirect is HARDCODED to "/app".
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

export function SignInForm(): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);

  const form = useZodForm({
    schema: signInSchema,
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  async function onSubmit(values: { email: string; password: string }): Promise<void> {
    setSubmitting(true);
    setErrorVisible(false);
    try {
      const result = (await authClient.signIn.email({
        email: values.email,
        password: values.password,
        // Open-redirect mitigation: hardcoded — never read ?next= from URL.
        callbackURL: "/app",
      })) as { data: unknown; error: { message?: string } | null };
      if (result.error) {
        setErrorVisible(true);
        return;
      }
      router.push("/app");
    } catch {
      setErrorVisible(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("end-user.signin.title.heading.text")}</CardTitle>
        <CardDescription>{t("end-user.signin.subtitle.body.text")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorVisible ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("end-user.signin.error.title.text")}</AlertTitle>
            <AlertDescription>{t("end-user.signin.error.body.text")}</AlertDescription>
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
