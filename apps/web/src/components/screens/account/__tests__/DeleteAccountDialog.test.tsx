// Phase 07.1 / Plan 08 — U5 DeleteAccountDialog tests (RED→GREEN).
//
// Surface verified:
//   - dialog has an email confirm Input
//   - Confirm button disabled until typed value === user.email (case-sensitive)
//   - on Confirm: authClient.deleteAccount() called, then router.push('/sign-in')
//   - on deleteAccount error: dialog remains open, no redirect
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/account",
}));

const deleteAccountMock = vi.fn();
const signOutMock = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    deleteAccount: (...args: unknown[]) => deleteAccountMock(...args),
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

describe("DeleteAccountDialog (Phase 07.1 / Plan 08)", () => {
  beforeEach(() => {
    deleteAccountMock.mockReset();
    signOutMock.mockReset();
    pushMock.mockReset();
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

  it("on Confirm calls authClient.deleteAccount() then router.push('/sign-in')", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    deleteAccountMock.mockResolvedValue({ data: { success: true }, error: null });
    signOutMock.mockResolvedValue({ data: {}, error: null });
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    await user.type(input, "alice@example.com");
    const confirmBtn = screen.getByTestId("delete-account-confirm");
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("still redirects when defensive signOut() rejects", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    deleteAccountMock.mockResolvedValue({ data: { success: true }, error: null });
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

  it("on deleteAccount error envelope, does NOT redirect", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    deleteAccountMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    wrap(<DeleteAccountDialog userEmail="alice@example.com" />);
    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    const input = await screen.findByLabelText(/Type your email to confirm/i);
    await user.type(input, "alice@example.com");
    await user.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
