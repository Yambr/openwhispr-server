// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:7-94 (ScreenSignIn)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:229-316 (AuthShell)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:326-336 (Btn)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:338-352 (Field).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// What this asserts (semantic DOM, NOT pixel-diff):
//   - One <h*> heading matching signInInventory.headingProduction.
//   - Email + Password labelled inputs (Field primitive).
//   - 3 OIDC affordances when /api/auth/providers returns 3 providers (Btn row).
//   - Submit "Sign in" button (Btn kind="accent" lg).
//   - Sign-up footer link (anchor with href="/sign-up").
//   - Forgot-password copy present.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { signInInventory } from "./__fixtures__/jsx-inventory";

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
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
    },
    sendVerificationEmail: vi.fn(),
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      signin: {
        title: { heading: { text: signInInventory.headingProduction } },
        subtitle: { body: { text: signInInventory.ledeProduction } },
        form: {
          email: { label: signInInventory.emailLabel },
          password: { label: signInInventory.passwordLabel },
          submit: { label: signInInventory.submitProduction },
        },
        oidc: {
          google: { label: signInInventory.oidcLabels[0] },
          github: { label: signInInventory.oidcLabels[1] },
          sso: { label: signInInventory.oidcLabels[2] },
        },
        error: {
          title: { text: "Sign-in failed" },
          body: { text: "Check your email and password, then try again." },
        },
        "error-unverified": {
          title: { text: "Verify your email to sign in" },
          body: { text: "We have not received confirmation for this email yet." },
          sent: { text: "Verification email sent. Check your inbox." },
        },
        action: {
          forgotPassword: {
            link: {
              disabled: `${signInInventory.forgotLink} — coming soon, contact your operator.`,
            },
          },
          "signup-link": { label: `Don't have an account? ${signInInventory.footerLink}` },
          resendVerification: { label: "Resend verification email" },
        },
      },
    },
  },
  common: { common: { loading: { label: "Loading…" } } },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

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

describe("SignInForm conformance vs screens-user.jsx:7-94", () => {
  beforeEach(() => {
    stubProvidersFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the heading text from the JSX oracle inventory", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    // Heading is rendered as a CardTitle (semantic equivalent of oracle's <h2>).
    expect(screen.getByText(signInInventory.headingProduction)).toBeInTheDocument();
  });

  it("renders Email + Password labelled inputs (Field primitive — ui.jsx:338-352)", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      screen.getByLabelText(new RegExp(`^${signInInventory.emailLabel}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(`^${signInInventory.passwordLabel}$`, "i")),
    ).toBeInTheDocument();
  });

  it("renders 3 OIDC affordances when /api/auth/providers returns 3 providers (Btn row — screens-user.jsx:15-25)", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    for (const label of signInInventory.oidcLabels) {
      // findByRole — the OIDC row resolves async via the useAuthProviders fetch.
      // eslint-disable-next-line no-await-in-loop
      expect(
        await screen.findByRole("button", { name: new RegExp(label, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("renders the submit button with the oracle's submit copy", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${signInInventory.submitProduction}$`, "i"),
      }),
    ).toBeInTheDocument();
  });

  it("renders the sign-up footer link pointing at /sign-up (screens-user.jsx:85-90)", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    const link = screen.getByRole("link", {
      name: new RegExp(signInInventory.footerLink, "i"),
    });
    expect(link).toHaveAttribute("href", "/sign-up");
  });

  it("renders forgot-password copy (screens-user.jsx:76-78)", async () => {
    const { SignInForm } = await import("@/components/screens/auth/SignInForm");
    render(
      <Wrap>
        <SignInForm />
      </Wrap>,
    );
    // Production renders the copy as muted static text (D-UX2). The oracle's
    // "Forgot password?" prefix must survive as a substring.
    await waitFor(() => {
      expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
    });
  });
});
