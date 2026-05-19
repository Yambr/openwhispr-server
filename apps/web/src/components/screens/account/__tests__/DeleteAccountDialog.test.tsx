// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 DeleteAccountDialog tests (RED→GREEN).
// Phase 55-01-b — wire migrated from Better Auth `authClient.deleteAccount()`
// (POST mismatch with the DELETE-only server route) to a hand-rolled
// `fetch("/api/auth/delete-account", { method: "DELETE", ... })` per
// wire-contract.md WIRE-03. Tests assert the fetch surface directly.
//
// Surface verified:
//   - dialog has an email confirm Input
//   - Confirm button disabled until typed value === user.email (case-sensitive)
//   - on Confirm: fetch DELETE /api/auth/delete-account, then router.push('/sign-in')
//   - on non-2xx response: dialog remains open, no redirect
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/account",
}));

const signOutMock = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: (...args: unknown[]) => signOutMock(...args),
  },
}));

import { DeleteAccountDialog } from "../DeleteAccountDialog";

const resources = {
  "end-user": {
    "end-user": {
      account: {
        danger: {
          title: { label: "Danger zone" },
          delete: { label: "Delete account" },
          "dialog-title": { text: "Delete your OpenWhispr account" },
          "dialog-body": {
            text: "This deletes your transcriptions, notes, conversations, and sessions. Type your email to confirm.",
          },
          "dialog-input": { label: "Type your email to confirm" },
          "dialog-confirm": { label: "Delete account" },
        },
      },
    },
  },
  common: { common: { cancel: { label: "Cancel" } } },
} as Record<string, Record<string, unknown>>;

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider lng="en" resources={resources}>
      {ui}
    </I18nProvider>,
  );
}

function makeFetchResponse(init: { ok: boolean; status: number }): Response {
  // Minimal Response-shape — the dialog only reads `ok`. Avoids importing
  // undici / node-fetch in jsdom; cast is local to this test boundary.
  return {
    ok: init.ok,
    status: init.status,
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

describe("DeleteAccountDialog (Phase 07.1 / Plan 08, wire-migrated Phase 55-01-b)", () => {
  beforeEach(() => {
    signOutMock.mockReset();
    pushMock.mockReset();
    // global.fetch is per-test — reset by overwriting in each case
    vi.restoreAllMocks();
  });

  it("renders Danger zone trigger button", () => {
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeInTheDocument();
  });

  it("Confirm button is disabled until typed value equals userEmail", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    // Now dialog is open
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    const confirmBtn = screen.getByTestId("delete-account-confirm");
    expect(confirmBtn).toBeDisabled();
    await user.type(input, "alice@example.com");
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  it("Confirm stays disabled on mismatch", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    const confirmBtn = screen.getByTestId("delete-account-confirm");
    await user.type(input, "wrong@example.com");
    expect(confirmBtn).toBeDisabled();
  });

  it("on Confirm calls fetch DELETE /api/auth/delete-account then router.push('/sign-in')", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    signOutMock.mockResolvedValue({ data: {}, error: null });
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    await user.type(input, "alice@example.com");
    const confirmBtn = screen.getByTestId("delete-account-confirm");
    await user.click(confirmBtn);
    await waitFor(() => {
      // BUG-55-01-b-01: assert NO Content-Type header is sent. A body-less
      // DELETE with `Content-Type: application/json` trips Fastify's
      // FST_ERR_CTP_EMPTY_JSON_BODY → 500 envelope (regression guard).
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/delete-account", {
        method: "DELETE",
        credentials: "include",
      });
      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(callArgs[1].headers).toBeUndefined();
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("still redirects when defensive signOut() rejects", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    signOutMock.mockRejectedValue(new Error("signOut blew up"));
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    await user.type(input, "alice@example.com");
    await user.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("on non-2xx fetch response, does NOT redirect", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    await user.type(input, "alice@example.com");
    await user.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
