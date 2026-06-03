// SPDX-License-Identifier: FSL-1.1-ALv2
// Upstream #9 (web half) — SignUpForm must gate the local-login (name/email/
// password) form on localLogin.enabled. Same contract as SignInForm: explicit
// false ⇒ hide form + sign-in cross-link, keep SSO + a localized line; absent /
// true / network failure ⇒ render as today. Boundary mock = fetch only.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signUp: { email: vi.fn() }, signIn: { social: vi.fn() } },
}));

const resources = {
  "end-user": {
    "end-user": {
      common: {
        action: {
          togglePassword: { show: { label: "Show password" }, hide: { label: "Hide password" } },
        },
      },
      signup: {
        title: { heading: { text: "Create your OpenWhispr account" } },
        subtitle: { body: { text: "Use your email or your organization SSO." } },
        form: {
          name: { label: "Name" },
          email: { label: "Email" },
          password: { label: "Password" },
          submit: { label: "Create account" },
        },
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          // OidcButtons maps provider id `oidc` → slot `sso` (labelKey()).
          sso: { label: "Continue with Single Sign-On" },
        },
        action: { "signin-link": { label: "Already have an account? Sign in" } },
        "local-login-disabled": {
          body: { text: "Local sign-up is disabled. Use single sign-on to continue." },
        },
        strength: {
          weak: { label: "Weak" },
          fair: { label: "Fair" },
          good: { label: "Good" },
          strong: { label: "Strong" },
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

function stubProviders(localLogin: boolean | undefined): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      providers: [{ id: "oidc", name: "Single Sign-On", enabled: true }],
      emailVerification: { required: true, configured: true },
      ...(localLogin === undefined ? {} : { localLogin: { enabled: localLogin } }),
    }),
  } as unknown as Response);
}

describe("SignUpForm — localLogin gating (upstream #9 web half)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("localLogin.enabled === false → hides the sign-up form, keeps SSO + explanatory line", async () => {
    stubProviders(false);
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with single sign-on/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByText(/local sign-up is disabled/i)).toBeInTheDocument();
  });

  it("localLogin.enabled === true → renders the sign-up form as today", async () => {
    stubProviders(true);
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: /continue with single sign-on/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("localLogin absent (old server) → renders the form (back-compat default)", async () => {
    stubProviders(undefined);
    const { SignUpForm } = await import("../SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });
});
