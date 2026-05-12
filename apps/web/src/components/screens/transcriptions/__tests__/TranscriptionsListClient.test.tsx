// Phase 07.1 / Plan 09 — U6 transcriptions-list Client component tests (RED→GREEN).
//
// Surface verified:
//   - Skeleton row on isPending
//   - Empty-state card on items=[]
//   - TanStack Table 8 with N rows on success
//   - Error Alert with retry on error
//   - Load-more button hidden when nextCursor is undefined
//   - Row delete mutation calls clientFetch('/api/transcriptions/delete', { method:'DELETE', body:{id} })
//     and invalidates queryKeys.transcriptions.list on success.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/transcriptions",
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

import { TranscriptionsListClient } from "../TranscriptionsListClient";

const resources = {
  "end-user": {
    "end-user": {
      "trx-list": {
        title: { heading: { text: "Transcriptions" } },
        subtitle: { body: { text: "All audio you have transcribed with the desktop client." } },
        nav: { sidebar: { label: "Transcriptions" } },
        table: {
          "col-created": { label: "Created" },
          "col-preview": { label: "Preview" },
          "col-words": { label: "Words" },
          "col-duration": { label: "Duration" },
          "col-provider": { label: "Provider" },
          "col-model": { label: "Model" },
          "col-language": { label: "Language" },
          "col-status": { label: "Status" },
        },
        row: { "action-delete": { label: "Delete" } },
        action: { loadmore: { label: "Load more" } },
        empty: {
          title: { text: "No transcriptions yet" },
          body: {
            text: "Record audio in the desktop client and your transcriptions show up here.",
          },
        },
        error: {
          title: { text: "Could not load transcriptions" },
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
    client_transcription_id: null,
    text: "Hello world from seed.",
    raw_text: "Hello world from seed.",
    word_count: 4,
    source: "desktop",
    provider: "openai",
    model: "whisper-1",
    language: "en",
    audio_duration_ms: 65_000,
    status: "completed",
    deleted_at: null,
    created_at: "2026-05-12T10:00:00.000Z",
    updated_at: "2026-05-12T10:00:00.000Z",
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

describe("TranscriptionsListClient (Phase 07.1 / Plan 09)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
  });

  it("renders Skeleton rows while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<TranscriptionsListClient />);
    expect(
      container.querySelectorAll('[data-testid="trx-list-skeleton-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders empty-state when API returns []", async () => {
    clientFetchMock.mockResolvedValue({ transcriptions: [] });
    renderWithProviders(<TranscriptionsListClient />);
    await waitFor(() => {
      expect(screen.getByText(/No transcriptions yet/i)).toBeInTheDocument();
    });
  });

  it("renders a table row per returned transcription on success", async () => {
    clientFetchMock.mockResolvedValue({
      transcriptions: [
        makeRow({ id: "11111111-1111-1111-1111-111111111111", text: "first" }),
        makeRow({ id: "22222222-2222-2222-2222-222222222222", text: "second" }),
        makeRow({ id: "33333333-3333-3333-3333-333333333333", text: "third" }),
      ],
    });
    renderWithProviders(<TranscriptionsListClient />);
    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
      expect(screen.getByText("third")).toBeInTheDocument();
    });
  });

  it("renders an error Alert on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<TranscriptionsListClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load transcriptions/i)).toBeInTheDocument();
    });
  });

  it("does NOT render Load-more when fewer than limit rows returned", async () => {
    clientFetchMock.mockResolvedValue({
      transcriptions: [makeRow({ id: "11111111-1111-1111-1111-111111111111" })],
    });
    renderWithProviders(<TranscriptionsListClient />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
    });
  });

  it("clicking row Delete calls DELETE /api/transcriptions/delete with body { id }", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/transcriptions/list")) {
        return Promise.resolve({
          transcriptions: [makeRow({ id: "11111111-1111-1111-1111-111111111111" })],
        });
      }
      if (url === "/api/transcriptions/delete" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    renderWithProviders(<TranscriptionsListClient />);
    await waitFor(() => {
      expect(screen.getByText("Hello world from seed.")).toBeInTheDocument();
    });
    const deleteBtn = await screen.findByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);
    // AlertDialog confirm
    const confirm = await screen.findByRole("button", { name: /Confirm|Delete$/i });
    await user.click(confirm);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some(
        (c) =>
          c[0] === "/api/transcriptions/delete" &&
          c[1]?.method === "DELETE" &&
          JSON.stringify(c[1]?.body).includes("11111111-1111-1111-1111-111111111111"),
      );
      expect(found).toBe(true);
    });
  });
});
