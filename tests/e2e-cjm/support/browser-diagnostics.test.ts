// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-01 RED → 53-02 GREEN sentinel tests for the
// browser-diagnostics helper. Four sentinel cases — one per captured
// dimension. Each simulates a real Playwright Page event via a minimal
// listener-emitter mock so the test runs in unit-test time (no real
// browser, no compose stack) yet exercises the same `page.on(event,
// handler)` shape the helper relies on at runtime.

import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  type BrowserDiagnosticEntry,
  expectNoBrowserErrors,
  getCapturedDiagnostics,
} from "./browser-diagnostics.js";

/**
 * Minimal Page-like emitter for sentinel tests. Implements the subset
 * of Playwright Page methods our helper consumes — `on(event, handler)`
 * and a way to fire synthetic events back. Real `Page` extends `EventEmitter`
 * AND exposes `addInitScript`; we shim both.
 */
function makeMockPage(): {
  page: Page;
  fire: (event: string, payload: unknown) => void;
  initScripts: string[];
} {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const initScripts: string[] = [];
  const page = {
    on(event: string, handler: (arg: unknown) => void): unknown {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return page;
    },
    addInitScript(script: string | (() => unknown)): Promise<void> {
      initScripts.push(typeof script === "string" ? script : script.toString());
      return Promise.resolve();
    },
  } as unknown as Page;
  const fire = (event: string, payload: unknown): void => {
    for (const h of handlers.get(event) ?? []) h(payload);
  };
  return { page, fire, initScripts };
}

describe("Plan 53 — browser-diagnostics helper (4 sentinel dimensions)", () => {
  it("captures console.error messages", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    fire("console", {
      type: () => "error",
      text: () => "deliberate console.error from sentinel",
      location: () => ({ url: "http://web/x.js", lineNumber: 42, columnNumber: 5 }),
    });
    const entries = getCapturedDiagnostics(page);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const err = entries.find((e) => e.kind === "console" && e.severity === "error");
    expect(err).toBeDefined();
    expect(err?.message).toContain("deliberate console.error from sentinel");
  });

  it("captures pageerror (uncaught exception) entries", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    fire("pageerror", new Error("deliberate uncaught: boom"));
    const entries = getCapturedDiagnostics(page);
    const pe = entries.find((e) => e.kind === "pageerror");
    expect(pe).toBeDefined();
    expect(pe?.severity).toBe("error");
    expect(pe?.message).toContain("deliberate uncaught: boom");
  });

  it("captures network responses with status >= 400", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    fire("response", {
      url: () => "http://web/api/auth/sign-up/email",
      status: () => 404,
      statusText: () => "Not Found",
      request: () => ({ method: () => "POST", failure: () => null }),
    });
    const entries = getCapturedDiagnostics(page);
    const net = entries.find((e) => e.kind === "network");
    expect(net).toBeDefined();
    expect(net?.severity).toBe("error");
    expect(net?.message).toContain("404");
    expect(net?.message).toContain("/api/auth/sign-up/email");
  });

  it("captures CSP violations forwarded by the injected init script", () => {
    const { page, fire, initScripts } = makeMockPage();
    attachBrowserDiagnostics(page);

    // The 53-02 GREEN implementation installs an addInitScript that
    // wires document.addEventListener('securitypolicyviolation', ...)
    // and forwards a console.error with a CSP_VIOLATION sentinel prefix
    // the helper recognizes. Verify the script was registered (proves
    // the inject path is wired).
    expect(initScripts.length).toBeGreaterThanOrEqual(1);
    expect(initScripts.join("\n")).toMatch(/securitypolicyviolation/i);

    // The fully captured CSP path arrives as a `console` event with
    // text matching the CSP_VIOLATION sentinel. Fire the corresponding
    // console event to exercise the classifier.
    fire("console", {
      type: () => "error",
      text: () =>
        "CSP_VIOLATION blockedURI=inline violatedDirective=script-src documentURI=http://web/sign-up",
      location: () => ({ url: "http://web/sign-up", lineNumber: 0, columnNumber: 0 }),
    });

    const entries = getCapturedDiagnostics(page);
    const csp = entries.find((e) => e.kind === "csp");
    expect(csp).toBeDefined();
    expect(csp?.severity).toBe("error");
    expect(csp?.message).toContain("script-src");
  });

  it("expectNoBrowserErrors throws when an error entry is present", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    fire("pageerror", new Error("must surface"));
    expect(() => expectNoBrowserErrors(page)).toThrow(/must surface/);
  });

  it("expectNoBrowserErrors passes when allowlist matches the only error", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    allowBrowserErrors(page, [/deliberate negative-twin/]);
    fire("pageerror", new Error("deliberate negative-twin: bad password"));
    expect(() => expectNoBrowserErrors(page)).not.toThrow();
  });

  it("expectNoBrowserErrors ignores non-error severity entries", () => {
    const { page, fire } = makeMockPage();
    attachBrowserDiagnostics(page);
    fire("console", {
      type: () => "warning",
      text: () => "just a warning",
      location: () => ({ url: "http://web/x.js", lineNumber: 1, columnNumber: 1 }),
    });
    expect(() => expectNoBrowserErrors(page)).not.toThrow();
    const entries = getCapturedDiagnostics(page);
    // The warning is still captured (for postmortem), just not error-severity.
    expect(entries.find((e) => e.severity === "warning")).toBeDefined();
  });

  it("type contract — BrowserDiagnosticEntry shape is stable", () => {
    const sample: BrowserDiagnosticEntry = {
      timestamp: 1,
      kind: "console",
      severity: "error",
      message: "x",
      detail: { foo: "bar" },
    };
    expect(sample.kind).toBe("console");
  });
});
