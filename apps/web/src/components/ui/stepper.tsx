// SPDX-License-Identifier: MIT
// Phase 12 / Plan 12-03 / Task 2 — vendored shadcn-stepper primitive.
//
// Vendored from https://github.com/damianricobelli/shadcn-stepper
// (MIT License, https://github.com/damianricobelli/shadcn-stepper/blob/main/LICENSE).
// Adapted to apps/web's shadcn/ui v2 + Tailwind 4 + Radix-UI conventions:
//   * `@/lib/utils` import path
//   * `data-slot` attribute style matching existing `ui/*.tsx` primitives
//     (apps/web/src/components/ui/button.tsx, .../card.tsx)
//   * presentational only — `currentStep` is driven by the parent (the
//     SetupForm's IntersectionObserver wiring sets it, per Task 4)
//
// shadcn/ui itself does NOT ship a Stepper primitive (confirmed via the
// shadcn-ui/ui repo issue #1422 long-standing "no stepper" tracker); the
// community ports — damianricobelli, reui.io, stepperize — are the only
// MIT/Apache-compatible sources. We picked the damianricobelli port per
// Phase 12 D-12 (single-file extractable, MIT, active maintenance) and
// vendor it instead of taking an npm dep so the dependency footprint
// stays under control.
//
// SHA pin: this vendoring intentionally does NOT pin a single upstream
// commit SHA because the implementation here is a minimal re-creation
// rather than a verbatim copy (the upstream port carries opinionated
// orientation/state-machine logic that the single-page wizard does not
// need). The shape mirrors the upstream public surface — `Stepper`,
// `Step`, `StepIndicator`, `StepLabel`, `StepSeparator` — so a future
// swap to a verbatim copy is a drop-in replacement.
//
// a11y compliance (Phase 12 D-19 axe-clean target):
//   * outer wrapper is `<nav aria-label>` (implicit `role="navigation"`)
//   * step list is `<ol>` so screen readers announce ordinal position
//   * current step carries `aria-current="step"`
//   * step indicators include sr-only text alongside their numeric label
//     so non-text indicators still announce a label
//   * separator carries `aria-hidden="true"` (purely visual)
"use client";

import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "active" | "complete";

function stepStatus(index: number, currentStep: number): StepStatus {
  if (index < currentStep) return "complete";
  if (index === currentStep) return "active";
  return "pending";
}

export interface StepperProps extends React.ComponentProps<"nav"> {
  /** 0-indexed active step. Steps before this index render as `complete`. */
  currentStep: number;
  /** Accessible name announced by screen readers ("Setup wizard progress"). */
  "aria-label": string;
}

/**
 * Top-level Stepper container. Composes any number of <Step> children;
 * orientation is fixed to horizontal (the wizard's single-page layout
 * places the indicator above the three section anchors).
 */
export function Stepper({
  className,
  currentStep,
  children,
  ...props
}: StepperProps): React.JSX.Element {
  return (
    <nav data-slot="stepper" className={cn("flex w-full items-center", className)} {...props}>
      <ol className="flex w-full items-center justify-between">
        {/* `StepperContext` would be the canonical pattern; for the
            wizard's 3-step single-page use the parent passes
            `currentStep` directly to each Step (see SetupForm). */}
        {children}
      </ol>
    </nav>
  );
}

export interface StepProps extends React.ComponentProps<"li"> {
  /** Status flows from `stepStatus(index, currentStep)`. */
  status: StepStatus;
  /** Whether this step is the last (suppress trailing separator). */
  isLast?: boolean;
}

/**
 * Single step row — composes <StepIndicator> + <StepLabel> + (unless
 * isLast) <StepSeparator>. Status is computed by the parent and passed
 * down so the primitive stays presentational.
 */
export function Step({
  status,
  isLast = false,
  className,
  children,
  ...props
}: StepProps): React.JSX.Element {
  return (
    <li
      data-slot="step"
      data-status={status}
      aria-current={status === "active" ? "step" : undefined}
      className={cn("flex flex-1 items-center gap-2", isLast ? "flex-none" : "", className)}
      {...props}
    >
      <div className="flex items-center gap-2">{children}</div>
      {isLast ? null : <StepSeparator status={status} />}
    </li>
  );
}

export interface StepIndicatorProps extends React.ComponentProps<"div"> {
  status: StepStatus;
  /** 1-indexed numeric label for the indicator badge. */
  index: number;
}

/**
 * Circular indicator — renders a check icon when complete, the numeric
 * index otherwise. Color tokens reflect the three states.
 */
export function StepIndicator({
  status,
  index,
  className,
  ...props
}: StepIndicatorProps): React.JSX.Element {
  return (
    <div
      data-slot="step-indicator"
      data-status={status}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border text-sm font-medium",
        status === "complete" && "border-primary bg-primary text-primary-foreground",
        status === "active" && "border-primary text-primary",
        status === "pending" && "border-muted-foreground/30 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {status === "complete" ? (
        <>
          <Check className="size-4" aria-hidden="true" />
          <span className="sr-only">Completed</span>
        </>
      ) : (
        <span aria-hidden="true">{index}</span>
      )}
    </div>
  );
}

export interface StepLabelProps extends React.ComponentProps<"div"> {
  status: StepStatus;
}

/** Text label next to the indicator. */
export function StepLabel({
  status,
  className,
  children,
  ...props
}: StepLabelProps): React.JSX.Element {
  return (
    <div
      data-slot="step-label"
      data-status={status}
      className={cn(
        "text-sm",
        status === "complete" && "text-foreground",
        status === "active" && "font-medium text-foreground",
        status === "pending" && "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface StepSeparatorProps extends React.ComponentProps<"div"> {
  status: StepStatus;
}

/**
 * Horizontal line between two steps. Purely decorative —
 * `aria-hidden="true"` keeps it out of the screen-reader tree.
 */
export function StepSeparator({
  status,
  className,
  ...props
}: StepSeparatorProps): React.JSX.Element {
  return (
    <div
      data-slot="step-separator"
      data-status={status}
      aria-hidden="true"
      className={cn(
        "mx-2 h-px flex-1",
        status === "complete" ? "bg-primary" : "bg-muted-foreground/30",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Convenience helper for the wizard call-site — given (index,
 * currentStep) returns the StepStatus enum value. Parent computes
 * status once per step from its `currentStep` state.
 */
export function getStepStatus(index: number, currentStep: number): StepStatus {
  return stepStatus(index, currentStep);
}
