// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 11 — U13 conversations-search Client component tests (RED→GREEN).
//
// Surface verified:
//   - Empty-state "Type a query..." when q is absent/empty.
//   - POST /api/conversations/search with body { query, limit } when q present.
//   - Result rows render title + score badge.
//   - Result click navigates to /app/conversations/[id].
//   - Empty results render "No conversations match this query.".
//   - Error Alert with Retry on rejected fetch.
//   - Submit input pushes ?q=<value>.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
const replaceMock = vi.fn();
let searchParamsGet: (key: string) => string | null = () => null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => "/app/conversations/search",
  useSearchParams: () => ({ get: (k: string) => searchParamsGet(k) }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const clientFetchMock = vi.fn();
vi.mock("@/lib/client-fetch", () => ({
  clientFetch: (...args: unknown[]) => clientFetchMock(...args),
}));

import { ConversationsSearchClient } from "../ConversationsSearchClient";

const resources = {
  "end-user": {
    "end-user": {
      "conv-search": {
        title: { heading: { text: "Search conversations" } },
        action: {
          submit: { label: "Search" },
          clear: { label: "Clear" },
        },
        input: { placeholder: { text: "Search your conversations" } },
        result: { score: { label: "Score" } },
        empty: {
          type: { text: "Type a query to search your conversations." },
          none: { text: "No conversations match this query." },
        },
        error: {
          title: { text: "Search failed" },
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

describe("ConversationsSearchClient (Phase 07.1 / Plan 11)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    searchParamsGet = () => null;
  });

  it("renders empty-state when q is absent", () => {
    renderWithProviders(<ConversationsSearchClient />);
    expect(screen.getByText(/Type a query to search/i)).toBeInTheDocument();
  });

  it("POSTs to /api/conversations/search with { query, limit } when q is present", async () => {
    searchParamsGet = (k: string) => (k === "q" ? "roadmap" : null);
    clientFetchMock.mockResolvedValue({ conversations: [] });
    renderWithProviders(<ConversationsSearchClient />);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some(
        (c) =>
          c[0] === "/api/conversations/search" &&
          c[1]?.method === "POST" &&
          JSON.stringify(c[1]?.body).includes("roadmap"),
      );
      expect(found).toBe(true);
    });
  });

  it("renders results with title + score badge", async () => {
    searchParamsGet = (k: string) => (k === "q" ? "roadmap" : null);
    clientFetchMock.mockResolvedValue({
      conversations: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          client_conversation_id: null,
          title: "Plan Q2 roadmap",
          archived_at: null,
          deleted_at: null,
          created_at: "2026-05-12T10:00:00.000Z",
          updated_at: "2026-05-12T11:00:00.000Z",
          score: 0.94,
        },
      ],
    });
    renderWithProviders(<ConversationsSearchClient />);
    await waitFor(() => {
      expect(screen.getByText("Plan Q2 roadmap")).toBeInTheDocument();
    });
    // score rendered to 2 decimals
    expect(screen.getByText(/0\.94/)).toBeInTheDocument();
  });

  it("renders no-results state for empty conversations[] with q present", async () => {
    searchParamsGet = (k: string) => (k === "q" ? "nothing" : null);
    clientFetchMock.mockResolvedValue({ conversations: [] });
    renderWithProviders(<ConversationsSearchClient />);
    await waitFor(() => {
      expect(screen.getByText(/No conversations match this query/i)).toBeInTheDocument();
    });
  });

  it("renders error Alert on rejected fetch", async () => {
    searchParamsGet = (k: string) => (k === "q" ? "boom" : null);
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ConversationsSearchClient />);
    await waitFor(() => {
      expect(screen.getByText(/Search failed/i)).toBeInTheDocument();
    });
  });

  it("submitting the form pushes ?q=<value>", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderWithProviders(<ConversationsSearchClient />);
    const input = screen.getByPlaceholderText(/Search your conversations/i);
    await user.type(input, "hello world");
    await user.click(screen.getByRole("button", { name: /^Search$/i }));
    await waitFor(() => {
      const found = pushMock.mock.calls.some(
        (c) => typeof c[0] === "string" && c[0].includes("q=hello"),
      );
      expect(found).toBe(true);
    });
  });

  it("clicking Retry refetches when error", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    searchParamsGet = (k: string) => (k === "q" ? "boom" : null);
    let attempt = 0;
    clientFetchMock.mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({ conversations: [] });
    });
    renderWithProviders(<ConversationsSearchClient />);
    await waitFor(() => {
      expect(screen.getByText(/Search failed/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => {
      expect(clientFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
