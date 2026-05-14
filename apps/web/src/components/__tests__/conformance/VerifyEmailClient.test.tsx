// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:186-260 (ScreenVerify).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// Documented design deviation (RESEARCH §16 / Plan 07 D-UX3): the oracle
// ScreenVerify enumerates FOUR variants (pending / verifying / success /
// error). The shipped VerifyEmailClient collapses these to THREE
// (loading / success / error) because the RSC route already validates
// `?token=` before mounting the client component — there is no user-
// initiated "pending" branch to land on. This conformance test asserts
// the THREE shipped variants; the oracle's "pending" variant is recorded
// in the inventory fixture for any future plan that adds a standalone
// "check your inbox" screen.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { verifyEmailInventory } from "./__fixtures__/jsx-inventory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/verify-email",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const verifyEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    verifyEmail: (...args: unknown[]) => verifyEmail(...args),
  },
}));

const successVariant = verifyEmailInventory.variants.find((v) => v.name === "success") as {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};
const errorVariant = verifyEmailInventory.variants.find((v) => v.name === "error") as {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};
const loadingVariant = verifyEmailInventory.variants.find((v) => v.name === "loading") as {
  body: string;
};

const resources = {
  "end-user": {
    "end-user": {
      verify: {
        title: { heading: { text: "Verify your email" } },
        loading: { body: { text: loadingVariant.body } },
        success: {
          title: { text: successVariant.title },
          body: { text: successVariant.body },
          cta: { label: successVariant.ctaLabel },
        },
        error: {
          title: { text: errorVariant.title },
          body: { text: errorVariant.body },
          cta: { label: errorVariant.ctaLabel },
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

describe("VerifyEmailClient conformance vs screens-user.jsx:186-260 (3 of 4 oracle variants shipped)", () => {
  beforeEach(() => {
    verifyEmail.mockReset();
  });

  it("loading variant renders the inventory's loading body copy", async () => {
    // Never-resolving promise pins the component on the loading branch.
    verifyEmail.mockReturnValueOnce(new Promise(() => undefined));
    const { VerifyEmailClient } = await import("@/components/screens/auth/VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc.token-VALID_123" />
      </Wrap>,
    );
    expect(screen.getByText(new RegExp(loadingVariant.body, "i"))).toBeInTheDocument();
  });

  it("success variant renders title + body + sign-in CTA pointing at /sign-in", async () => {
    verifyEmail.mockResolvedValueOnce({ data: { status: true }, error: null });
    const { VerifyEmailClient } = await import("@/components/screens/auth/VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc.token-VALID_123" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByText(new RegExp(successVariant.title, "i"))).toBeInTheDocument();
    });
    expect(screen.getByText(new RegExp(successVariant.body, "i"))).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: new RegExp(`^${successVariant.ctaLabel}$`, "i") });
    expect(cta).toHaveAttribute("href", successVariant.ctaHref);
  });

  it("error variant renders title + body + back-to-sign-up CTA pointing at /sign-up (token undefined)", async () => {
    const { VerifyEmailClient } = await import("@/components/screens/auth/VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token={undefined} />
      </Wrap>,
    );
    expect(await screen.findByText(new RegExp(errorVariant.title, "i"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(errorVariant.body, "i"))).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: new RegExp(errorVariant.ctaLabel, "i") });
    expect(cta).toHaveAttribute("href", errorVariant.ctaHref);
  });

  it("error variant also renders when verifyEmail returns an error result", async () => {
    verifyEmail.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    const { VerifyEmailClient } = await import("@/components/screens/auth/VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByText(new RegExp(errorVariant.title, "i"))).toBeInTheDocument();
    });
  });
});
