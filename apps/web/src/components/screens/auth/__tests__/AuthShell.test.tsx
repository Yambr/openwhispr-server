// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 04 / Task 04-01 — RED+GREEN tests for AuthShell.
//
// Surface verified (D-13 + D-15 + D-43 + PATTERNS B1):
//   1. Renders children inside a form slot, AND renders a `<aside>`/side panel.
//   2. Custom `sideTitle` / `sideKicker` / `sideQuote` props surface in the side panel.
//   3. Mobile viewport (<lg) — side panel is hidden via Tailwind `hidden lg:flex`.
//   4. Footer links Status / Docs / GitHub rendered with i18n-driven labels.
//   5. Default copy resolves from `common.auth.shell.kicker.default.text`, etc.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const resources = {
  common: {
    common: {
      auth: {
        shell: {
          kicker: { default: { text: "Self-host · v1" } },
          title: { default: { text: "Your speech, on your servers." } },
          quote: {
            default: {
              text: "Private speech-to-text running in your own environment.",
            },
          },
          footer: {
            status: { text: "Status" },
            docs: { text: "Docs" },
            github: { text: "GitHub" },
          },
        },
      },
    },
  },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

describe("AuthShell (Phase 18.1.1 / Plan 04 — D-13)", () => {
  it("renders children in the form slot and a side panel <aside>", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell>
          <div data-testid="form-content">child</div>
        </AuthShell>
      </Wrap>,
    );
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    // Side panel is an <aside> with branded content.
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("surfaces custom sideTitle in the side panel", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell sideTitle="Welcome back">
          <div>child</div>
        </AuthShell>
      </Wrap>,
    );
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it("surfaces custom sideKicker + sideQuote when provided", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell sideKicker="Custom kicker" sideQuote="Custom quote text">
          <div>child</div>
        </AuthShell>
      </Wrap>,
    );
    expect(screen.getByText(/custom kicker/i)).toBeInTheDocument();
    expect(screen.getByText(/custom quote text/i)).toBeInTheDocument();
  });

  it("side panel is hidden on small viewports via Tailwind `hidden lg:flex`", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell>
          <div>child</div>
        </AuthShell>
      </Wrap>,
    );
    const aside = screen.getByRole("complementary");
    // Tailwind utility class assertion — side hidden by default, lg:flex turns it on.
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/\blg:flex\b/);
  });

  it("renders Status / Docs / GitHub footer links with i18n-driven labels", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell>
          <div>child</div>
        </AuthShell>
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /docs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github/i })).toBeInTheDocument();
  });

  it("falls back to default i18n keys when no side props are passed", async () => {
    const { AuthShell } = await import("../AuthShell");
    render(
      <Wrap>
        <AuthShell>
          <div>child</div>
        </AuthShell>
      </Wrap>,
    );
    expect(screen.getByText(/self-host · v1/i)).toBeInTheDocument();
    expect(screen.getByText(/your speech, on your servers/i)).toBeInTheDocument();
    expect(screen.getByText(/private speech-to-text/i)).toBeInTheDocument();
  });
});
