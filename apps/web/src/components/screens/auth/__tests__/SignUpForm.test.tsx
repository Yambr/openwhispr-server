// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — RED tests for SignUpForm (U2).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          sso: { label: "Continue with SSO" },
        },
        action: {
          "signin-link": { label: "Already have an account? Sign in" },
        },
        // Phase 18.1.1 / Plan 04 / Task 05 (D-25, D-27) — new keys.
        // Side-shell copy + password-strength meter band labels.
        shell: {
          sideTitle: { text: "Create your private workspace." },
          sideQuote: { text: "Run OpenWhispr on your own infrastructure." },
        },
        form: {
          name: { label: "Name" },
          email: { label: "Email" },
          password: { label: "Password" },
          confirmPassword: { label: "Confirm password" },
          submit: { label: "Sign up" },
          passwordStrength: {
            weak: { label: "Weak" },
            fair: { label: "Fair" },
            good: { label: "Good" },
            strong: { label: "Strong" },
          },
        },
        success: {
          title: { text: "Check your email" },
          body: { text: "We sent a verification link to your address. Open it to continue." },
        },
        // Plan 12-04 / UICONF-06: title.text and body.text are DISTINCT i18n
        // keys per errorKind so the Alert primitive renders different copy
        // for AlertTitle vs AlertDescription (no duplicate-banner regression).
        // Keys are flattened to satisfy UI-SPEC 5-level schema (D-ART4).
        "error-duplicate": {
          title: { text: "Email already registered" },
          body: { text: "This email is already registered. Sign in instead." },
        },
        "error-generic": {
          title: { text: "Sign-up failed" },
          body: { text: "Sign-up failed. Please review the form and try again." },
        },
      },
    },
  },
  common: {
    common: {
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

// Plan 12-04: OidcButtons now reads /api/auth/providers via the
// `useAuthProviders` hook (TD-12.c closure) instead of NEXT_PUBLIC_OIDC_PROVIDERS.
function stubProvidersFetch(): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      providers: [
        { id: "google", name: "Google", enabled: true },
        { id: "github", name: "GitHub", enabled: true },
        { id: "oidc", name: "Single Sign-On", enabled: true },
      ],
      emailVerification: { required: true, configured: true },
    }),
  } as unknown as Response);
}

describe("SignUpForm (Phase 07.1 / Plan 07 — U2)", () => {
  beforeEach(() => {
    signUpEmail.mockReset();
    signInSocial.mockReset();
    stubProvidersFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
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
    expect(await screen.findByText(/email already registered/i)).toBeInTheDocument();
    // Body copy (description) is still present and distinct from the title.
    expect(screen.getByText(/already registered\. sign in instead\./i)).toBeInTheDocument();
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
    // Title copy is "Sign-up failed" — body adds the actionable sentence.
    expect(await screen.findByText(/^sign-up failed$/i)).toBeInTheDocument();
    expect(screen.getByText(/review the form and try again/i)).toBeInTheDocument();
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
    expect(await screen.findByText(/^sign-up failed$/i)).toBeInTheDocument();
  });

  it("treats USER_ALREADY_EXISTS detected by message alone as duplicate", async () => {
    // Covers the `code ?? ""` + message-regex fallback when Better Auth omits
    // the canonical code but the message still carries 'already exists'.
    signUpEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "User Already Exists in the database" },
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
    expect(await screen.findByText(/email already registered/i)).toBeInTheDocument();
  });

  it("treats an entirely empty error object as generic", async () => {
    // Covers both `code ?? ""` AND `message ?? ""` fallbacks evaluating to
    // empty strings.
    signUpEmail.mockResolvedValueOnce({ data: null, error: {} });
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
    expect(await screen.findByText(/^sign-up failed$/i)).toBeInTheDocument();
  });

  // Plan 12-04 / UICONF-06: regression guard for the SignUpForm.tsx:102-115
  // duplicate-i18n-key bug. Exactly one Alert; title text and body text must
  // be DIFFERENT strings (RESEARCH §11). Reflected in conformance suite.
  it("UICONF-06: renders exactly one banner element with distinct title/body copy", async () => {
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
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
    const alert = screen.getByRole("alert");
    const title = alert.querySelector('[data-slot="alert-title"]')?.textContent ?? "";
    const body = alert.querySelector('[data-slot="alert-description"]')?.textContent ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
    expect(title).not.toBe(body);
  });

  // ---------------------------------------------------------------------
  // Phase 18.1.1 / Plan 04 Task 05 — D-24..D-28 visual-oracle alignment.
  // ---------------------------------------------------------------------

  it("D-24: AuthShell side-panel copy renders the signup-specific override", async () => {
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    // AuthShell's <aside> ships the override sideTitle when SignUpForm
    // forwards the resource value via the `sideTitle` prop.
    expect(screen.getByText(/create your private workspace\./i)).toBeInTheDocument();
    expect(screen.getByText(/run openwhispr on your own infrastructure\./i)).toBeInTheDocument();
  });

  it("D-25: renders the password-strength meter with band label", async () => {
    const { SignUpForm } = await import("../SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/^password$/i), "abc");
    expect(screen.getByTestId("password-strength-meter")).toBeInTheDocument();
    expect(screen.getByText(/^weak$/i)).toBeInTheDocument();
    // Stronger password → "Strong" band label appears.
    await user.clear(screen.getByLabelText(/^password$/i));
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrongPwa9!");
    expect(screen.getByText(/^strong$/i)).toBeInTheDocument();
  });

  it("W-1 scope-out: terms checkbox is intentionally absent (no /terms /privacy routes)", async () => {
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    // The terms checkbox lands with Phase 19.x once /terms /privacy ship.
    // Documented in .planning/deferred-items.md §18.1.1-04-05.
    expect(screen.queryByRole("checkbox", { name: /agree to/i })).not.toBeInTheDocument();
  });
});
