// Phase 07.1 / Plan 09 — U7 transcription-detail Client component tests (RED→GREEN).
//
// Surface verified:
//   - Renders flat paragraphs (split text by /\n\s*\n/) — D-API1 constitutional.
//     Hard assertion: NO timecode pattern (mm:ss) appears in the rendered body.
//   - Metadata sidebar fields: word_count, audio_duration_ms (formatted),
//     provider, model, language, status, created_at.
//   - Copy button uses navigator.clipboard.writeText + sonner toast.
//   - Export JSON / Export Markdown produce client-side Blob URLs (anchor.click).
//   - Delete triggers DELETE /api/transcriptions/delete + router.push.
//   - Empty-state "not found" UI when target id is not in the list result.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/transcriptions/11111111-1111-1111-1111-111111111111",
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

import { TranscriptionDetailClient } from "../TranscriptionDetailClient";

const TID = "11111111-1111-1111-1111-111111111111";

const resources = {
  "end-user": {
    "end-user": {
      "trx-detail": {
        title: { heading: { text: "Transcription" } },
        action: {
          back: { label: "Back to list" },
          copy: { label: "Copy" },
          delete: { label: "Delete" },
          "export-json": { label: "Export as JSON" },
          "export-md": { label: "Export as Markdown" },
        },
        empty: {
          title: { text: "Transcription not found" },
          body: { text: "This transcription does not exist or was deleted." },
        },
        error: {
          title: { text: "Could not load transcription" },
          retry: { label: "Retry" },
        },
        metadata: {
          title: { label: "Details" },
          created: { label: "Created" },
          duration: { label: "Audio duration" },
          language: { label: "Language" },
          model: { label: "Model" },
          provider: { label: "Provider" },
          status: { label: "Status" },
          words: { label: "Word count" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: TID,
    client_transcription_id: null,
    text: "First paragraph one two three.\n\nSecond paragraph four five.\n\nThird paragraph six seven.",
    raw_text:
      "First paragraph one two three.\n\nSecond paragraph four five.\n\nThird paragraph six seven.",
    word_count: 12,
    source: "desktop",
    provider: "openai",
    model: "whisper-1",
    language: "en",
    audio_duration_ms: 125_000,
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

describe("TranscriptionDetailClient (Phase 07.1 / Plan 09)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    toastSuccessMock.mockReset();
    pushMock.mockReset();
  });

  it("renders flat paragraphs split on blank lines (D-API1: NO timecodes)", async () => {
    clientFetchMock.mockResolvedValue({ transcriptions: [makeRow()] });
    const { container } = renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/First paragraph/i)).toBeInTheDocument();
      expect(screen.getByText(/Second paragraph/i)).toBeInTheDocument();
      expect(screen.getByText(/Third paragraph/i)).toBeInTheDocument();
    });
    // D-API1: NO timecode pattern in transcript body.
    const body = container.textContent ?? "";
    // Strip "Audio duration 02:05" sidebar label content (mm:ss formatted metadata is OK
    // in the sidebar; what's banned is timecodes inside transcript paragraphs).
    const paragraphs = Array.from(container.querySelectorAll('[data-testid="trx-paragraph"]'))
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(paragraphs).not.toMatch(/\d{1,2}:\d{2}/);
    expect(body).toContain("First paragraph");
  });

  it("renders metadata sidebar fields", async () => {
    clientFetchMock.mockResolvedValue({ transcriptions: [makeRow()] });
    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      // Word count value
      expect(screen.getByText("12")).toBeInTheDocument();
      // Provider / model / language / status
      expect(screen.getByText(/openai/i)).toBeInTheDocument();
      expect(screen.getByText(/whisper-1/i)).toBeInTheDocument();
      expect(screen.getByText(/^en$/i)).toBeInTheDocument();
      expect(screen.getByText(/^completed$/i)).toBeInTheDocument();
    });
  });

  it("renders empty-state when target id is not in any page", async () => {
    clientFetchMock.mockResolvedValue({ transcriptions: [] });
    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/Transcription not found/i)).toBeInTheDocument();
    });
  });

  it("renders error Alert on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load transcription/i)).toBeInTheDocument();
    });
  });

  it("Copy button writes transcript text to clipboard + fires sonner success toast", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    clientFetchMock.mockResolvedValue({ transcriptions: [makeRow()] });
    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/First paragraph/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Copy$/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalled();
    });
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg).toContain("First paragraph");
  });

  it("Export JSON triggers a Blob download with application/json mime", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockResolvedValue({ transcriptions: [makeRow()] });

    const createObjectURL = vi.fn().mockReturnValue("blob:json");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/First paragraph/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Export as JSON/i }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/json");

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("Export Markdown triggers a Blob download with text/markdown mime", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockResolvedValue({ transcriptions: [makeRow()] });

    const createObjectURL = vi.fn().mockReturnValue("blob:md");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/First paragraph/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Export as Markdown/i }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/markdown");

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("Delete confirm fires DELETE and routes to /app/transcriptions", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/transcriptions/list")) {
        return Promise.resolve({ transcriptions: [makeRow()] });
      }
      if (url === "/api/transcriptions/delete" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    renderWithProviders(<TranscriptionDetailClient transcriptionId={TID} />);
    await waitFor(() => {
      expect(screen.getByText(/First paragraph/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    const confirm = await screen.findByRole("button", { name: /Confirm|Delete$/i });
    // The confirm dialog has its own "Delete" button — pick the LAST one (in the dialog).
    const confirms = screen.getAllByRole("button", { name: /^Delete$|^Confirm$/i });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some(
        (c) => c[0] === "/api/transcriptions/delete" && c[1]?.method === "DELETE",
      );
      expect(found).toBe(true);
      expect(pushMock).toHaveBeenCalledWith("/app/transcriptions");
    });
  });
});
