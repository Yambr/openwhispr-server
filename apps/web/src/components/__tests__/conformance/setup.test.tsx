// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/ui.jsx:229-316 (AuthShell)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:326-336 (Btn)
//   + .planning/phases/07-frontend-ui-spec/design/ui.jsx:338-352 (Field).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// DOCUMENTED DESIGN DEVIATION (RESEARCH §16 / D-20): no /setup JSX oracle.
// The Phase-07 screens-user.jsx + ui.jsx pair never produced a dedicated
// `ScreenSetup` template. The wizard's single-page, three-section
// (Identity → Workspace → Review) layout is an ADMIN-02 invention and
// composes the shared AuthShell + Btn + Field primitives. This test asserts
// the composition is faithful to the primitives' contracts, not to a
// non-existent oracle artboard.
//
// What this asserts:
//   - 3 anchor sections with ids: identity, workspace, review.
//   - Stepper present via [data-slot="stepper"] (ui/stepper.tsx vendored
//     primitive used by SetupForm Plan 12-03 Task 4).
//   - Submit button labelled per the production i18n inventory.
//   - All 5 form labels (Name, Email, Password, Workspace name, Timezone)
//     are present (Field primitive — ui.jsx:338-352).
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import enCommon from "@/locales/en/common.json";
import enEndUser from "@/locales/en/end-user.json";
import { setupInventory } from "./__fixtures__/jsx-inventory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/setup",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const resources = {
  "end-user": enEndUser as unknown as Record<string, unknown>,
  common: enCommon as unknown as Record<string, unknown>,
};

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

beforeEach(() => {
  // Minimal IntersectionObserver stub for happy-dom (the API is absent there).
  // biome-ignore lint/suspicious/noExplicitAny: minimal IO shim
  (globalThis as any).IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };
});

describe("SetupForm conformance — documented design deviation (no /setup JSX oracle)", () => {
  it(`section anchors exist for ids: ${setupInventory.sectionIds.join(", ")}`, async () => {
    const { SetupForm } = await import("@/components/screens/auth/SetupForm");
    const { container } = render(
      <Wrap>
        <SetupForm />
      </Wrap>,
    );
    for (const id of setupInventory.sectionIds) {
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
  });

  it("Stepper primitive renders ([data-slot='stepper'])", async () => {
    const { SetupForm } = await import("@/components/screens/auth/SetupForm");
    const { container } = render(
      <Wrap>
        <SetupForm />
      </Wrap>,
    );
    expect(container.querySelector(`[data-slot="${setupInventory.stepperSlot}"]`)).not.toBeNull();
  });

  it("all 5 Field labels render (Name, Email, Password, Workspace name, Timezone)", async () => {
    const { SetupForm } = await import("@/components/screens/auth/SetupForm");
    render(
      <Wrap>
        <SetupForm />
      </Wrap>,
    );
    expect(
      screen.getByLabelText(new RegExp(`^${setupInventory.labels.name}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(`^${setupInventory.labels.email}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(`^${setupInventory.labels.password}$`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(setupInventory.labels.workspace, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(setupInventory.labels.timezone, "i")),
    ).toBeInTheDocument();
  });

  it("submit button renders with the production submit copy", async () => {
    const { SetupForm } = await import("@/components/screens/auth/SetupForm");
    render(
      <Wrap>
        <SetupForm />
      </Wrap>,
    );
    expect(
      screen.getByRole("button", {
        name: new RegExp(setupInventory.labels.submit, "i"),
      }),
    ).toBeInTheDocument();
  });

  it("wizard heading renders ('Set up your OpenWhispr server')", async () => {
    const { SetupForm } = await import("@/components/screens/auth/SetupForm");
    render(
      <Wrap>
        <SetupForm />
      </Wrap>,
    );
    expect(screen.getByText(new RegExp(setupInventory.heading, "i"))).toBeInTheDocument();
  });
});
