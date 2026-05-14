// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 10 — U10 NotesSearchClient unit tests (RED→GREEN).
//
// D-API: search is POST /api/notes/search (verified Plan 01) — NOT GET.
//
// Surface verified:
//   - Empty-type copy when q is empty or < 2 chars (query gated)
//   - useQuery is DISABLED while q.length < 2 — no fetch issued
//   - useQuery is ENABLED with q.length >= 2 — fetch issued with POST + body
//   - Empty-none copy when q is non-empty but result list is []
//   - Result rows render with score badge formatted to 2 decimals
//   - Error Alert on rejected search
//   - reading initial q from useSearchParams seeds the input
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

let currentSearchParams = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/notes/search",
  useSearchParams: () => currentSearchParams,
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

import { NotesSearchClient } from "../NotesSearchClient";

const resources = {
  "end-user": {
    "end-user": {
      "notes-search": {
        title: { heading: { text: "Search notes" } },
        action: { clear: { label: "Clear" }, submit: { label: "Search" } },
        empty: {
          none: { text: "No notes match this query." },
          type: { text: "Type a query to search your notes." },
        },
        error: { title: { text: "Search failed" }, retry: { label: "Retry" } },
        input: { placeholder: { text: "Search your notes" } },
        result: { score: { label: "Score" } },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeResult(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    client_note_id: null,
    title: "Roadmap notes",
    content: "Q3 plan",
    enhanced_content: null,
    note_type: "personal",
    enhancement_prompt: null,
    source_file: null,
    audio_duration_seconds: null,
    folder_id: null,
    transcript: null,
    enhanced_at_content_hash: null,
    participants: null,
    calendar_event_id: null,
    diarization_enabled: null,
    expected_speaker_count: null,
    deleted_at: null,
    created_at: "2026-05-12T10:00:00.000Z",
    updated_at: "2026-05-12T10:00:00.000Z",
    score: 0.42367,
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

describe("NotesSearchClient (Phase 07.1 / Plan 10)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    currentSearchParams = new URLSearchParams("");
  });

  it("renders empty-type copy when q is empty", () => {
    renderWithProviders(<NotesSearchClient />);
    expect(screen.getByText(/Type a query to search your notes/i)).toBeInTheDocument();
  });

  it("does NOT call clientFetch while q is empty (query disabled)", async () => {
    renderWithProviders(<NotesSearchClient />);
    await new Promise((r) => setTimeout(r, 50));
    expect(clientFetchMock).not.toHaveBeenCalled();
  });

  it("does NOT call clientFetch while q.length < 2 (gated)", async () => {
    currentSearchParams = new URLSearchParams("q=a");
    renderWithProviders(<NotesSearchClient />);
    await new Promise((r) => setTimeout(r, 50));
    expect(clientFetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /api/notes/search with body { query, limit: 20 } once q.length >= 2", async () => {
    currentSearchParams = new URLSearchParams("q=roadmap");
    clientFetchMock.mockResolvedValue({ notes: [makeResult({ title: "Roadmap notes" })] });
    renderWithProviders(<NotesSearchClient />);
    await waitFor(() => {
      const call = clientFetchMock.mock.calls.find((c) => c[0] === "/api/notes/search");
      expect(call).toBeDefined();
      expect(call?.[1]?.method).toBe("POST");
      const body = call?.[1]?.body as { query?: string; limit?: number };
      expect(body.query).toBe("roadmap");
      expect(body.limit).toBe(20);
    });
  });

  it("renders empty-none copy when q is non-empty and result is []", async () => {
    currentSearchParams = new URLSearchParams("q=nothingmatches");
    clientFetchMock.mockResolvedValue({ notes: [] });
    renderWithProviders(<NotesSearchClient />);
    await waitFor(() => {
      expect(screen.getByText(/No notes match this query/i)).toBeInTheDocument();
    });
  });

  it("renders result rows with score badge formatted to 2 decimals", async () => {
    currentSearchParams = new URLSearchParams("q=roadmap");
    clientFetchMock.mockResolvedValue({
      notes: [makeResult({ title: "Roadmap notes", score: 0.42367 })],
    });
    renderWithProviders(<NotesSearchClient />);
    await waitFor(() => {
      expect(screen.getByText("Roadmap notes")).toBeInTheDocument();
      expect(screen.getByText("0.42")).toBeInTheDocument();
    });
  });

  it("renders error Alert on rejected search", async () => {
    currentSearchParams = new URLSearchParams("q=roadmap");
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<NotesSearchClient />);
    await waitFor(() => {
      expect(screen.getByText(/Search failed/i)).toBeInTheDocument();
    });
  });

  it("submitting the form pushes /app/notes/search?q=<encoded>", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const pushMock = vi.fn();
    const navMod = await import("next/navigation");
    vi.spyOn(navMod, "useRouter").mockReturnValue({
      push: pushMock,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof navMod.useRouter>);
    renderWithProviders(<NotesSearchClient />);
    const input = screen.getByRole("searchbox");
    await user.type(input, "tea time");
    const submit = screen.getByRole("button", { name: /^Search$/i });
    await user.click(submit);
    await waitFor(() => {
      const urls = pushMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("q=tea%20time"))).toBe(true);
    });
  });

  it("Clear button resets the input and pushes /app/notes/search", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    currentSearchParams = new URLSearchParams("q=preset");
    clientFetchMock.mockResolvedValue({ notes: [] });
    const pushMock = vi.fn();
    const navMod = await import("next/navigation");
    vi.spyOn(navMod, "useRouter").mockReturnValue({
      push: pushMock,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof navMod.useRouter>);
    renderWithProviders(<NotesSearchClient />);
    const clear = screen.getByRole("button", { name: /^Clear$/i });
    await user.click(clear);
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/notes/search");
    });
  });

  it("submitting an empty input pushes /app/notes/search (no q param)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const pushMock = vi.fn();
    const navMod = await import("next/navigation");
    vi.spyOn(navMod, "useRouter").mockReturnValue({
      push: pushMock,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof navMod.useRouter>);
    renderWithProviders(<NotesSearchClient />);
    const submit = screen.getByRole("button", { name: /^Search$/i });
    await user.click(submit);
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/notes/search");
    });
  });

  it("renders Skeleton while query is pending", async () => {
    currentSearchParams = new URLSearchParams("q=roadmap");
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<NotesSearchClient />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="notes-search-skeleton"]')).not.toBeNull();
    });
  });

  it("seeds the input from useSearchParams q", () => {
    currentSearchParams = new URLSearchParams("q=preset");
    clientFetchMock.mockResolvedValue({ notes: [] });
    renderWithProviders(<NotesSearchClient />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("preset");
  });
});
