// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:15-25 (OIDC button row inside ScreenSignIn)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:326-336 (Btn).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// Scenarios (matches RESEARCH §9 conditional-render contract):
//   - 0 providers -> 0 buttons (zero-N gate, T-12.04-02 flicker mitigation downstream).
//   - 1 provider  -> exactly 1 button labelled per inventory.
//   - 3 providers -> exactly 3 buttons; generic "oidc" id resolves to the
//     "sso" i18n slot (OidcButtons labelKey).
//
// Styling-deviation note: the oracle's third button uses kind="ghost"
// (screens-user.jsx:22). Production renders all three as Button
// variant="outline". This is a non-semantic styling deviation captured in
// the SUMMARY; the conformance test asserts only on role/name/count.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { oidcInventory } from "./__fixtures__/jsx-inventory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sign-in",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));

const resources = {
  "end-user": {
    "end-user": {
      signin: {
        oidc: {
          google: { label: oidcInventory.providers[0].label },
          github: { label: oidcInventory.providers[1].label },
          sso: { label: oidcInventory.providers[2].label },
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

function stubProvidersFetch(
  providers: ReadonlyArray<{ id: "google" | "github" | "oidc"; name: string }>,
): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      providers: providers.map((p) => ({ id: p.id, name: p.name, enabled: true })),
      emailVerification: { required: true, configured: true },
    }),
  } as unknown as Response);
}

describe("OidcButtons conformance vs screens-user.jsx:15-25", () => {
  beforeEach(() => {
    // Silence the warn the hook emits on rejected fetches.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("0 providers -> 0 buttons (zero-N gate)", async () => {
    stubProvidersFetch(oidcInventory.empty);
    const { OidcButtons } = await import("@/components/screens/auth/OidcButtons");
    const { container } = render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("button").length).toBe(0);
    });
  });

  it("1 provider -> exactly 1 button labelled per inventory", async () => {
    stubProvidersFetch(oidcInventory.single);
    const { OidcButtons } = await import("@/components/screens/auth/OidcButtons");
    render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );
    expect(
      await screen.findByRole("button", { name: new RegExp(oidcInventory.single[0].label, "i") }),
    ).toBeInTheDocument();
    // Negative assertions: the other two slots must not render.
    expect(
      screen.queryByRole("button", { name: new RegExp(oidcInventory.providers[1].label, "i") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(oidcInventory.providers[2].label, "i") }),
    ).not.toBeInTheDocument();
  });

  it("3 providers -> exactly 3 buttons including the generic 'oidc' -> 'sso' label slot", async () => {
    stubProvidersFetch(oidcInventory.providers.map((p) => ({ id: p.id, name: p.name })));
    const { OidcButtons } = await import("@/components/screens/auth/OidcButtons");
    const { container } = render(
      <Wrap>
        <OidcButtons namespace="signin" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("button").length).toBe(3);
    });
    for (const p of oidcInventory.providers) {
      expect(screen.getByRole("button", { name: new RegExp(p.label, "i") })).toBeInTheDocument();
    }
  });
});
