// SPDX-License-Identifier: FSL-1.1-ALv2
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

// Test-scoped URLSearchParams override — most tests run with no query
// (default); F8 tests use `setMockSearch("?verified=1")` to simulate the
// post-verify-email landing.
let mockSearchParams = new URLSearchParams();
function setMockSearch(query: string): void {
  mockSearchParams = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/sign-in",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const signInEmail = vi.fn();
const signInSocial = vi.fn();
const sendVerificationEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
    // Plan 12-04 / UICONF-07: Better Auth React client surface exposes
    // sendVerificationEmail({ email }) for the resend-verification flow.
    sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      // Phase 55-02-b — shared togglePassword keys consumed by the
      // PasswordInputWithToggle building block. Sign-in, sign-up, and
      // reset-password forms all read these same keys.
      common: {
        action: {
          togglePassword: {
            show: { label: "Show password" },
            hide: { label: "Hide password" },
          },
        },
      },
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
        error: {
          title: { text: "Sign-in failed" },
          body: { text: "Check your email and password, then try again." },
        },
        // Plan 12-04 / UICONF-07: dedicated copy for 403 EMAIL_NOT_VERIFIED.
        // Flattened to satisfy UI-SPEC 5-level schema (D-ART4).
        "error-unverified": {
          title: { text: "Verify your email to sign in" },
          body: {
            text: "We have not received confirmation for this email yet. Resend the verification link below.",
          },
          sent: {
            text: "Verification email sent. Check your inbox.",
          },
        },
        // F8 — verify-email-complete 302s back to /sign-in?verified=1 for
        // web-flow sign-ups.
        verified: {
          title: { text: "Email verified" },
          body: { text: "Your email has been confirmed. Sign in to continue." },
        },
        // SEED-F8-UX — verify-email-complete 302 with ?error=<code> for
        // browser flows on expired/invalid verification links.
        "verify-error": {
          default: {
            title: { text: "Verification failed" },
            body: {
              text: "We could not confirm this verification link. Sign up again to receive a fresh email.",
            },
          },
          "link-expired": {
            title: { text: "Verification link expired" },
            body: {
              text: "This verification link is no longer valid. Sign up again or request a new verification email to continue.",
            },
          },
          invalid_token: {
            title: { text: "Invalid verification link" },
            body: { text: "This verification link was not recognized. Please request a new one." },
          },
        },
        action: {
          forgotPassword: {
            // Phase 55-01-a — D-UX2 reversed; muted "coming soon" copy
            // replaced with active CTA label that drives the new
            // /forgot-password Next.js route.
            link: { label: "Forgot password?" },
          },
          "signup-link": { label: "Don't have an account? Sign up" },
          "download-link": { label: "Download the desktop app" },
          resendVerification: { label: "Resend verification email" },
          // Phase 18.1.1 / Plan 04 / Task 04 (D-21..D-23) — new keys
          rememberDevice: { label: "Remember this device" },
          togglePassword: {
            show: { label: "Show password" },
            hide: { label: "Hide password" },
          },
        },
        // Phase 18.1.1 / Plan 04 / Task 04 (D-19) — text-in-rule separator
        separator: { email: { text: "Or with email" } },
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

// Plan 12-04: OidcButtons now reads /api/auth/providers via the
// `useAuthProviders` hook (TD-12.c closure) instead of NEXT_PUBLIC_OIDC_PROVIDERS.
// All sign-in tests that used to munge the env var now stub `fetch` instead.
function stubProvidersFetch(providers: { id: "google" | "github" | "oidc"; name: string }[]): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      providers: providers.map((p) => ({ id: p.id, name: p.name, enabled: true })),
      emailVerification: { required: true, configured: true },
    }),
  } as unknown as Response);
}

describe("SignInForm (Phase 07.1 / Plan 07 — U1)", () => {
  beforeEach(() => {
    signInEmail.mockReset();
    signInSocial.mockReset();
    // F8 — reset query-string between tests so the verify-email banner
    // test cannot leak its `?verified=1` state into siblings.
    setMockSearch("");
    // Default: all three providers configured (matches the pre-Plan-12-04 default).
    stubProvidersFetch([
      { id: "google", name: "Google" },
      { id: "github", name: "GitHub" },
      { id: "oidc", name: "Single Sign-On" },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("renders all three OIDC buttons when the providers endpoint returns google,github,oidc", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with sso/i })).toBeInTheDocument();
  });

  it("hides specific OIDC button when the providers endpoint excludes it", async () => {
    stubProvidersFetch([{ id: "google", name: "Google" }]);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with sso/i })).not.toBeInTheDocument();
  });

  it("renders live forgot-password link (Phase 55-01-a reversal of D-UX2)", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const link = screen.getByRole("link", { name: /forgot password/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/forgot-password");
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

  it("renders a 'Download the desktop app' link to /download in local-login mode", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /download the desktop app/i })).toHaveAttribute(
      "href",
      "/download",
    );
  });

  it("both locales define signin download-link key (parity)", () => {
    interface NestedLocale {
      [key: string]: string | NestedLocale;
    }
    const localesDir = join(process.cwd(), "src", "locales");
    function load(locale: string): NestedLocale {
      const raw = readFileSync(join(localesDir, locale, "end-user.json"), "utf8");
      return JSON.parse(raw) as NestedLocale;
    }
    for (const locale of ["en", "ru"]) {
      const endUserRoot = load(locale)["end-user"] as NestedLocale;
      const action = (endUserRoot.signin as NestedLocale).action as NestedLocale;
      const label = (action["download-link"] as NestedLocale).label;
      expect(typeof label).toBe("string");
      expect((label as string).length).toBeGreaterThan(0);
    }
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

  it("renders no OIDC buttons when the providers endpoint returns an empty list", async () => {
    stubProvidersFetch([]);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    // Wait a tick for the fetch promise to settle; OidcButtons resolves to null
    // and never renders any "continue with" affordance.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /continue with/i })).not.toBeInTheDocument();
    });
  });

  it("renders all three buttons when the providers endpoint returns the default set", async () => {
    // Default stub from beforeEach already returns google + github + oidc.
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1));
    const arg = signInSocial.mock.calls[0]?.[0] as { provider: string };
    expect(arg.provider).toBe("google");
  });

  // ---------------------------------------------------------------------
  // UICONF-07 — resend-verification CTA on 403 EMAIL_NOT_VERIFIED (Plan 12-04)
  // ---------------------------------------------------------------------

  it("UICONF-07: renders resend CTA when sign-in returns EMAIL_NOT_VERIFIED", async () => {
    signInEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    });
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // Dedicated unverified-email alert title + body distinct from the generic one.
    expect(await screen.findByText(/verify your email to sign in/i)).toBeInTheDocument();
    expect(screen.getByText(/have not received confirmation/i)).toBeInTheDocument();
    // The CTA is a Button (resend), not a link.
    expect(screen.getByRole("button", { name: /resend verification email/i })).toBeInTheDocument();
    // The generic sign-in failure copy MUST NOT be on screen for this branch.
    expect(screen.queryByText(/^sign-in failed$/i)).not.toBeInTheDocument();
  });

  it("UICONF-07: clicking the resend CTA calls authClient.sendVerificationEmail and shows the 'sent' state", async () => {
    signInEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    });
    sendVerificationEmail.mockResolvedValueOnce({ data: { status: true }, error: null });

    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const resendBtn = await screen.findByRole("button", { name: /resend verification email/i });
    await user.click(resendBtn);

    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalledTimes(1));
    const arg = sendVerificationEmail.mock.calls[0]?.[0] as { email: string };
    expect(arg.email).toBe("alice@test.local");

    await waitFor(() => {
      expect(screen.getByText(/verification email sent/i)).toBeInTheDocument();
    });
  });

  it("UICONF-07: resend failure falls back to the generic error branch", async () => {
    signInEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    });
    sendVerificationEmail.mockRejectedValueOnce(new Error("smtp transport down"));

    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const resendBtn = await screen.findByRole("button", { name: /resend verification email/i });
    await user.click(resendBtn);

    // Fallback: surface the generic sign-in failure copy; do NOT leave the
    // user on a half-broken unverified screen with a failing CTA.
    await waitFor(() => {
      expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /resend verification email/i }),
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Phase 18.1.1 / Plan 04 Task 04 — D-16..D-23 visual-oracle alignment.
  // ---------------------------------------------------------------------

  it("D-17: renders OidcButtons BEFORE the 'Or with email' separator BEFORE the form", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const oidc = await screen.findByRole("button", { name: /continue with google/i });
    const separator = await screen.findByText(/or with email/i);
    const submit = screen.getByRole("button", { name: /^sign in$/i });
    // Order via flat document traversal — compareDocumentPosition bit math is
    // brittle when one element contains another. Convert to absolute index.
    const all = Array.from(document.querySelectorAll("*"));
    const oidcIdx = all.indexOf(oidc);
    const sepIdx = all.indexOf(separator);
    const submitIdx = all.indexOf(submit);
    expect(oidcIdx).toBeGreaterThan(-1);
    expect(sepIdx).toBeGreaterThan(oidcIdx);
    expect(submitIdx).toBeGreaterThan(sepIdx);
  });

  it("D-21: renders a 'Remember this device' checkbox", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const cb = await screen.findByRole("checkbox", { name: /remember this device/i });
    expect(cb).toBeInTheDocument();
  });

  it("D-23: password show/hide eye toggle flips the input type and aria-label", async () => {
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const pw = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(pw.type).toBe("password");
    const toggle = screen.getByRole("button", { name: /show password/i });
    await user.click(toggle);
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).type).toBe("text");
    expect(screen.getByRole("button", { name: /hide password/i })).toBeInTheDocument();
  });

  it("Phase 55-01-a sentinel: forgot-password is a live link to /forgot-password (D-UX2 reversed)", async () => {
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const link = screen.getByRole("link", { name: /forgot password/i });
    expect(link.tagName.toLowerCase()).toBe("a");
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  it("UICONF-07: a non-403 error does NOT render the resend CTA (regression guard)", async () => {
    signInEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "INVALID_CREDENTIALS", message: "Wrong password" },
    });
    const { SignInForm } = await import("../SignInForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /resend verification email/i }),
    ).not.toBeInTheDocument();
  });

  // F8 — verify-email-complete 302s back to /sign-in?verified=1 for
  // web-flow sign-ups. SignInForm shows a "Email verified" success banner
  // so the user understands their email is now confirmed and they can
  // sign in normally.
  describe("F8 — ?verified=1 success banner", () => {
    it("renders a 'Email verified' banner when the URL carries ?verified=1", async () => {
      setMockSearch("?verified=1");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      // Banner is visible to assistive tech via role="status".
      expect(screen.getByTestId("signin-verified-alert")).toBeInTheDocument();
      expect(screen.getByText(/email verified/i)).toBeInTheDocument();
      expect(screen.getByText(/your email has been confirmed/i)).toBeInTheDocument();
    });

    it("does NOT render the verified banner on a plain /sign-in load (no query)", async () => {
      setMockSearch("");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.queryByTestId("signin-verified-alert")).not.toBeInTheDocument();
    });

    it("does NOT render the verified banner for ?verified=0 or other values", async () => {
      // Only the literal `1` triggers the banner — ?verified=0,
      // ?verified=true, ?verified=garbage all fall through.
      setMockSearch("?verified=0");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.queryByTestId("signin-verified-alert")).not.toBeInTheDocument();
    });

    it("dismisses the verified banner when a sign-in error is surfaced", async () => {
      // Once the user attempts sign-in and hits a generic error, the
      // verified banner gets out of the way (state.kind !== "idle"
      // hides it) so the actionable error message takes precedence.
      setMockSearch("?verified=1");
      signInEmail.mockResolvedValueOnce({
        data: null,
        error: { code: "GENERIC", message: "boom" },
      });
      const { SignInForm } = await import("../SignInForm");
      const user = userEvent.setup();
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      // Initial render: banner present.
      expect(screen.getByTestId("signin-verified-alert")).toBeInTheDocument();
      // Submit triggers error-generic state.
      await user.type(screen.getByLabelText(/email/i), "alice@test.local");
      await user.type(screen.getByLabelText(/password/i), "Pwa9!testStrong");
      await user.click(screen.getByRole("button", { name: /^sign in$/i }));
      await waitFor(() => {
        expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
      });
      // Banner is no longer visible.
      expect(screen.queryByTestId("signin-verified-alert")).not.toBeInTheDocument();
    });
  });

  // SEED-F8-UX — verify-email-complete 302s back to /sign-in?error=<code>
  // when the verification link expired (most common) or was invalid.
  // Replaces the raw JSON envelope the user saw in their address bar
  // 2026-05-25 18:08 UTC.
  describe("SEED-F8-UX — ?error=<code> verification-failure banner", () => {
    it("renders the link-expired banner with specific copy when ?error=link-expired", async () => {
      setMockSearch("?error=link-expired");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.getByTestId("signin-verify-error-alert")).toBeInTheDocument();
      expect(screen.getByText(/verification link expired/i)).toBeInTheDocument();
      expect(screen.getByText(/this verification link is no longer valid/i)).toBeInTheDocument();
    });

    it("renders the invalid_token banner when ?error=invalid_token", async () => {
      setMockSearch("?error=invalid_token");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.getByTestId("signin-verify-error-alert")).toBeInTheDocument();
      expect(screen.getByText(/invalid verification link/i)).toBeInTheDocument();
    });

    it("falls back to the default verify-error banner for unknown ?error=<code>", async () => {
      // Server-side regex permits [a-zA-Z0-9_-]+ — unknown but well-formed
      // codes still render an actionable (generic) banner rather than
      // dumping the raw code.
      setMockSearch("?error=some_unknown_code");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.getByTestId("signin-verify-error-alert")).toBeInTheDocument();
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    });

    it("rejects ?error=<unsafe-value> client-side — banner suppressed", async () => {
      // Server-side regex blocks anything beyond [a-zA-Z0-9_-], but
      // defense-in-depth: the client-side regex also validates so an
      // attacker who somehow plants a payload in the URL cannot inject
      // arbitrary translation keys.
      setMockSearch("?error=foo%2Fbar");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.queryByTestId("signin-verify-error-alert")).not.toBeInTheDocument();
    });

    it("does NOT render the verify-error banner on a plain /sign-in load", async () => {
      setMockSearch("");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.queryByTestId("signin-verify-error-alert")).not.toBeInTheDocument();
    });

    it("verify-error banner co-exists with the verified banner only if both query params are present (rare edge case)", async () => {
      // Defensive: if some race results in both ?verified=1 AND ?error=,
      // both alerts render (idle state, both pass guards). UI gracefully
      // shows both — the visual hierarchy is success-then-error so the
      // user can see they reached the right page after verification.
      setMockSearch("?verified=1&error=link-expired");
      const { SignInForm } = await import("../SignInForm");
      render(
        <Wrap>
          <SignInForm />
        </Wrap>,
      );
      expect(screen.getByTestId("signin-verified-alert")).toBeInTheDocument();
      expect(screen.getByTestId("signin-verify-error-alert")).toBeInTheDocument();
    });
  });
});
