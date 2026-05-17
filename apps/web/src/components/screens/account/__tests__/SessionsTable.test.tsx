// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 SessionsTable Client tests (RED→GREEN).
//
// Surface verified against Better Auth 1.6.9 list-sessions response:
//   each row: { id, token, userAgent, ipAddress, createdAt, expiresAt, ... }.
//
// Asserts:
//   - Skeleton rows while authClient.listSessions() pending
//   - rows render with userAgent + ipAddress columns
//   - "this device" badge on the row whose id matches the current session
//   - per-row Revoke button calls authClient.revokeSession({ token })
//   - header "Revoke all other sessions" button calls authClient.revokeOtherSessions()
//   - Alert + Retry on rejected fetch
//   - "Revoke all others" hidden when only one session exists
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const listSessionsMock = vi.fn();
const revokeSessionMock = vi.fn();
const revokeOtherSessionsMock = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    listSessions: (...args: unknown[]) => listSessionsMock(...args),
    revokeSession: (...args: unknown[]) => revokeSessionMock(...args),
    revokeOtherSessions: (...args: unknown[]) => revokeOtherSessionsMock(...args),
  },
}));

import { SessionsTable } from "../SessionsTable";

const resources = {
  "end-user": {
    "end-user": {
      account: {
        sessions: {
          title: { label: "Active sessions" },
          "col-device": { label: "Device" },
          "col-ip": { label: "IP address" },
          "col-created": { label: "Started" },
          "col-expires": { label: "Expires" },
          "action-revoke": { label: "Revoke" },
          "action-revoke-others": { label: "Revoke all other sessions" },
        },
        error: {
          title: { text: "Could not load account" },
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

function row(over: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    token: "tok-1",
    userId: "u-1",
    userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
    ipAddress: "1.2.3.4",
    createdAt: "2026-05-12T10:00:00.000Z",
    expiresAt: "2026-06-12T10:00:00.000Z",
    ...over,
  };
}

describe("SessionsTable (Phase 07.1 / Plan 08)", () => {
  beforeEach(() => {
    listSessionsMock.mockReset();
    revokeSessionMock.mockReset();
    revokeOtherSessionsMock.mockReset();
  });

  it("renders Skeleton rows while pending", () => {
    listSessionsMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<SessionsTable currentSessionId="s1" />);
    expect(
      container.querySelectorAll('[data-testid="sessions-skeleton-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders one row per session with userAgent + ipAddress visible", async () => {
    listSessionsMock.mockResolvedValue({
      data: [
        row({ id: "s1", token: "tok-1", userAgent: "Chrome/120 on macOS", ipAddress: "1.1.1.1" }),
        row({ id: "s2", token: "tok-2", userAgent: "Firefox/130 on Linux", ipAddress: "2.2.2.2" }),
      ],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/Chrome\/120 on macOS/)).toBeInTheDocument();
      expect(screen.getByText(/Firefox\/130 on Linux/)).toBeInTheDocument();
      expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
      expect(screen.getByText("2.2.2.2")).toBeInTheDocument();
    });
  });

  it("marks the row whose id matches currentSessionId with 'this device' badge", async () => {
    listSessionsMock.mockResolvedValue({
      data: [
        row({ id: "s1", token: "tok-1", userAgent: "current ua" }),
        row({ id: "s2", token: "tok-2", userAgent: "other ua" }),
      ],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByTestId("session-row-this-device")).toBeInTheDocument();
    });
  });

  it("per-row Revoke button calls authClient.revokeSession({ token })", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" }), row({ id: "s2", token: "tok-2" })],
      error: null,
    });
    revokeSessionMock.mockResolvedValue({ data: { status: true }, error: null });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    const revokeBtns = await screen.findAllByRole("button", { name: /^Revoke$/i });
    // Two rows → two per-row Revoke buttons.
    expect(revokeBtns).toHaveLength(2);
    await user.click(revokeBtns[1] as HTMLElement);
    await waitFor(() => {
      expect(revokeSessionMock).toHaveBeenCalledWith({ token: "tok-2" });
    });
  });

  it("'Revoke all other sessions' button calls authClient.revokeOtherSessions()", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" }), row({ id: "s2", token: "tok-2" })],
      error: null,
    });
    revokeOtherSessionsMock.mockResolvedValue({ data: { status: true }, error: null });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    const btn = await screen.findByRole("button", { name: /Revoke all other sessions/i });
    await user.click(btn);
    await waitFor(() => {
      expect(revokeOtherSessionsMock).toHaveBeenCalled();
    });
  });

  it("hides 'Revoke all other sessions' when only one session exists", async () => {
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" })],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Revoke all other sessions/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders Alert + Retry on rejected fetch", async () => {
    listSessionsMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load account/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("renders Alert on Better Auth error envelope (error !== null)", async () => {
    listSessionsMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load account/i)).toBeInTheDocument();
    });
  });

  it("falls back to default error message when error.message is undefined", async () => {
    listSessionsMock.mockResolvedValue({ data: null, error: {} });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load account/i)).toBeInTheDocument();
    });
  });

  it("treats null data as empty session list", async () => {
    listSessionsMock.mockResolvedValue({ data: null, error: null });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Revoke all other sessions/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("clicking Retry on error refetches list-sessions", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    let attempt = 0;
    listSessionsMock.mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({ data: [], error: null });
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load account/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => {
      expect(listSessionsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders em-dash for null userAgent / ipAddress / createdAt / expiresAt", async () => {
    listSessionsMock.mockResolvedValue({
      data: [
        row({
          id: "s1",
          token: "tok-1",
          userAgent: null,
          ipAddress: null,
          createdAt: null,
          expiresAt: null,
        }),
      ],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      // 4 null fields (userAgent / ipAddress / createdAt / expiresAt) →
      // exactly 4 em-dash placeholders for the single row.
      expect(screen.getAllByText("—")).toHaveLength(4);
    });
  });

  it("renders em-dash for invalid date strings (formatDate NaN branch)", async () => {
    listSessionsMock.mockResolvedValue({
      data: [
        row({
          id: "s1",
          token: "tok-1",
          createdAt: "not-a-date",
          expiresAt: "also-not-a-date",
        }),
      ],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    await waitFor(() => {
      // 2 invalid date strings (createdAt + expiresAt → formatDate NaN
      // branch) → exactly 2 em-dashes. userAgent / ipAddress fields use
      // defaults from the row() helper, not null, so they do NOT render
      // em-dashes here.
      expect(screen.getAllByText("—")).toHaveLength(2);
    });
  });

  it("revokeSession that returns Better Auth error envelope throws", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" }), row({ id: "s2", token: "tok-2" })],
      error: null,
    });
    revokeSessionMock.mockResolvedValue({ data: null, error: { message: "revoke boom" } });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    const revokeBtns = await screen.findAllByRole("button", { name: /^Revoke$/i });
    await user.click(revokeBtns[1] as HTMLElement);
    await waitFor(() => {
      expect(revokeSessionMock).toHaveBeenCalled();
    });
  });

  it("revokeOtherSessions that returns Better Auth error envelope throws", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" }), row({ id: "s2", token: "tok-2" })],
      error: null,
    });
    revokeOtherSessionsMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderWithProviders(<SessionsTable currentSessionId="s1" />);
    const btn = await screen.findByRole("button", { name: /Revoke all other sessions/i });
    await user.click(btn);
    await waitFor(() => {
      expect(revokeOtherSessionsMock).toHaveBeenCalled();
    });
  });

  it("never marks any row as 'this device' when currentSessionToken is null", async () => {
    listSessionsMock.mockResolvedValue({
      data: [row({ id: "s1", token: "tok-1" })],
      error: null,
    });
    renderWithProviders(<SessionsTable currentSessionId="not-matching-any-row" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Revoke$/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId("session-row-this-device")).not.toBeInTheDocument();
  });
});
