// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-02 GREEN — browser-diagnostics helper.
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
//     await attachBrowserDiagnostics(page);
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

const diagnosticsStore = new WeakMap<Page, BrowserDiagnosticEntry[]>();
const allowlistStore = new WeakMap<Page, RegExp[]>();

/** Sentinel prefix the injected CSP listener emits via console.error.
 *  When the helper sees a console.error starting with this prefix, it
 *  reclassifies the entry as `kind: "csp"` instead of `kind: "console"`. */
const CSP_VIOLATION_SENTINEL = "CSP_VIOLATION";

/** Severity classifier — Playwright console types vs our BrowserDiagnosticEntry. */
function classifyConsoleSeverity(consoleType: string): BrowserDiagnosticEntry["severity"] {
  switch (consoleType) {
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warning";
    case "info":
      return "info";
    default:
      return "log";
  }
}

/**
 * Init script injected into every page via `page.addInitScript`. The
 * script registers a `securitypolicyviolation` listener at document
 * level and forwards each violation through `console.error` with a
 * stable sentinel prefix the host helper recognizes. This works because
 * Playwright surfaces page-side console.error calls via `page.on('console')`.
 */
const CSP_LISTENER_INIT_SCRIPT = `
(() => {
  try {
    document.addEventListener("securitypolicyviolation", (event) => {
      const e = /** @type {SecurityPolicyViolationEvent} */ (event);
      const parts = [
        "${CSP_VIOLATION_SENTINEL}",
        "blockedURI=" + (e.blockedURI || "inline"),
        "violatedDirective=" + (e.violatedDirective || "?"),
        "documentURI=" + (e.documentURI || "?"),
        "sourceFile=" + (e.sourceFile || "?"),
        "lineNumber=" + (e.lineNumber || 0),
      ];
      console.error(parts.join(" "));
    });
  } catch {
    // Fail-silent — running outside a real browser (Playwright init
    // scripts execute inside the page context only).
  }
})();
`.trim();

/**
 * Attach console / pageerror / response / requestfailed listeners to
 * the page so subsequent `expectNoBrowserErrors(page)` sees everything
 * that happened during the test body. Also injects the CSP-violation
 * forwarder init script. Safe to call multiple times on the same page —
 * listeners are idempotent because the storage is keyed per-Page.
 */
export async function attachBrowserDiagnostics(page: Page): Promise<void> {
  if (diagnosticsStore.has(page)) {
    // Already attached — skip the duplicate listener setup.
    return;
  }
  const entries: BrowserDiagnosticEntry[] = [];
  diagnosticsStore.set(page, entries);

  // 1. console — log / info / warn / error
  page.on("console", (msg: unknown) => {
    const m = msg as {
      type: () => string;
      text: () => string;
      location?: () => { url: string; lineNumber: number; columnNumber: number };
    };
    const type = m.type();
    const text = m.text();
    const isCsp = text.startsWith(CSP_VIOLATION_SENTINEL);
    entries.push({
      timestamp: Date.now(),
      kind: isCsp ? "csp" : "console",
      severity: isCsp ? "error" : classifyConsoleSeverity(type),
      message: text,
      detail: m.location ? { location: m.location() } : undefined,
    });
  });

  // 2. pageerror — uncaught exception
  page.on("pageerror", (err: unknown) => {
    const e = err as Error;
    entries.push({
      timestamp: Date.now(),
      kind: "pageerror",
      severity: "error",
      message: e.message ?? String(err),
      detail: { stack: e.stack },
    });
  });

  // 3. network — response.status() >= 400
  page.on("response", (res: unknown) => {
    const r = res as {
      url: () => string;
      status: () => number;
      statusText?: () => string;
      request: () => { method: () => string };
    };
    const status = r.status();
    if (status < 400) return;
    entries.push({
      timestamp: Date.now(),
      kind: "network",
      severity: "error",
      message: `${r.request().method()} ${r.url()} → ${status}${
        r.statusText ? " " + r.statusText() : ""
      }`,
      detail: { url: r.url(), status, method: r.request().method() },
    });
  });

  // 3b. requestfailed — DNS / connection refused / aborts
  page.on("requestfailed", (req: unknown) => {
    const r = req as {
      url: () => string;
      method: () => string;
      failure: () => { errorText: string } | null;
    };
    const fail = r.failure();
    entries.push({
      timestamp: Date.now(),
      kind: "network",
      severity: "error",
      message: `${r.method()} ${r.url()} → FAILED${fail ? ": " + fail.errorText : ""}`,
      detail: { url: r.url(), method: r.method(), errorText: fail?.errorText },
    });
  });

  // 4. CSP — via init script forwarding to console.error with sentinel.
  await page.addInitScript(CSP_LISTENER_INIT_SCRIPT);
}

/**
 * Return the captured diagnostics array for the page. Read-only.
 * Returns an empty array if no listeners were attached.
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
  current.push(...patterns);
  allowlistStore.set(page, current);
}

/**
 * Assert that the captured diagnostics for a page contain ZERO entries
 * with `severity === "error"` (after subtracting any allowlist matches).
 * Throws an AssertionError listing every offending entry on failure.
 */
export function expectNoBrowserErrors(page: Page): void {
  const entries = diagnosticsStore.get(page) ?? [];
  const allowlist = allowlistStore.get(page) ?? [];
  const offending = entries.filter((e) => {
    if (e.severity !== "error") return false;
    return !allowlist.some((pattern) => pattern.test(e.message));
  });
  if (offending.length === 0) return;
  const lines = offending.map(
    (e) =>
      `  [${e.kind}/${e.severity}] ${e.message}${
        e.detail ? ` — ${JSON.stringify(e.detail).slice(0, 200)}` : ""
      }`,
  );
  throw new Error(
    `expectNoBrowserErrors: ${offending.length} browser-side error(s) captured:\n${lines.join(
      "\n",
    )}`,
  );
}
