// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 08 — U4 Usage dashboard Client tests (RED→GREEN).
//
// Surface verified against the live GET /api/usage shape (apps/api/src/routes/usage.ts:67-71):
//   { wordsUsed: number, wordsRemaining: number, plan: 'unlimited' | string,
//     limitReached: boolean }.
// KPI-only (D-STACK-6 + D-API6): four KPI cards exactly, no charts, no
// activity feed.
//
// States covered:
//   - loading: four Skeleton placeholders (data-testid="usage-skeleton")
//   - success: four KPI cards with formatted numbers + plan label + boolean badge
//   - error: Alert with Retry that calls refetch
//   - "empty" is N/A per UI-SPEC (wordsUsed defaults to 0; KPIs still render)
//     — exercised by asserting "0" still renders the cards.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app",
}));

const clientFetchMock = vi.fn();
vi.mock("@/lib/client-fetch", () => ({
  clientFetch: (...args: unknown[]) => clientFetchMock(...args),
}));

import { UsageDashboardClient } from "../UsageDashboardClient";

const resources = {
  "end-user": {
    "end-user": {
      usage: {
        title: { heading: { text: "Usage" } },
        subtitle: { body: { text: "Your current consumption against the active plan." } },
        nav: { sidebar: { label: "Dashboard" } },
        action: { refresh: { label: "Refresh" } },
        "kpi-words-used": {
          title: { label: "Words used" },
          body: { text: "Across all transcriptions and notes." },
        },
        "kpi-words-remaining": {
          title: { label: "Words remaining" },
          body: { text: "Quota left on your current plan." },
        },
        "kpi-plan": {
          title: { label: "Plan" },
          body: { text: "Active subscription plan." },
        },
        "kpi-limit-reached": {
          title: { label: "Limit reached" },
          body: { text: "Whether you are currently throttled." },
        },
        error: {
          title: { text: "Could not load usage" },
          body: { text: "Retry, or check the api container logs in Grafana." },
          retry: { label: "Retry" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider lng="en" resources={resources}>
        {ui}
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("UsageDashboardClient (Phase 07.1 / Plan 08)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
  });

  it("renders four Skeleton placeholders while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<UsageDashboardClient />);
    expect(container.querySelectorAll('[data-testid="usage-skeleton"]')).toHaveLength(4);
  });

  it("renders four KPI cards on success with formatted numbers", async () => {
    clientFetchMock.mockResolvedValue({
      wordsUsed: 12345,
      wordsRemaining: 987654,
      plan: "unlimited",
      limitReached: false,
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-words-used")).toBeInTheDocument();
      expect(screen.getByTestId("kpi-words-remaining")).toBeInTheDocument();
      expect(screen.getByTestId("kpi-plan")).toBeInTheDocument();
      expect(screen.getByTestId("kpi-limit-reached")).toBeInTheDocument();
    });
    // Intl.NumberFormat('en') formats 12345 as "12,345"
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByText("987,654")).toBeInTheDocument();
    expect(screen.getByText("unlimited")).toBeInTheDocument();
    // limitReached false → "No"
    expect(screen.getByText(/^No$/)).toBeInTheDocument();
  });

  it("still renders KPI cards when wordsUsed=0 (UI-SPEC: empty is N/A)", async () => {
    clientFetchMock.mockResolvedValue({
      wordsUsed: 0,
      wordsRemaining: 999_999_999,
      plan: "unlimited",
      limitReached: false,
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-words-used")).toBeInTheDocument();
    });
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders limitReached=true as 'Yes'", async () => {
    clientFetchMock.mockResolvedValue({
      wordsUsed: 1_000_000,
      wordsRemaining: 0,
      plan: "free",
      limitReached: true,
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-limit-reached")).toBeInTheDocument();
    });
    expect(screen.getByText(/^Yes$/)).toBeInTheDocument();
  });

  it("renders Alert on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load usage/i)).toBeInTheDocument();
    });
  });

  it("clicking Retry refetches usage", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    let attempt = 0;
    clientFetchMock.mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({
        wordsUsed: 1,
        wordsRemaining: 2,
        plan: "unlimited",
        limitReached: false,
      });
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load usage/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => {
      expect(clientFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders em-dash when wordsUsed is not finite (formatNumber fallback)", async () => {
    clientFetchMock.mockResolvedValue({
      wordsUsed: Number.NaN,
      wordsRemaining: Number.POSITIVE_INFINITY,
      plan: "unlimited",
      limitReached: false,
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-words-used")).toBeInTheDocument();
    });
    // Two non-finite values → two em-dashes
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("clicking Refresh invalidates usage query", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockResolvedValue({
      wordsUsed: 1,
      wordsRemaining: 2,
      plan: "unlimited",
      limitReached: false,
    });
    renderWithProviders(<UsageDashboardClient />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-words-used")).toBeInTheDocument();
    });
    const before = clientFetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(clientFetchMock.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
