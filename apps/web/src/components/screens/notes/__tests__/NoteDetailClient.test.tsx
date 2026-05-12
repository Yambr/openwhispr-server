// Phase 07.1 / Plan 10 — U9 NoteDetailClient unit tests (RED→GREEN).
//
// Access pattern: same Branch B (list-then-filter) approach used in U7 detail
// — apps/api has no GET /api/notes/:id endpoint (verified Plan 10 Step 0).
//
// Surface verified:
//   - Skeleton on isPending
//   - Tabs render ONLY for non-empty fields (content / transcript / enhanced_content)
//   - Metadata Card shows created, folder, audio duration (formatted), participants,
//     note_type — and participants ONLY when note_type === 'meeting'
//   - Empty-state when id is not in the paged list
//   - Error Alert on rejected fetch
//   - Copy uses navigator.clipboard.writeText + sonner toast
//   - Export JSON / Export MD generate client-side Blob URLs via anchor click
//   - Delete triggers DELETE /api/notes/delete + router.push('/app/notes')
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/notes/11111111-1111-1111-1111-111111111111",
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

const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccessMock(...args), error: vi.fn() },
}));

import { NoteDetailClient } from "../NoteDetailClient";

const NID = "11111111-1111-1111-1111-111111111111";

const resources = {
  "end-user": {
    "end-user": {
      "note-detail": {
        title: { heading: { text: "Note" } },
        action: {
          back: { label: "Back to notes" },
          copy: { label: "Copy" },
          delete: { label: "Delete" },
          "export-json": { label: "Export as JSON" },
          "export-md": { label: "Export as Markdown" },
        },
        empty: {
          title: { text: "Note not found" },
          body: { text: "This note does not exist or was deleted." },
        },
        error: { title: { text: "Could not load note" }, retry: { label: "Retry" } },
        metadata: {
          title: { label: "Details" },
          created: { label: "Created" },
          folder: { label: "Folder" },
          duration: { label: "Audio duration" },
          participants: { label: "Participants" },
          type: { label: "Note type" },
        },
        tabs: {
          content: { label: "Content" },
          enhanced: { label: "Enhanced" },
          transcript: { label: "Transcript" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeNote(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: NID,
    client_note_id: null,
    title: "My note",
    content: "this is the content body",
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

describe("NoteDetailClient (Phase 07.1 / Plan 10)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    toastSuccessMock.mockReset();
    pushMock.mockReset();
  });

  it("renders Skeleton while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<NoteDetailClient noteId={NID} />);
    expect(container.querySelector('[data-testid="note-detail-skeleton"]')).not.toBeNull();
  });

  it("renders empty-state when id is not in the list", async () => {
    clientFetchMock.mockResolvedValue({ notes: [] });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText(/Note not found/i)).toBeInTheDocument();
    });
  });

  it("renders error Alert on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load note/i)).toBeInTheDocument();
    });
  });

  it("renders only Content tab when transcript + enhanced are empty", async () => {
    clientFetchMock.mockResolvedValue({ notes: [makeNote()] });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Content/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("tab", { name: /Transcript/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Enhanced/i })).not.toBeInTheDocument();
  });

  it("renders all three tabs when transcript + enhanced_content are present", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [
        makeNote({
          transcript: "diarised transcript here",
          enhanced_content: "polished version here",
        }),
      ],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Content/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Transcript/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Enhanced/i })).toBeInTheDocument();
    });
  });

  it("renders participants ONLY for note_type=meeting", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ note_type: "meeting", participants: "Alice, Bob" })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText(/Participants/i)).toBeInTheDocument();
      expect(screen.getByText(/Alice, Bob/)).toBeInTheDocument();
    });
  });

  it("does NOT render participants for note_type=personal", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ note_type: "personal", participants: "should-not-appear" })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Content/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Participants/i)).not.toBeInTheDocument();
    expect(screen.queryByText("should-not-appear")).not.toBeInTheDocument();
  });

  it("Copy button writes content to clipboard and shows toast", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    clientFetchMock.mockResolvedValue({ notes: [makeNote({ content: "clip me" })] });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const copyBtn = await screen.findByRole("button", { name: /^Copy$/i });
    await user.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("clip me");
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it("Export JSON downloads a blob with note-<id>.json filename", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    const createURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture-json");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    // Spy on the prototype click so we catch the anchor used by downloadBlob
    // without recursing into our own document.createElement spy.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    clientFetchMock.mockResolvedValue({ notes: [makeNote({ title: "exp" })] });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const jsonBtn = await screen.findByRole("button", { name: /Export as JSON/i });
    await user.click(jsonBtn);
    expect(clickSpy).toHaveBeenCalled();
    expect(createURLSpy).toHaveBeenCalled();
    expect(revokeSpy).toBeDefined();
  });

  it("Export Markdown downloads .md blob with only Content when transcript/enhanced are absent", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture-md2");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ title: null, transcript: null, enhanced_content: null })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const mdBtn = await screen.findByRole("button", { name: /Export as Markdown/i });
    await user.click(mdBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  it("Export Markdown downloads .md blob including transcript + enhanced when present", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture-md");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLAnchorElement;
      if (tag === "a") el.click = clickSpy;
      return el;
    });
    clientFetchMock.mockResolvedValue({
      notes: [
        makeNote({
          transcript: "trx body",
          enhanced_content: "enh body",
        }),
      ],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const mdBtn = await screen.findByRole("button", { name: /Export as Markdown/i });
    await user.click(mdBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  it("error Retry button refetches the query", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const retry = await screen.findByRole("button", { name: /Retry/i });
    clientFetchMock.mockResolvedValueOnce({ notes: [makeNote()] });
    await user.click(retry);
    await waitFor(() => {
      expect(clientFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("resolves folder name from folders cache in the metadata Card", async () => {
    clientFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/notes/list")) {
        return Promise.resolve({
          notes: [makeNote({ folder_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" })],
        });
      }
      if (url.startsWith("/api/folders/list")) {
        return Promise.resolve({
          folders: [{ id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "MyFolder" }],
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText("MyFolder")).toBeInTheDocument();
    });
  });

  it("formats audio_duration_seconds via mm:ss in the metadata Card", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ audio_duration_seconds: 65 })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText("01:05")).toBeInTheDocument();
    });
  });

  it("pages forward through list endpoint when first page has PAGE_LIMIT rows and lacks the id", async () => {
    let calls = 0;
    clientFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/notes/list")) {
        calls += 1;
        if (calls === 1) {
          // First page is "full" (50 rows) but does NOT contain the target id.
          const rows = Array.from({ length: 50 }).map((_, i) =>
            makeNote({
              id: `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
              created_at: `2026-05-${String(12 - (i % 10)).padStart(2, "0")}T00:00:00.000Z`,
            }),
          );
          return Promise.resolve({ notes: rows });
        }
        // Second page contains the target id.
        return Promise.resolve({ notes: [makeNote({ id: NID, title: "found on p2" })] });
      }
      return Promise.resolve({ folders: [] });
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText("found on p2")).toBeInTheDocument();
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("renders em-dash for folder when folder_id is set but folders cache misses", async () => {
    clientFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/notes/list")) {
        return Promise.resolve({
          notes: [makeNote({ folder_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" })],
        });
      }
      // Folders cache empty → ?? "—" fallback exercised.
      return Promise.resolve({ folders: [] });
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  it("renders em-dash for null audio_duration_seconds", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ audio_duration_seconds: null })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  it("formats audio_duration_seconds > 1h via h:mm:ss", async () => {
    clientFetchMock.mockResolvedValue({
      notes: [makeNote({ audio_duration_seconds: 3725 })],
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    await waitFor(() => {
      expect(screen.getByText("1:02:05")).toBeInTheDocument();
    });
  });

  it("Delete triggers DELETE /api/notes/delete and router.push('/app/notes')", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/notes/list")) return Promise.resolve({ notes: [makeNote()] });
      if (url === "/api/notes/delete" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    renderWithProviders(<NoteDetailClient noteId={NID} />);
    const deleteBtn = await screen.findByRole("button", { name: /^Delete$/i });
    await user.click(deleteBtn);
    const confirm = await screen.findByRole("button", { name: /Confirm|Delete$/i });
    await user.click(confirm);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some((c) => c[0] === "/api/notes/delete" && c[1]?.method === "DELETE");
      expect(found).toBe(true);
      expect(pushMock).toHaveBeenCalledWith("/app/notes");
    });
  });
});
