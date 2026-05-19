// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a — RED unit specs for ForgotPasswordForm.
//
// Surface verified:
//   - email input with end-user.forgot-password.form.email.label
//   - submit button with end-user.forgot-password.form.submit.label
//   - zod rejects empty email + invalid email shape (inline FormMessage)
//   - successful auth-client call → enumeration-safe success panel renders
//   - rejected auth-client call → SAME enumeration-safe panel renders
//     (no leakage between "registered" and "not registered" outcomes)
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/forgot-password",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const forgetPassword = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    forgetPassword: (...args: unknown[]) => forgetPassword(...args),
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      "forgot-password": {
        title: { heading: { text: "Forgot your password?" } },
        subtitle: {
          body: { text: "Enter your account email and we will send a reset link." },
        },
        form: {
          email: { label: "Email" },
          submit: { label: "Send reset link" },
        },
        success: {
          title: { text: "Check your email" },
          body: {
            text: "If your email is registered, we have sent you a reset link.",
          },
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

describe("ForgotPasswordForm (Phase 55-01-a)", () => {
  beforeEach(() => {
    forgetPassword.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders email input + submit button", async () => {
    const { ForgotPasswordForm } = await import("../ForgotPasswordForm");
    render(
      <Wrap>
        <ForgotPasswordForm />
      </Wrap>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("zod rejects empty / invalid email shapes (inline FormMessage)", async () => {
    const { ForgotPasswordForm } = await import("../ForgotPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ForgotPasswordForm />
      </Wrap>,
    );
    // Empty submit → form does NOT invoke the auth client.
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(forgetPassword).not.toHaveBeenCalled());

    // Bad email shape → still no auth call; FormMessage surfaces.
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(forgetPassword).not.toHaveBeenCalled());
  });

  it("successful auth-client call renders enumeration-safe success panel", async () => {
    forgetPassword.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { ForgotPasswordForm } = await import("../ForgotPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ForgotPasswordForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "registered@local.test");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(forgetPassword).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/if your email is registered, we have sent you a reset link/i),
    ).toBeInTheDocument();
  });

  it("rejected auth-client call renders the SAME enumeration-safe panel (no leak)", async () => {
    forgetPassword.mockRejectedValueOnce(new Error("network"));
    const { ForgotPasswordForm } = await import("../ForgotPasswordForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <ForgotPasswordForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "not-registered@local.test");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(forgetPassword).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/if your email is registered, we have sent you a reset link/i),
    ).toBeInTheDocument();
  });
});
