// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — Error boundary (RESEARCH § Pattern surface).
//
// React 19 still requires class components for error boundaries — there is
// no `useErrorBoundary` hook in stable React. Per CLAUDE.md (TDD + no
// internal mocks) we keep the class component minimal and rely on standard
// `getDerivedStateFromError` + `componentDidCatch` lifecycle methods.
//
// Copy keys: this fallback uses static English text so it stays useful even
// when i18next itself failed to load (e.g. dynamic-import chunk error). A
// localised variant lives behind a `useTranslation()` lookup in screen-level
// error.tsx route files that the Next.js App Router auto-loads per segment.
"use client";

import { AlertCircle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort console logging only — production telemetry routes
    // through the OTel browser SDK in a later plan.
    // biome-ignore lint/suspicious/noConsole: error-boundary fallback log
    console.error("[error-boundary]", error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            An unexpected error occurred while rendering this page.
            <div className="mt-3">
              <Button onClick={this.reset} size="sm" variant="outline">
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}
