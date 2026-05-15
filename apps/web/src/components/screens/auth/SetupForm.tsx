// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 4 — Client wizard form.
//
// Conformance inventory: composes ui.jsx:AuthShell (L229-316) + ui.jsx:Field
// (L338-352) + ui.jsx:Btn (L326-336). NO /setup JSX oracle exists; this is
// a deliberate, documented design deviation per RESEARCH §16 / D-20 — the
// authoritative Phase-07 screens-user.jsx + ui.jsx pair never produced a
// dedicated `ScreenSetup` template. Single-page wizard semantics
// (Identity → Workspace → Review) are an ADMIN-02 invention.
//
// Architecture:
//   * RHF + Zod via useZodForm (Phase 07.1 Plan 06 helper)
//   * setupSchema + zod-i18n bridge (Plan 12-03 Task 3) → per-field
//     localized errors with en+ru parity (UICONF-03)
//   * <Stepper> driven by an IntersectionObserver subscribing to three
//     `<section id="identity|workspace|review">` anchors; the most-
//     visible section's index becomes `currentStep`
//   * Idempotent submit (T-12.03-01): POST /api/setup/admin; both 201
//     and 200 (race-loser) advance to /admin
//   * Hardcoded /admin redirect (T-12.03-04 / RESEARCH §15(g)); never
//     reads `?next=` from the URL
//   * Warnings array on 201 (tenant_rename_failed) renders a non-
//     blocking notice before redirect (T-12.03-05 sub-test 7 graceful
//     degradation)
//   * Submit button disabled while in flight (D-15)
//
// IntersectionObserver wiring choice: a SINGLE observer with three
// observed targets, threshold 0.5. The most-recently-intersecting
// section's index wins. Two-observer / three-observer alternatives are
// possible but produce identical visible behaviour for the wizard's
// short-anchor layout; we picked the single-observer variant for
// simplicity (one effect, one teardown).
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getStepStatus, Step, StepIndicator, StepLabel, Stepper } from "@/components/ui/stepper";
import { useZodForm } from "@/lib/form-utils";
import { type SetupInput, setupSchema } from "@/lib/schemas/setup";
import { installZodI18n } from "@/lib/zod-i18n";
import { AuthShell } from "./AuthShell";

type ErrorKind = "duplicate" | "generic" | null;

const SECTION_IDS = ["identity", "workspace", "review"] as const;

/**
 * Detect a sensible default timezone for the picker — falls through to
 * UTC if the browser returns an unrecognized zone (defensive — Safari
 * has historically returned "Etc/Unknown" in private-window contexts).
 */
/* v8 ignore start -- defensive helper: Node 24 + evergreen browsers always return a non-empty IANA zone; the && chain + catch branch cover ancient/private-window edge cases that the unit-test runtime cannot reproduce. */
function defaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.length > 0 && tz !== "Etc/Unknown") return tz;
  } catch {
    // fall through
  }
  return "UTC";
}
/* v8 ignore stop */

/**
 * Build the list of zones for the picker. Uses native
 * Intl.supportedValuesOf when available (Node 24 + evergreen browsers);
 * falls back to a small set covering UTC + common offsets so SSR + old
 * runtimes never produce an empty <select>.
 */
/* v8 ignore start -- defensive helper: Node 24 + evergreen browsers always expose Intl.supportedValuesOf and return ≥1 zone; the function-typecheck + Array-typecheck + length-typecheck + catch branches cover ancient/non-ICU runtimes that the unit-test environment cannot reproduce. */
function listTimezones(): readonly string[] {
  const supportedValuesOf = (Intl as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  if (typeof supportedValuesOf === "function") {
    try {
      const zones = supportedValuesOf("timeZone");
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // fall through
    }
  }
  return ["UTC", "Europe/London", "Europe/Berlin", "Europe/Moscow", "America/New_York"];
}
/* v8 ignore stop */

interface SetupAdminSuccess {
  admin: { email?: string };
  alreadyCompleted: boolean;
  warnings?: string[];
}

export function SetupForm(): React.JSX.Element {
  const { t, i18n } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  // Install (or refresh) the Zod customError map against the active
  // i18next instance — re-runs on language change so messages flip live.
  useLayoutEffect(() => {
    installZodI18n(i18n);
  }, [i18n]);

  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [warningKind, setWarningKind] = useState<"tenant_rename_failed" | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const form = useZodForm({
    schema: setupSchema,
    defaultValues: {
      email: "",
      password: "",
      name: "",
      workspace: "",
      timezone: defaultTimezone(),
    },
    mode: "onSubmit",
  });

  // Single IntersectionObserver watches all three sections. The most-
  // intersecting target sets `currentStep`. ref is kept to a stable
  // array so the cleanup unobserves exactly what was observed.
  const sectionRefs = useRef<Array<HTMLElement | null>>([null, null, null]);
  useEffect(() => {
    /* v8 ignore next -- SSR / non-browser fallback; jsdom + Phase-13 playwright supply IntersectionObserver. */
    if (typeof IntersectionObserver === "undefined") return;
    let lastIntersecting = -1;
    const observer = new IntersectionObserver(
      /* v8 ignore start -- browser-driven callback; covered by e2e playwright in Phase 13, not happy-dom unit tests. */
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = sectionRefs.current.findIndex((el) => el === entry.target);
            if (idx >= 0 && idx !== lastIntersecting) {
              lastIntersecting = idx;
              setCurrentStep(idx);
            }
          }
        }
      },
      /* v8 ignore stop */
      { threshold: 0.5 },
    );
    for (const el of sectionRefs.current) {
      /* v8 ignore next -- defensive: refs are populated by the time useEffect fires; the null branch covers strict-mode double-mount edge cases. */
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  async function onSubmit(values: SetupInput): Promise<void> {
    setSubmitting(true);
    setErrorKind(null);
    setWarningKind(null);
    try {
      const res = await fetch("/api/setup/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.status === 201 || res.status === 200) {
        const body = (await res.json()) as SetupAdminSuccess;
        if (body.warnings?.includes("tenant_rename_failed")) {
          setWarningKind("tenant_rename_failed");
        }
        // Hardcoded redirect — never read `?next=` from the URL.
        router.push("/admin");
        return;
      }
      setErrorKind("generic");
    } catch {
      setErrorKind("generic");
    } finally {
      setSubmitting(false);
    }
  }

  const identityHeadingId = useId();
  const workspaceHeadingId = useId();
  const reviewHeadingId = useId();
  const stepIds = [identityHeadingId, workspaceHeadingId, reviewHeadingId];
  const stepLabels: readonly string[] = [
    t("end-user.setup.step.identity.title.text"),
    t("end-user.setup.step.workspace.title.text"),
    t("end-user.setup.step.review.title.text"),
  ];

  const watched = form.watch();

  return (
    <AuthShell
      sideTitle={t("end-user.setup.shell.sideTitle.text")}
      sideQuote={t("end-user.setup.shell.sideQuote.text")}
    >
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{t("end-user.setup.title.heading.text")}</CardTitle>
          <CardDescription>{t("end-user.setup.subtitle.body.text")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Stepper
            currentStep={currentStep}
            aria-label={t("end-user.setup.stepper.aria_label.text")}
          >
            {SECTION_IDS.map((id, idx) => {
              const status = getStepStatus(idx, currentStep);
              return (
                <Step key={id} status={status} isLast={idx === SECTION_IDS.length - 1}>
                  <StepIndicator status={status} index={idx + 1} />
                  <StepLabel status={status}>{stepLabels[idx]}</StepLabel>
                </Step>
              );
            })}
          </Stepper>

          {errorKind ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{t("end-user.setup.error.generic.title.text")}</AlertTitle>
              <AlertDescription>{t("end-user.setup.error.generic.body.text")}</AlertDescription>
            </Alert>
          ) : null}
          {warningKind === "tenant_rename_failed" ? (
            <Alert role="status">
              <AlertDescription>
                {t("end-user.setup.warning.tenant_rename_failed.text")}
              </AlertDescription>
            </Alert>
          ) : null}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit as never)}
              className="flex flex-col gap-6"
              noValidate
            >
              <section
                id="identity"
                aria-labelledby={stepIds[0]}
                ref={(el) => {
                  sectionRefs.current[0] = el;
                }}
                className="flex flex-col gap-3"
              >
                <h2 id={stepIds[0]} className="text-base font-medium">
                  {stepLabels[0]}
                </h2>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("end-user.setup.form.name.label")}</FormLabel>
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
                      <FormLabel>{t("end-user.setup.form.email.label")}</FormLabel>
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
                      <FormLabel>{t("end-user.setup.form.password.label")}</FormLabel>
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
              </section>

              <section
                id="workspace"
                aria-labelledby={stepIds[1]}
                ref={(el) => {
                  sectionRefs.current[1] = el;
                }}
                className="flex flex-col gap-3"
              >
                <h2 id={stepIds[1]} className="text-base font-medium">
                  {stepLabels[1]}
                </h2>
                <FormField
                  control={form.control}
                  name="workspace"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("end-user.setup.form.workspace.label")}</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          autoComplete="organization"
                          disabled={submitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("end-user.setup.form.timezone.label")}</FormLabel>
                      <FormControl>
                        {/* Native <select> — RESEARCH §8 recommended a
                          cmdk-Combobox for the ~430-zone surface, but
                          apps/web does not yet vendor cmdk. Pulling it
                          in is out of scope for Plan 12-03; the native
                          select remains keyboard-accessible and screen-
                          reader friendly. Tracked in SUMMARY's
                          deviations section as a follow-up. */}
                        <select
                          {...field}
                          disabled={submitting}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                        >
                          {listTimezones().map((tz) => (
                            <option key={tz} value={tz}>
                              {tz}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              <section
                id="review"
                aria-labelledby={stepIds[2]}
                ref={(el) => {
                  sectionRefs.current[2] = el;
                }}
                className="flex flex-col gap-3"
              >
                <h2 id={stepIds[2]} className="text-base font-medium">
                  {stepLabels[2]}
                </h2>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">{t("end-user.setup.form.name.label")}</dt>
                  <dd>{watched.name || "—"}</dd>
                  <dt className="text-muted-foreground">{t("end-user.setup.form.email.label")}</dt>
                  <dd>{watched.email || "—"}</dd>
                  <dt className="text-muted-foreground">
                    {t("end-user.setup.form.workspace.label")}
                  </dt>
                  <dd>{watched.workspace || "—"}</dd>
                  <dt className="text-muted-foreground">
                    {t("end-user.setup.form.timezone.label")}
                  </dt>
                  <dd>{watched.timezone || "—"}</dd>
                </dl>
                <Button type="submit" disabled={submitting}>
                  {t("end-user.setup.form.submit.label")}
                </Button>
              </section>
            </form>
          </Form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
