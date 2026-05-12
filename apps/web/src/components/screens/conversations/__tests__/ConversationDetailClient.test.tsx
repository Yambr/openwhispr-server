// Phase 07.1 / Plan 11 — U12 conversation-detail Client component tests (RED→GREEN).
//
// Surface verified:
//   - Skeleton bubbles on isPending.
//   - Empty-state card "No messages" when API returns { messages: [] }.
//   - Message thread renders one MessageBubble per role with localised label.
//   - Roles user/assistant/system/tool render with distinct labels.
//   - "Load earlier messages" button visible when page is full; prepends older page.
//   - Copy transcript joins `### <role>\n<content>` and writes to clipboard.
//   - Export JSON triggers Blob with application/json mime.
//   - Delete fires DELETE /api/conversations/delete and routes to /app/conversations.
//   - Error Alert with Retry on rejected fetch.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/conversations/11111111-1111-1111-1111-111111111111",
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

import { ConversationDetailClient } from "../ConversationDetailClient";

const CID = "11111111-1111-1111-1111-111111111111";

const resources = {
  "end-user": {
    "end-user": {
      "conv-detail": {
        title: { heading: { text: "Conversation" } },
        action: {
          back: { label: "Back to conversations" },
          copy: { label: "Copy transcript" },
          delete: { label: "Delete conversation" },
          "export-json": { label: "Export as JSON" },
          loadearlier: { label: "Load earlier messages" },
        },
        empty: {
          title: { text: "No messages" },
          body: { text: "This conversation does not contain any messages yet." },
        },
        error: {
          title: { text: "Could not load conversation" },
          retry: { label: "Retry" },
        },
        role: {
          user: { label: "You" },
          assistant: { label: "Assistant" },
          system: { label: "System" },
          tool: { label: "Tool" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function makeMessage(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "msg-00000000-0000-0000-0000-000000000001",
    conversation_id: CID,
    role: "user",
    content: "Hello world",
    metadata: null,
    created_at: "2026-05-12T10:00:00.000Z",
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

describe("ConversationDetailClient (Phase 07.1 / Plan 11)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    toastSuccessMock.mockReset();
    pushMock.mockReset();
  });

  it("renders Skeleton bubbles while pending", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    expect(
      container.querySelectorAll('[data-testid="conv-detail-skeleton"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders empty-state card when API returns no messages", async () => {
    clientFetchMock.mockResolvedValue({ messages: [] });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText(/No messages/i)).toBeInTheDocument();
    });
  });

  it("renders all four role bubbles with localised labels (user/assistant/system/tool)", async () => {
    clientFetchMock.mockResolvedValue({
      messages: [
        makeMessage({ id: "m1", role: "user", content: "user content" }),
        makeMessage({ id: "m2", role: "assistant", content: "assistant content" }),
        makeMessage({ id: "m3", role: "system", content: "system content" }),
        makeMessage({ id: "m4", role: "tool", content: "tool content" }),
      ],
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText(/^You$/)).toBeInTheDocument();
      expect(screen.getByText(/^Assistant$/)).toBeInTheDocument();
      expect(screen.getByText(/^System$/)).toBeInTheDocument();
      expect(screen.getByText(/^Tool$/)).toBeInTheDocument();
    });
    expect(screen.getByText("user content")).toBeInTheDocument();
    expect(screen.getByText("assistant content")).toBeInTheDocument();
  });

  it("renders error Alert with retry on rejected fetch", async () => {
    clientFetchMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load conversation/i)).toBeInTheDocument();
    });
  });

  it("does NOT render Load-earlier when fewer than PAGE_LIMIT messages returned", async () => {
    clientFetchMock.mockResolvedValue({
      messages: [makeMessage()],
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Load earlier messages/i }),
    ).not.toBeInTheDocument();
  });

  it("renders Load-earlier when messages.length >= PAGE_LIMIT and clicking fetches next keyset page", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 50 }).map((_, i) =>
      makeMessage({
        id: `m1-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `first page msg ${i}`,
        created_at: `2026-05-12T10:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    clientFetchMock.mockImplementation((url: string) => {
      const u = new URL(url, "http://x");
      const before = u.searchParams.get("before");
      if (!before) {
        return Promise.resolve({ messages: firstPage });
      }
      return Promise.resolve({
        messages: [
          makeMessage({
            id: "older-1",
            content: "older page msg",
            created_at: "2026-05-12T09:00:00.000Z",
          }),
        ],
      });
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    const loadBtn = await screen.findByRole("button", { name: /Load earlier messages/i });
    await user.click(loadBtn);
    await waitFor(() => {
      expect(screen.getByText("older page msg")).toBeInTheDocument();
    });
  });

  it("Copy transcript writes role-prefixed text to clipboard", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    clientFetchMock.mockResolvedValue({
      messages: [
        makeMessage({ id: "m1", role: "user", content: "hi" }),
        makeMessage({ id: "m2", role: "assistant", content: "hello" }),
      ],
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText("hi")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Copy transcript/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalled();
    });
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg).toContain("### You");
    expect(arg).toContain("hi");
    expect(arg).toContain("### Assistant");
    expect(arg).toContain("hello");
  });

  it("Export JSON triggers Blob download with application/json mime", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockResolvedValue({
      messages: [makeMessage()],
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:json");
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Export as JSON/i }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/json");
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it("Delete confirm fires DELETE and routes to /app/conversations", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/conversations/messages")) {
        return Promise.resolve({ messages: [makeMessage()] });
      }
      if (url === "/api/conversations/delete" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Delete conversation/i }));
    const confirms = await screen.findAllByRole("button", {
      name: /Delete conversation|^Delete$|^Confirm$/i,
    });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() => {
      const calls = clientFetchMock.mock.calls;
      const found = calls.some(
        (c) => c[0] === "/api/conversations/delete" && c[1]?.method === "DELETE",
      );
      expect(found).toBe(true);
      expect(pushMock).toHaveBeenCalledWith("/app/conversations");
    });
  });

  it("clicking error Retry refetches", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    let attempt = 0;
    clientFetchMock.mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({ messages: [makeMessage()] });
    });
    renderWithProviders(<ConversationDetailClient conversationId={CID} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load conversation/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => {
      expect(clientFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
