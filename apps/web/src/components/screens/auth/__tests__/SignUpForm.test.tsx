// Phase 07.1 / Plan 07 — RED tests for SignUpForm (U2).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sign-up",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const signUpEmail = vi.fn();
const signInSocial = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
    signIn: { social: (...args: unknown[]) => signInSocial(...args) },
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      signup: {
        title: { heading: { text: "Create your OpenWhispr account" } },
        subtitle: { body: { text: "A confirmation email is sent to verify your address." } },
        form: {
          name: { label: "Name" },
          email: { label: "Email" },
          password: { label: "Password" },
          confirmPassword: { label: "Confirm password" },
          submit: { label: "Sign up" },
        },
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          sso: { label: "Continue with SSO" },
        },
        action: {
          "signin-link": { label: "Already have an account? Sign in" },
        },
        success: {
          title: { text: "Check your email" },
          body: { text: "We sent a verification link to your address. Open it to continue." },
        },
        error: {
          duplicate: { text: "This email is already registered. Sign in instead." },
          generic: { text: "Sign-up failed. Please review the form and try again." },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

describe("SignUpForm (Phase 07.1 / Plan 07 — U2)", () => {
  beforeEach(() => {
    signUpEmail.mockReset();
    signInSocial.mockReset();
    process.env.NEXT_PUBLIC_OIDC_PROVIDERS = "google,github,oidc";
  });

  it("renders name + email + password inputs and submit button", async () => {
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign up$/i })).toBeInTheDocument();
  });

  it("renders OIDC buttons", async () => {
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with sso/i })).toBeInTheDocument();
  });

  it("submits valid payload to authClient.signUp.email and shows success state", async () => {
    signUpEmail.mockResolvedValueOnce({ data: { user: {} }, error: null });
    const { SignUpForm } = await import("../SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    await waitFor(() => expect(signUpEmail).toHaveBeenCalledTimes(1));
    const call = signUpEmail.mock.calls[0]?.[0] as {
      email: string;
      password: string;
      name: string;
    };
    expect(call.email).toBe("alice@test.local");
    expect(call.name).toBe("Alice");
    expect(call.password).toBe("Pwa9!testStrong");
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it("renders duplicate-email error when Better Auth returns USER_ALREADY_EXISTS", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "USER_ALREADY_EXISTS", message: "User already exists" },
    });
    const { SignUpForm } = await import("../SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/already registered/i).length).toBeGreaterThan(0);
    });
  });

  it("renders generic error when authClient.signUp.email throws", async () => {
    signUpEmail.mockRejectedValueOnce(new Error("network"));
    const { SignUpForm } = await import("../SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/sign-up failed/i).length).toBeGreaterThan(0);
    });
  });

  it("renders generic error for non-duplicate failures", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "UNKNOWN", message: "boom" },
    });
    const { SignUpForm } = await import("../SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/sign-up failed/i).length).toBeGreaterThan(0);
    });
  });
});
