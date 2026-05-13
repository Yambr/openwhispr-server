// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 11 — U11 conversations-list Client component tests (RED→GREEN).
//
// Surface verified:
//   - Skeleton rows on isPending
//   - Empty-state card on items=[]
//   - Table with N rows on success (col-created, col-title, col-updated)
//   - Error Alert with retry on error
//   - Load-more visible when items.length >= PAGE_LIMIT
//   - Row Delete → AlertDialog confirm → DELETE /api/conversations/delete + invalidate.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/conversations",
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

import { ConversationsListClient } from "../ConversationsListClient";

const resources = {
  "end-user": {
    "end-user": {
      "conv-list": {
        title: { heading: { text: "Conversations" } },
        subtitle: { body: { text: "LLM chats started from the desktop client." } },
        nav: { sidebar: { label: "Conversations" } },
        table: {
          "col-created": { label: "Created" },
          "col-title": { label: "Title" },
          "col-updated": { label: "Updated" },
        },
        row: { "action-delete": { label: "Delete" } },
        action: {
          loadmore: { label: "Load more" },
          search: { label: "Search conversations" },
        },
        empty: {
          title: { text: "No conversations yet" },
          body: { text: "Start a chat in the desktop client to see it here." },
        },
        error: {
          title: { text: "Could not load conversations" },
          retry: { label: "Retry" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    client_conversation_id: null,
    title: "Plan Q2 roadmap",
    archived_at: null,
    deleted_at: null,
    created_at: "2026-05-12T10:00:00.000Z",
    updated_at: "2026-05-12T11:00:00.000Z",
    ...over,
  };
}

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

describe("ConversationsListClient (Phase 07.1 / Plan 11)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
  });

  it("renders Skeleton rows while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<ConversationsListClient />);
    expect(
      container.querySelectorAll('[data-testid="conv-list-skeleton-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders empty-state when API returns []", async () => {
    clientFetchMock.mockResolvedValue({ conversations: [] });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
    });
  });

  it("renders a table row per returned conversation on success", async () => {
    clientFetchMock.mockResolvedValue({
      conversations: [
        makeRow({ id: "11111111-1111-1111-1111-111111111111", title: "first" }),
        makeRow({ id: "22222222-2222-2222-2222-222222222222", title: "second" }),
        makeRow({ id: "33333333-3333-3333-3333-333333333333", title: "third" }),
      ],
    });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
      expect(screen.getByText("third")).toBeInTheDocument();
    });
  });

  it("renders error Alert on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load conversations/i)).toBeInTheDocument();
    });
  });

  it("does NOT render Load-more when fewer than limit rows returned", async () => {
    clientFetchMock.mockResolvedValue({ conversations: [makeRow()] });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
    });
  });

  it("renders Load-more when items.length >= PAGE_LIMIT", async () => {
    const rows = Array.from({ length: 20 }).map((_, i) =>
      makeRow({
        id: `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
        title: `row ${i}`,
      }),
    );
    clientFetchMock.mockResolvedValue({ conversations: rows });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Load more/i })).toBeInTheDocument();
    });
  });

  it("clicking error Retry refetches", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    let attempt = 0;
    clientFetchMock.mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({ conversations: [] });
    });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load conversations/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    expect(clientFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("renders empty title placeholder when row title is blank", async () => {
    clientFetchMock.mockResolvedValue({
      conversations: [makeRow({ title: "" })],
    });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("clicking row Delete fires DELETE /api/conversations/delete with body { id }", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/conversations/list")) {
        return Promise.resolve({
          conversations: [makeRow({ id: "11111111-1111-1111-1111-111111111111" })],
        });
      }
      if (url === "/api/conversations/delete" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    renderWithProviders(<ConversationsListClient />);
    await waitFor(() => {
      expect(screen.getByText("Plan Q2 roadmap")).toBeInTheDocument();
    });
    const deleteBtn = await screen.findByRole("button", { name: /^Delete$/i });
    await user.click(deleteBtn);
    const confirms = await screen.findAllByRole("button", { name: /^Delete$|^Confirm$/i });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some(
        (c) =>
          c[0] === "/api/conversations/delete" &&
          c[1]?.method === "DELETE" &&
          JSON.stringify(c[1]?.body).includes("11111111-1111-1111-1111-111111111111"),
      );
      expect(found).toBe(true);
    });
  });
});
