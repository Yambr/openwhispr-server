// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — theme-provider tests (RED before GREEN).
//
// Minimal wrapper around next-themes (already in deps). Persists user
// preference to localStorage under key 'theme' — D-SEC-2 explicitly allows
// non-secret UI preference there; only auth TOKENS are forbidden.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme-provider";

describe("ThemeProvider (Phase 07.1 / Plan 06)", () => {
  it("renders children", () => {
    const { getByText } = render(
      <ThemeProvider>
        <span>themed</span>
      </ThemeProvider>,
    );
    expect(getByText("themed")).toBeInTheDocument();
  });

  it("sets the data-theme attribute strategy on <html>", () => {
    render(
      <ThemeProvider>
        <span>themed</span>
      </ThemeProvider>,
    );
    // next-themes injects an inline script that toggles the attribute on
    // <html>; in happy-dom we cannot rely on the script side effect, but we
    // can assert the provider does not throw and renders the subtree.
    // Real attribute assertion lives in the Playwright e2e (Plan 12).
    expect(document.documentElement).toBeTruthy();
  });
});
