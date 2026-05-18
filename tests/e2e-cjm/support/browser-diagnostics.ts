// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-01 RED — browser-diagnostics helper stub.
//
// Captures 4 dimensions of browser-side problems during a Playwright
// session and surfaces them with the failure diagnostics so a failed
// e2e shows the root cause WITHOUT a re-run:
//
//   1. console messages (log / info / warn / error)
//   2. page errors (uncaught exceptions on the page)
//   3. network failures (response.status() >= 400 OR request.failure())
//   4. CSP violations (SecurityPolicyViolationEvent surfaced via an
//      injected window listener that forwards to console.error)
//
// Usage in a Playwright test:
//
//   import { test } from "@playwright/test";
//   import {
//     attachBrowserDiagnostics,
//     expectNoBrowserErrors,
//   } from "./support/browser-diagnostics.js";
//
//   test.beforeEach(async ({ page }) => {
//     attachBrowserDiagnostics(page);
//   });
//
//   test.afterEach(async ({ page }) => {
//     expectNoBrowserErrors(page);
//   });
//
// Per-test escape hatch for known-acceptable browser-side log entries
// (e.g., a deliberate negative-twin that throws):
//
//   import { allowBrowserErrors } from "./support/browser-diagnostics.js";
//   test("...", async ({ page }) => {
//     allowBrowserErrors(page, [/deliberate failure: bad password/]);
//     // ... rest of test ...
//   });
//
// THIS FILE IS THE 53-01 RED STUB. The 4 sentinel cases in
// `browser-diagnostics.test.ts` ALL FAIL against this stub because
// `attachBrowserDiagnostics` does nothing and `getCapturedDiagnostics`
// returns an empty array. 53-02 GREEN replaces the stubs with real
// listeners.

import type { Page } from "@playwright/test";

export interface BrowserDiagnosticEntry {
  /** When the entry was captured. */
  readonly timestamp: number;
  /** One of the four supported dimensions. */
  readonly kind: "console" | "pageerror" | "network" | "csp";
  /** "error" | "warning" | "info" | "log" depending on the source. */
  readonly severity: "error" | "warning" | "info" | "log";
  /** Free-text message — varies by kind (see implementation). */
  readonly message: string;
  /** Optional structured payload — url for network, source-position for
   *  console, blockedURI for CSP, etc. */
  readonly detail?: Record<string, unknown>;
}

/**
 * Per-page diagnostics storage. Keyed by Page object identity (a
 * Playwright Page is unique per browser tab in a test). The 53-02 GREEN
 * implementation populates this map via `attachBrowserDiagnostics`.
 */
const diagnosticsStore = new WeakMap<Page, BrowserDiagnosticEntry[]>();

/**
 * Per-page allowlist of regex patterns matched against
 * `BrowserDiagnosticEntry.message`. Entries matched by an allowlist
 * pattern are NOT surfaced as errors by `expectNoBrowserErrors`.
 */
const allowlistStore = new WeakMap<Page, readonly RegExp[]>();

/**
 * Attach console / pageerror / response / requestfailed listeners to
 * the page so subsequent `expectNoBrowserErrors(page)` sees everything
 * that happened during the test body.
 *
 * Plan 53-01 RED — STUB. Does nothing. The 4 sentinel cases fail.
 */
export function attachBrowserDiagnostics(_page: Page): void {
  // intentional no-op for 53-01 RED
}

/**
 * Return the captured diagnostics array for the page. Read-only.
 *
 * Plan 53-01 RED — STUB. Always returns empty.
 */
export function getCapturedDiagnostics(page: Page): readonly BrowserDiagnosticEntry[] {
  return diagnosticsStore.get(page) ?? [];
}

/**
 * Add allowlist patterns the assertion helpers skip when matching the
 * captured diagnostics. Idempotent — duplicates are tolerated.
 */
export function allowBrowserErrors(page: Page, patterns: readonly RegExp[]): void {
  const current = allowlistStore.get(page) ?? [];
  allowlistStore.set(page, [...current, ...patterns]);
}

/**
 * Assert that the captured diagnostics for a page contain ZERO entries
 * with `severity === "error"` (after subtracting any allowlist matches).
 * Throws an AssertionError listing every offending entry on failure.
 *
 * Plan 53-01 RED — STUB. Always passes because the store is empty.
 */
export function expectNoBrowserErrors(_page: Page): void {
  // intentional no-op for 53-01 RED
}
