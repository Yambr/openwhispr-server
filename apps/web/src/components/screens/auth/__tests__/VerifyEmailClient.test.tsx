// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — RED tests for VerifyEmailClient (U3).
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

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

const resources = {
  "end-user": {
    "end-user": {
      verify: {
        title: { heading: { text: "Verify your email" } },
        loading: { body: { text: "Verifying your email..." } },
        success: {
          title: { text: "Email verified" },
          body: { text: "Your email is confirmed. You can now sign in." },
          cta: { label: "Sign in" },
        },
        error: {
          title: { text: "Verification failed" },
          body: { text: "This verification link is invalid or has expired. Sign up again." },
          cta: { label: "Back to sign up" },
        },
        // Phase 18.1.1 / Plan 05 / Task 05-01 — AuthShell wrap (D-29..D-31).
        shell: {
          sideTitle: { text: "Verify your email." },
          sideQuote: {
            text: "We sent a sign-in link to your inbox. The link is valid for 30 minutes.",
          },
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

describe("VerifyEmailClient (Phase 07.1 / Plan 07 — U3)", () => {
  beforeEach(() => {
    verifyEmail.mockReset();
  });

  it("renders error state immediately when token is undefined", async () => {
    const { VerifyEmailClient } = await import("../VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token={undefined} />
      </Wrap>,
    );
    expect(await screen.findByText(/verification failed/i)).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it("calls authClient.verifyEmail with token on mount and shows success state", async () => {
    let resolveIt: (v: { data: unknown; error: unknown }) => void = () => {};
    verifyEmail.mockImplementationOnce(
      () =>
        new Promise<{ data: unknown; error: unknown }>((r) => {
          resolveIt = r;
        }),
    );
    const { VerifyEmailClient } = await import("../VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc.token-VALID_123" />
      </Wrap>,
    );
    // Loading state while pending
    expect(screen.getByText(/verifying your email/i)).toBeInTheDocument();
    resolveIt({ data: { status: true }, error: null });
    await waitFor(() => {
      expect(screen.getByText(/email verified/i)).toBeInTheDocument();
    });
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    const arg = verifyEmail.mock.calls[0]?.[0] as { query: { token: string } };
    expect(arg.query.token).toBe("abc.token-VALID_123");
    // sign-in CTA
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/sign-in");
  });

  it("renders error state when verifyEmail returns an error", async () => {
    verifyEmail.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    const { VerifyEmailClient } = await import("../VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /back to sign up/i })).toHaveAttribute(
      "href",
      "/sign-up",
    );
  });

  it("renders error state when verifyEmail returns null/undefined result", async () => {
    verifyEmail.mockResolvedValueOnce(undefined);
    const { VerifyEmailClient } = await import("../VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    });
  });

  it("renders error state when verifyEmail throws", async () => {
    verifyEmail.mockRejectedValueOnce(new Error("network"));
    const { VerifyEmailClient } = await import("../VerifyEmailClient");
    render(
      <Wrap>
        <VerifyEmailClient token="abc" />
      </Wrap>,
    );
    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    });
  });

  // Phase 18.1.1 / Plan 05 / Task 05-01 (D-29..D-31) — AuthShell wrap + status badge.
  describe("AuthShell + status badge (Phase 18.1.1 / Plan 05)", () => {
    it("wraps the screen in AuthShell with localized sideTitle", async () => {
      const { VerifyEmailClient } = await import("../VerifyEmailClient");
      render(
        <Wrap>
          <VerifyEmailClient token={undefined} />
        </Wrap>,
      );
      expect(screen.getByText("Verify your email.")).toBeInTheDocument();
      // <aside> from AuthShell
      expect(screen.getByRole("complementary")).toBeInTheDocument();
    });

    it("renders a status-badge testid in the error branch (no token)", async () => {
      const { VerifyEmailClient } = await import("../VerifyEmailClient");
      render(
        <Wrap>
          <VerifyEmailClient token={undefined} />
        </Wrap>,
      );
      expect(screen.getByTestId("status-badge")).toBeInTheDocument();
    });

    it("renders a status-badge testid in the loading branch (pending token)", async () => {
      let resolveIt: (v: { data: unknown; error: unknown }) => void = () => {};
      verifyEmail.mockImplementationOnce(
        () =>
          new Promise<{ data: unknown; error: unknown }>((r) => {
            resolveIt = r;
          }),
      );
      const { VerifyEmailClient } = await import("../VerifyEmailClient");
      render(
        <Wrap>
          <VerifyEmailClient token="abc" />
        </Wrap>,
      );
      expect(screen.getByTestId("status-badge")).toBeInTheDocument();
      // resolve to avoid dangling promise
      resolveIt({ data: { status: true }, error: null });
    });

    it("renders a status-badge testid in the success branch", async () => {
      verifyEmail.mockResolvedValueOnce({ data: { status: true }, error: null });
      const { VerifyEmailClient } = await import("../VerifyEmailClient");
      render(
        <Wrap>
          <VerifyEmailClient token="abc" />
        </Wrap>,
      );
      await waitFor(() => {
        expect(screen.getByText(/email verified/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId("status-badge")).toBeInTheDocument();
    });

    it("centers the CardContent via the text-center class", async () => {
      const { VerifyEmailClient } = await import("../VerifyEmailClient");
      const { container } = render(
        <Wrap>
          <VerifyEmailClient token={undefined} />
        </Wrap>,
      );
      // Any element with text-center class inside the rendered tree.
      expect(container.querySelector(".text-center")).not.toBeNull();
    });
  });
});
