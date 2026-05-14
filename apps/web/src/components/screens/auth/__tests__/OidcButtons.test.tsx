// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-04 — RED+GREEN tests for the rewritten OidcButtons.
//
// Replaces the previous NEXT_PUBLIC_OIDC_PROVIDERS env-driven render with
// a fetch-driven render via the new `useAuthProviders` hook. Test gates:
//   1. providers:[] -> renders nothing (zero buttons; T-12.04-02 zero-N gate).
//   2. providers:[google] -> exactly 1 button labelled per i18n key.
//   3. providers:[google, github, oidc] -> 3 buttons; the generic "oidc"
//      slot resolves to the "sso" i18n label.
//   4. Loading window -> component returns null (flicker mitigation).
//   5. Fetch rejects -> component renders nothing (no broken UI).
//
// Mocking surface (process boundaries only — no internal logic mocked):
//   - vi.spyOn(globalThis, "fetch") to deterministically control the
//     /api/auth/providers response.
//   - vi.mock("@/lib/auth-client") to keep social-signin a deterministic
//     no-op (the OIDC button's onClick path is not exercised here; sibling
//     SignInForm.test.tsx exercises the click → authClient.signIn.social
//     flow on the SignInForm composite).
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sign-in",
}));

const signInSocial = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { social: (...args: unknown[]) => signInSocial(...args) },
  },
}));

const resources = {
  "end-user": {
    "end-user": {
      signin: {
        oidc: {
          google: { label: "Continue with Google" },
          github: { label: "Continue with GitHub" },
          sso: { label: "Continue with SSO" },
        },
      },
      signup: {
        oidc: {
          google: { label: "Sign up with Google" },
          github: { label: "Sign up with GitHub" },
          sso: { label: "Sign up with SSO" },
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

function stubProvidersFetch(payload: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response);
}

describe("OidcButtons (Phase 12 / Plan 12-04)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    signInSocial.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when /api/auth/providers returns zero providers", async () => {
    stubProvidersFetch({
      providers: [],
      emailVerification: { required: true, configured: false },
    });

    const { OidcButtons } = await import("../OidcButtons");
    const { container } = render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );

    // The loading→null window resolves to the data→null window for zero providers.
    await waitFor(() => {
      expect(container.querySelectorAll("button").length).toBe(0);
    });
  });

  it("renders exactly one button when one provider is configured", async () => {
    stubProvidersFetch({
      providers: [{ id: "google", name: "Google", enabled: true }],
      emailVerification: { required: true, configured: true },
    });

    const { OidcButtons } = await import("../OidcButtons");
    render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with sso/i })).not.toBeInTheDocument();
  });

  it("renders three buttons when google + github + oidc are configured", async () => {
    stubProvidersFetch({
      providers: [
        { id: "google", name: "Google", enabled: true },
        { id: "github", name: "GitHub", enabled: true },
        { id: "oidc", name: "Single Sign-On", enabled: true },
      ],
      emailVerification: { required: true, configured: true },
    });

    const { OidcButtons } = await import("../OidcButtons");
    render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    // Generic "oidc" -> "sso" slot in i18n labelKey (PATTERNS.md keep-verbatim).
    expect(screen.getByRole("button", { name: /continue with sso/i })).toBeInTheDocument();
  });

  it("returns null while loading (no flicker before providers resolve)", async () => {
    // Never-resolving fetch -> hook stays in loading=true.
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => undefined));

    const { OidcButtons } = await import("../OidcButtons");
    const { container } = render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );

    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("renders nothing when fetch rejects (fail closed, no broken UI)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const { OidcButtons } = await import("../OidcButtons");
    const { container } = render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );

    // Wait until the hook settles into providers=[] post-rejection.
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});
