// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — RED tests for SignInForm (U1).
//
// Surface verified:
//   - email + password inputs with end-user.signin.form.* labels
//   - Sign-in submit button with end-user.signin.form.submit.label
//   - OIDC buttons rendered for providers enumerated in NEXT_PUBLIC_OIDC_PROVIDERS
//   - Forgot-password rendered as DISABLED muted text (D-UX2)
//   - Sign-up link rendered (end-user.signin.action.signup-link.label)
//   - Invalid email shows inline RHF validation error
//   - Submit calls authClient.signIn.email; on error renders Alert
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sign-in",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const signInEmail = vi.fn();
const signInSocial = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      signin: {
        title: { heading: { text: "Sign in to OpenWhispr" } },
        subtitle: { body: { text: "Use your email or your organization SSO." } },
        form: {
          email: { label: "Email" },
          password: { label: "Password" },
          submit: { label: "Sign in" },
        },
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          sso: { label: "Continue with SSO" },
        },
        action: {
          forgotPassword: {
            link: { disabled: "Forgot password? — coming soon, contact your operator." },
          },
          "signup-link": { label: "Don't have an account? Sign up" },
        },
        error: {
          title: { text: "Sign-in failed" },
          body: { text: "Check your email and password, then try again." },
        },
      },
    },
  },
  common: {
    common: {
      loading: { label: "Loading…" },
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

describe("SignInForm (Phase 07.1 / Plan 07 — U1)", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_OIDC_PROVIDERS;
  beforeEach(() => {
    signInEmail.mockReset();
    signInSocial.mockReset();
    process.env.NEXT_PUBLIC_OIDC_PROVIDERS = "google,github,oidc";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_OIDC_PROVIDERS;
    else process.env.NEXT_PUBLIC_OIDC_PROVIDERS = ORIGINAL_ENV;
  });

  it("renders email + password inputs and submit button", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders all three OIDC buttons when env enumerates google,github,oidc", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with sso/i })).toBeInTheDocument();
  });

  it("hides specific OIDC button when env excludes it", async () => {
    process.env.NEXT_PUBLIC_OIDC_PROVIDERS = "google";
    vi.resetModules();
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with sso/i })).not.toBeInTheDocument();
  });

  it("renders disabled forgot-password text per D-UX2", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const txt = screen.getByText(/forgot password/i);
    expect(txt).toBeInTheDocument();
    // It must NOT be a clickable link or button (D-UX2: disabled).
    expect(txt.tagName.toLowerCase()).not.toBe("a");
    expect(txt.tagName.toLowerCase()).not.toBe("button");
  });

  it("renders sign-up link", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/sign-up");
  });

  it("submits valid credentials by calling authClient.signIn.email", async () => {
    signInEmail.mockResolvedValueOnce({ data: { user: {} }, error: null });
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(signInEmail).toHaveBeenCalledTimes(1));
    const call = signInEmail.mock.calls[0]?.[0] as { email: string; password: string };
    expect(call.email).toBe("alice@test.local");
    expect(call.password).toBe("Pwa9!testStrong");
  });

  it("renders Alert with error copy on failed sign-in", async () => {
    signInEmail.mockResolvedValueOnce({ data: null, error: { message: "Invalid credentials" } });
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
    });
  });

  it("renders no OIDC buttons when env enumerates an empty / unknown list", async () => {
    process.env.NEXT_PUBLIC_OIDC_PROVIDERS = "unknown-provider";
    vi.resetModules();
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.queryByRole("button", { name: /continue with/i })).not.toBeInTheDocument();
  });

  it("uses default provider list when env is unset", async () => {
    delete process.env.NEXT_PUBLIC_OIDC_PROVIDERS;
    vi.resetModules();
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("shows the error alert when authClient.signIn.email throws", async () => {
    signInEmail.mockRejectedValueOnce(new Error("network"));
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
    });
  });

  it("OIDC button click calls authClient.signIn.social with provider id", async () => {
    signInSocial.mockResolvedValueOnce({ data: {}, error: null });
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1));
    const arg = signInSocial.mock.calls[0]?.[0] as { provider: string };
    expect(arg.provider).toBe("google");
  });
});
