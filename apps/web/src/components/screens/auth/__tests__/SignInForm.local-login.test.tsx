// SPDX-License-Identifier: FSL-1.1-ALv2
// Upstream #9 (web half) — RED-first: SignInForm must gate the local-login
// affordances on the localLogin.enabled flag from GET /api/auth/providers.
//
// Server #9 (shipped 1.2.0) returns localLogin.enabled=false and 403s the
// credential routes when OPENWHISPR_DISABLE_LOCAL_LOGIN=1. The web sign-in
// screen previously rendered the email/password form unconditionally → a dead
// form that the backend 403s. This drives the fix: when localLogin.enabled ===
// false, render ONLY the SSO buttons (+ header/alerts + a localized
// "disabled — use SSO" line); hide email/password/separator/forgot/submit and
// the sign-up cross-link.
//
// Boundary mock: ONLY globalThis.fetch (the /api/auth/providers network call).
// useAuthProviders runs for real — no internal-logic mock. Back-compat contract
// pinned: absent localLogin ⇒ form shown (old server ≤1.1.0); explicit false ⇒
// hidden. Do NOT "fix" the absent-field omission in stubs — it is the contract.

import { render, screen } from "@testing-library/react";
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
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    sendVerificationEmail: vi.fn(),
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      common: {
        action: {
          togglePassword: { show: { label: "Show password" }, hide: { label: "Hide password" } },
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
          // OidcButtons maps provider id `oidc` → slot `sso` (labelKey()).
          sso: { label: "Continue with Single Sign-On" },
        },
        separator: { email: { text: "Or with email" } },
        action: {
          rememberDevice: { label: "Remember this device" },
          forgotPassword: { link: { label: "Forgot password?" } },
          "signup-link": { label: "Don't have an account? Sign up" },
          "download-link": { label: "Download the desktop app" },
          resendVerification: { label: "Resend verification email" },
        },
        error: { title: { text: "Error" }, body: { text: "Could not sign in." } },
        "local-login-disabled": {
          body: { text: "Local sign-in is disabled. Use single sign-on to continue." },
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

/** Stub GET /api/auth/providers. `localLogin` omitted entirely when undefined. */
function stubProviders(localLogin: boolean | undefined): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      providers: [
        { id: "google", name: "Google", enabled: true },
        { id: "oidc", name: "Single Sign-On", enabled: true },
      ],
      emailVerification: { required: true, configured: true },
      ...(localLogin === undefined ? {} : { localLogin: { enabled: localLogin } }),
    }),
  } as unknown as Response);
}

describe("SignInForm — localLogin gating (upstream #9 web half)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("localLogin.enabled === false → hides every local affordance, keeps SSO", async () => {
    stubProviders(false);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    // SSO survives (await proves the fetch settled and the false-flag applied).
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    // Every local-login affordance is gone.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/or with email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /forgot password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
    // The localized SSO-only explanatory line is shown.
    expect(screen.getByText(/local sign-in is disabled/i)).toBeInTheDocument();
  });

  it("renders the download link in OIDC-only mode too (CTA sits outside the localLogin ternary)", async () => {
    stubProviders(false);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    // Prove the OIDC-only branch is active: the local form is hidden …
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    // … yet the download CTA is STILL present, proving it renders in both modes.
    expect(screen.getByRole("link", { name: /download the desktop app/i })).toHaveAttribute(
      "href",
      "/download",
    );
  });

  it("localLogin.enabled === true → renders the form as today", async () => {
    stubProviders(true);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("localLogin absent (old server ≤1.1.0) → renders the form (back-compat default)", async () => {
    stubProviders(undefined);
    const { SignInForm } = await import("../SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});
