// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 10 — U8 NotesListClient unit tests (RED→GREEN).
//
// Surface verified:
//   - Skeleton rows on isPending
//   - Empty card when API returns []
//   - Table renders one row per CloudNote with Title / Folder / Words / Created
//   - Folder column resolves the folder name from the parallel useQuery folders cache
//   - Error Alert on rejected list fetch
//   - Load-more visible only when items.length >= PAGE_LIMIT
//   - Row Delete triggers DELETE /api/notes/delete with body { id }
//   - Top search bar navigates to /app/notes/search?q=<encoded>
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/notes",
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

import { NotesListClient } from "../NotesListClient";

const resources = {
  "end-user": {
    "end-user": {
      "notes-list": {
        title: { heading: { text: "Notes" } },
        subtitle: { body: { text: "Notes recorded with the desktop client." } },
        nav: { sidebar: { label: "Notes" } },
        table: {
          "col-created": { label: "Created" },
          "col-folder": { label: "Folder" },
          "col-title": { label: "Title" },
          "col-words": { label: "Words" },
        },
        row: { "action-delete": { label: "Delete" } },
        action: { loadmore: { label: "Load more" }, search: { label: "Search notes" } },
        empty: {
          title: { text: "No notes yet" },
          body: { text: "Record a note in the desktop client to see it here." },
        },
        error: { title: { text: "Could not load notes" }, retry: { label: "Retry" } },
        folders: {
          title: { label: "Folders" },
          "readonly-body": { text: "Folder management is in the desktop client." },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeNote(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    client_note_id: null,
    title: "Note title",
    content: "body",
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

function mockBoth(notes: unknown[], folders: unknown[] = []): void {
  clientFetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/notes/list")) return Promise.resolve({ notes });
    if (url.startsWith("/api/folders/list")) return Promise.resolve({ folders });
    if (url === "/api/notes/delete") return Promise.resolve({ ok: true });
    return Promise.reject(new Error(`unexpected: ${url}`));
  });
}

describe("NotesListClient (Phase 07.1 / Plan 10)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    pushMock.mockReset();
    currentSearchParams = new URLSearchParams("");
  });

  it("renders Skeleton rows while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<NotesListClient />);
    expect(
      container.querySelectorAll('[data-testid="notes-list-skeleton-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders empty state when API returns []", async () => {
    mockBoth([]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText(/No notes yet/i)).toBeInTheDocument();
    });
  });

  it("renders one row per returned note", async () => {
    mockBoth([
      makeNote({ id: "11111111-1111-1111-1111-111111111111", title: "alpha" }),
      makeNote({ id: "22222222-2222-2222-2222-222222222222", title: "beta" }),
    ]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("beta")).toBeInTheDocument();
    });
  });

  it("resolves folder name from folders cache in the row", async () => {
    mockBoth(
      [
        makeNote({
          id: "11111111-1111-1111-1111-111111111111",
          title: "with folder",
          folder_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        }),
      ],
      [{ id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Work" }],
    );
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      // "Work" appears in both the sidebar (folders list) AND the table
      // row's Folder column — exactly 2 occurrences prove the table cell
      // resolved the folder_id → name via the folders cache.
      expect(screen.getAllByText("Work")).toHaveLength(2);
    });
  });

  it("renders error Alert on rejected fetch", async () => {
    clientFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/notes/list")) return Promise.reject(new Error("boom"));
      return Promise.resolve({ folders: [] });
    });
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load notes/i)).toBeInTheDocument();
    });
  });

  it("does NOT render Load-more when fewer than limit rows returned", async () => {
    mockBoth([makeNote({ id: "11111111-1111-1111-1111-111111111111" })]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
    });
  });

  it("renders Load-more when items.length >= PAGE_LIMIT (20)", async () => {
    const rows = Array.from({ length: 20 }).map((_, i) =>
      makeNote({
        id: `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
        title: `row ${i}`,
      }),
    );
    mockBoth(rows);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Load more/i })).toBeInTheDocument();
    });
  });

  it("clicking row Delete calls DELETE /api/notes/delete with body { id }", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    mockBoth([makeNote({ id: "11111111-1111-1111-1111-111111111111", title: "kill me" })]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("kill me")).toBeInTheDocument();
    });
    const deleteBtn = await screen.findByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);
    const confirm = await screen.findByRole("button", { name: /Confirm|Delete$/i });
    await user.click(confirm);
    await waitFor(() => {
      const found = clientFetchMock.mock.calls.some(
        (c) =>
          c[0] === "/api/notes/delete" &&
          c[1]?.method === "DELETE" &&
          JSON.stringify(c[1]?.body).includes("11111111-1111-1111-1111-111111111111"),
      );
      expect(found).toBe(true);
    });
  });

  it("filters rendered rows by ?folder= search param", async () => {
    currentSearchParams = new URLSearchParams("folder=ffffffff-ffff-ffff-ffff-ffffffffffff");
    mockBoth(
      [
        makeNote({
          id: "11111111-1111-1111-1111-111111111111",
          title: "match",
          folder_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        }),
        makeNote({
          id: "22222222-2222-2222-2222-222222222222",
          title: "other",
          folder_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        }),
      ],
      [
        { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Picked" },
        { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: "Other" },
      ],
    );
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("match")).toBeInTheDocument();
    });
    expect(screen.queryByText("other")).not.toBeInTheDocument();
  });

  it("submitting empty search does NOT navigate", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    mockBoth([]);
    renderWithProviders(<NotesListClient />);
    const submit = await screen.findByRole("button", { name: /Search notes/i });
    await user.click(submit);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders '(untitled)' for notes with null title and em-dash for missing folder", async () => {
    mockBoth([
      makeNote({
        id: "11111111-1111-1111-1111-111111111111",
        title: null,
        folder_id: null,
        created_at: "",
      }),
    ]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("(untitled)")).toBeInTheDocument();
    });
    // Per-row em-dash cells: folder (folder_id=null) + date (created_at="")
    // → exactly 2 em-dashes for the single row.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("renders folder em-dash when folder_id has no match in folders cache", async () => {
    mockBoth(
      [
        makeNote({
          id: "11111111-1111-1111-1111-111111111111",
          title: "orphan",
          folder_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        }),
      ],
      [],
    );
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("orphan")).toBeInTheDocument();
    });
    // No folder match → exactly 1 em-dash for the folder cell (created_at
    // is a valid ISO from makeNote so the date column renders the formatted
    // value, not "—").
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("falls back to created_at as-is when Date parsing throws", async () => {
    mockBoth([
      makeNote({
        id: "11111111-1111-1111-1111-111111111111",
        title: "bad-date",
        // Invalid date string forces toISOString to throw → catch branch.
        created_at: "not-a-real-date",
      }),
    ]);
    renderWithProviders(<NotesListClient />);
    await waitFor(() => {
      expect(screen.getByText("not-a-real-date")).toBeInTheDocument();
    });
  });

  it("error Retry button refetches the query", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    let fail = true;
    clientFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/notes/list")) {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("boom"));
        }
        return Promise.resolve({ notes: [] });
      }
      return Promise.resolve({ folders: [] });
    });
    renderWithProviders(<NotesListClient />);
    const retry = await screen.findByRole("button", { name: /Retry/i });
    await user.click(retry);
    await waitFor(() => {
      expect(screen.getByText(/No notes yet/i)).toBeInTheDocument();
    });
  });

  it("typing into the top search bar and submitting navigates to /app/notes/search?q=", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    mockBoth([]);
    renderWithProviders(<NotesListClient />);
    const input = await screen.findByRole("searchbox");
    await user.type(input, "roadmap{Enter}");
    await waitFor(() => {
      const calls = pushMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("/app/notes/search") && u.includes("q=roadmap"))).toBe(
        true,
      );
    });
  });
});
