// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a — RED unit specs for ResetPasswordForm.
//
// Surface verified:
//   - token=null prop → error Alert + back-link to /forgot-password
//   - token="abc"     → form renders (new-password + confirm + submit)
//   - zod rejects mismatched newPassword/confirm
//   - zod rejects weak passwords (mirrors signUpSchema min(8))
//   - successful submit → router.push('/sign-in') invoked
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reset-password",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ResetPasswordForm POSTs raw JSON to /api/auth/reset-password
// (Better Auth 1.6.9 canonical path; we deliberately bypass the typed
// authClient helper to avoid binding to a name that shifts across BA
// releases). Spy on global fetch so the unit suite never networks.
const fetchSpy = vi.fn();

const resources = {
  "end-user": {
    "end-user": {
      // Phase 55-02-b — shared togglePassword keys consumed by the
      // PasswordInputWithToggle building block.
      common: {
        action: {
          togglePassword: {
            show: { label: "Show password" },
            hide: { label: "Hide password" },
          },
        },
      },
      "reset-password": {
        title: { heading: { text: "Set a new password" } },
        subtitle: {
          body: { text: "Pick a new password and confirm it to finish." },
        },
        form: {
          "new-password": { label: "New password" },
          "confirm-password": { label: "Confirm new password" },
          submit: { label: "Set new password" },
        },
        "error-generic": {
          title: { text: "Reset failed" },
          body: { text: "Could not reset your password. Request a fresh link and try again." },
        },
        "error-missing-token": {
          title: { text: "Reset link is invalid" },
          body: { text: "This reset link is missing or expired. Request a new one." },
        },
        action: {
          "back-to-forgot": { label: "Request a new reset link" },
        },
        validation: {
          mismatch: { text: "Passwords do not match." },
        },
      },
    },
  },
  common: {
    common: {
      loading: { label: "Loading…" },
      auth: {
        shell: {
          kicker: { default: { text: "Self-host · v1" } },
          title: { default: { text: "Your speech, on your servers." } },
          quote: { default: { text: "Private speech-to-text." } },
          footer: {
            status: { text: "Status" },
            docs: { text: "Docs" },
            github: { text: "GitHub" },
          },
        },
      },
    },
  },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

describe("ResetPasswordForm (Phase 55-01-a)", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    routerPush.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (...args: unknown[]) => fetchSpy(...args) as Promise<Response>,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("token=null → renders error Alert + back-link, NOT the form", async () => {
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    render(
      <Wrap>
        <ResetPasswordForm token={null} />
      </Wrap>,
    );
    expect(screen.getByText(/reset link is invalid/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
  });

  it('token="" empty string → same error path', async () => {
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    render(
      <Wrap>
        <ResetPasswordForm token="" />
      </Wrap>,
    );
    expect(screen.getByText(/reset link is invalid/i)).toBeInTheDocument();
  });

  it('token="abc" → form fields render', async () => {
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    render(
      <Wrap>
        <ResetPasswordForm token="abc" />
      </Wrap>,
    );
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set new password/i })).toBeInTheDocument();
  });

  it("zod rejects mismatched newPassword / confirm", async () => {
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ResetPasswordForm token="abc" />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/^new password$/i), "Strong-Pass-9!");
    await user.type(screen.getByLabelText(/confirm new password/i), "Different-Pass-9!");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("zod rejects weak passwords (length < 8)", async () => {
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ResetPasswordForm token="abc" />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/^new password$/i), "weak");
    await user.type(screen.getByLabelText(/confirm new password/i), "weak");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });

  it("successful submit POSTs /api/auth/reset-password and router.push('/sign-in')", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const { ResetPasswordForm } = await import("../ResetPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ResetPasswordForm token="reset-token-xyz" />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/^new password$/i), "Strong-Pass-9!");
    await user.type(screen.getByLabelText(/confirm new password/i), "Strong-Pass-9!");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("/api/auth/reset-password");
    expect((call[1] as RequestInit).method).toBe("POST");
    const body = JSON.parse((call[1] as RequestInit).body as string) as {
      newPassword: string;
      token: string;
    };
    expect(body.newPassword).toBe("Strong-Pass-9!");
    expect(body.token).toBe("reset-token-xyz");
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/sign-in"));
  });
});
