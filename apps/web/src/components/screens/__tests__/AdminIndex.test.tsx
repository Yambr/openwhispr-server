// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-04 — RED+GREEN tests for the /admin index AdminIndex.
//
// Mirrors `.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:445-628`
// (ScreenConfig) STRUCTURE: page-head "Configuration" + lede, ONE read-only
// alert with role='status', and a 2-column card grid that lists env-var
// names with redacted values. Sidebar is NOT a concern of AdminIndex —
// AdminLayout already wraps children in AdminShell which provides the
// sidebar (Phase 07.1 D-ADMIN-1).
//
// PII gate (RESEARCH §15(h) / T-12.04-01): the rendered HTML body must
// contain ZERO email-like patterns, ZERO IPv4-like patterns, and ZERO
// case-insensitive occurrences of the literal substring "audit".
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const resources = {
  admin: {
    admin: {
      index: {
        title: { heading: { text: "Configuration" } },
        lede: {
          body: {
            text: "Server-side configuration for speech-to-text and note recording. Set via env vars; admin can view but not edit in v1.",
          },
        },
        readonly: {
          title: { text: "Read-only" },
          body: {
            text: "Edits require restarting the api container with updated env. See config.md.",
          },
        },
        "card-stt": {
          title: { text: "Speech-to-text" },
          endpoint: { text: "GET /api/stt-config" },
        },
        "card-note": {
          title: { text: "Note recording" },
          endpoint: { text: "GET /api/note-recording-config" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

describe("AdminIndex (Phase 12 / Plan 12-04 — closes TD-12.a)", () => {
  it("renders the page-head heading and lede", async () => {
    const { AdminIndex } = await import("../AdminIndex");
    const { container, getByText } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(getByText(/^Configuration$/)).toBeInTheDocument();
    expect(getByText(/speech-to-text and note recording/i)).toBeInTheDocument();
    // Heading must be rendered as an <h1> (page-head structural mirror).
    expect(container.querySelector("h1")?.textContent).toBe("Configuration");
  });

  it("renders exactly one read-only alert with role='status' (no destructive alert)", async () => {
    const { AdminIndex } = await import("../AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    const statusAlerts = container.querySelectorAll('[role="status"]');
    expect(statusAlerts.length).toBe(1);
    // Defense in depth — no role='alert' (destructive) on this surface.
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it("renders a 2-column card grid (>=2 cards)", async () => {
    const { AdminIndex } = await import("../AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    const cards = container.querySelectorAll('[data-slot="card"]');
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("PII gate (RESEARCH §15(h)): no email, no IPv4, no 'audit' in rendered HTML", async () => {
    const { AdminIndex } = await import("../AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    const html = container.innerHTML;
    // Email-like pattern (at least one char before @, one char before . in domain).
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    // IPv4-like pattern.
    expect(html).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    // No 'audit' word (case-insensitive).
    expect(html.toLowerCase()).not.toContain("audit");
  });
});
