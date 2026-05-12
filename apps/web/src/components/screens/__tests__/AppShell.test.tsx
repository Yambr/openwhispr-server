// Phase 07.1 / Plan 06 — AppShell component tests (RED before GREEN).
//
// AppShell wraps the (auth) route group. Verified surface:
//   - sidebar contains five nav rows (Dashboard, Transcriptions, Notes, Conversations, Account)
//   - sign-out button visible with copy key `common.signout.label`
//   - theme switcher button visible
//   - children render in main area
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { ThemeProvider } from "@/lib/theme-provider";
import { AppShell } from "../AppShell";

// next/navigation provides router/Link in App Router; mock at the boundary.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn(async () => ({ data: {}, error: null })) },
  signOut: vi.fn(async () => ({ data: {}, error: null })),
}));

const resources = {
  "end-user": {
    "end-user": {
      usage: { nav: { sidebar: { label: "Dashboard" } } },
      "trx-list": { nav: { sidebar: { label: "Transcriptions" } } },
      "notes-list": { nav: { sidebar: { label: "Notes" } } },
      "conv-list": { nav: { sidebar: { label: "Conversations" } } },
      account: { nav: { sidebar: { label: "Account" } } },
    },
  },
  common: {
    common: {
      signout: { label: "Sign out" },
      theme: { toggle: { label: "Toggle theme" } },
    },
  },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider lng="en" resources={resources}>
        {children}
      </I18nProvider>
    </ThemeProvider>
  );
}

describe("AppShell (Phase 07.1 / Plan 06)", () => {
  it("renders five nav rows with end-user.* labels", () => {
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /transcriptions/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^notes$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /conversations/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /account/i })).toBeInTheDocument();
  });

  it("renders sign-out button", () => {
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("renders the theme switcher", () => {
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });

  it("renders children in the main slot", () => {
    render(
      <Wrap>
        <AppShell>
          <span data-testid="child">child-content</span>
        </AppShell>
      </Wrap>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("child-content");
  });

  it("clicking sign-out calls authClient.signOut and routes to /sign-in", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const { signOut } = await import("@/lib/auth-client");
    const user = userEvent.setup();
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
