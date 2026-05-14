// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:97-183 (ScreenSignUp)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:229-316 (AuthShell)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:326-336 (Btn)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:338-352 (Field).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// What this asserts:
//   - Name + Email + Password labelled inputs.
//   - Submit button copy.
//   - Sign-in footer link pointing at /sign-in.
//   - UICONF-06 hardening (defense-in-depth over Plan 12-04 Task 3):
//       * exactly ONE element with role='alert' on the duplicate-email branch;
//       * the alert's [data-slot="alert-title"] textContent !== the
//         [data-slot="alert-description"] textContent (no duplicate banner).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { signUpInventory } from "./__fixtures__/jsx-inventory";

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
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
    signIn: { social: vi.fn() },
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      signup: {
        title: { heading: { text: signUpInventory.headingProduction } },
        subtitle: { body: { text: signUpInventory.ledeProduction } },
        form: {
          name: { label: signUpInventory.nameLabel },
          email: { label: signUpInventory.emailLabel },
          password: { label: signUpInventory.passwordLabel },
          confirmPassword: { label: "Confirm password" },
          submit: { label: signUpInventory.submitProduction },
        },
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          sso: { label: "Continue with SSO" },
        },
        action: {
          "signin-link": { label: `Already have an account? ${signUpInventory.footerLink}` },
        },
        success: { title: { text: "Check your email" }, body: { text: "We sent a link." } },
        "error-duplicate": signUpInventory.duplicate,
        "error-generic": signUpInventory.generic,
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

describe("SignUpForm conformance vs screens-user.jsx:97-183", () => {
  beforeEach(() => {
    signUpEmail.mockReset();
    stubProvidersFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Name + Email + Password labelled inputs (Field primitive)", async () => {
    const { SignUpForm } = await import("@/components/screens/auth/SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(
      screen.getByLabelText(new RegExp(`^${signUpInventory.nameLabel}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(`^${signUpInventory.emailLabel}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(`^${signUpInventory.passwordLabel}$`, "i")),
    ).toBeInTheDocument();
  });

  it("renders the submit button copy from the oracle inventory", async () => {
    const { SignUpForm } = await import("@/components/screens/auth/SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${signUpInventory.submitProduction}$`, "i"),
      }),
    ).toBeInTheDocument();
  });

  it("renders the sign-in footer link pointing at /sign-in", async () => {
    const { SignUpForm } = await import("@/components/screens/auth/SignUpForm");
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    const link = screen.getByRole("link", {
      name: new RegExp(signUpInventory.footerLink, "i"),
    });
    expect(link).toHaveAttribute("href", "/sign-in");
  });

  // UICONF-06 hardening — defense-in-depth over Plan 12-04 Task 3.
  it("UICONF-06: exactly one role='alert' on duplicate-email path with title.text !== body.text", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "USER_ALREADY_EXISTS", message: "User already exists" },
    });
    const { SignUpForm } = await import("@/components/screens/auth/SignUpForm");
    const user = userEvent.setup();
    render(
      <Wrap>
        <SignUpForm />
      </Wrap>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "Pwa9!testStrong");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
    const alert = screen.getByRole("alert");
    const titleEl = alert.querySelector('[data-slot="alert-title"]');
    const bodyEl = alert.querySelector('[data-slot="alert-description"]');
    const titleText = titleEl?.textContent ?? "";
    const bodyText = bodyEl?.textContent ?? "";
    expect(titleText.length).toBeGreaterThan(0);
    expect(bodyText.length).toBeGreaterThan(0);
    expect(titleText).not.toBe(bodyText);
    // And the strings come from the JSX-oracle-derived inventory tokens.
    expect(titleText).toBe(signUpInventory.duplicate.title.text);
    expect(bodyText).toBe(signUpInventory.duplicate.body.text);
  });
});
