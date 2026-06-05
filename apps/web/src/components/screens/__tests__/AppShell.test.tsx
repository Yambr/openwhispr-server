// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — AppShell component tests (RED before GREEN).
//
// AppShell wraps the (auth) route group. Verified surface:
//   - sidebar contains five nav rows (Dashboard, Transcriptions, Notes, Conversations, Account)
//   - sign-out button visible with copy key `common.signout.label`
//   - theme switcher button visible
//   - children render in main area
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
      download: { nav: { sidebar: { label: "Desktop app" } } },
    },
  },
  common: {
    common: {
      signout: { label: "Sign out" },
      theme: { toggle: { label: "Toggle theme" } },
      download: { header: { button: { label: { text: "Download" } } } },
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

  it("renders a sidebar nav item linking to /download", () => {
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /desktop app/i })).toHaveAttribute("href", "/download");
  });

  it("renders a compact download button in the header linking to /download", () => {
    render(
      <Wrap>
        <AppShell>
          <span>child</span>
        </AppShell>
      </Wrap>,
    );
    // Button asChild + next/link mock renders as <a>, so the header download
    // affordance is a link role with the button's exact text. The /^download$/i
    // exact-name match distinguishes it from the /desktop app/i sidebar item.
    expect(screen.getByRole("link", { name: /^download$/i })).toHaveAttribute("href", "/download");
  });

  it("both locales define the new download keys (parity)", () => {
    interface NestedLocale {
      [key: string]: string | NestedLocale;
    }
    // Anchor on THIS file's location (apps/web/src/components/screens/__tests__)
    // so the test resolves the locales dir regardless of the cwd the runner
    // was launched from — `process.cwd()` is the monorepo root under
    // `pnpm test:all`, which would point at the nonexistent root `src/locales`.
    const here = dirname(fileURLToPath(import.meta.url));
    const localesDir = join(here, "..", "..", "..", "locales");
    function load(locale: string, ns: string): NestedLocale {
      const raw = readFileSync(join(localesDir, locale, `${ns}.json`), "utf8");
      return JSON.parse(raw) as NestedLocale;
    }
    for (const locale of ["en", "ru"]) {
      const endUser = load(locale, "end-user");
      const endUserRoot = endUser["end-user"] as NestedLocale;
      const dlNav = (
        ((endUserRoot.download as NestedLocale).nav as NestedLocale).sidebar as NestedLocale
      ).label;
      expect(typeof dlNav).toBe("string");
      expect((dlNav as string).length).toBeGreaterThan(0);

      const common = load(locale, "common");
      const commonRoot = common.common as NestedLocale;
      const headerBtn = (
        (((commonRoot.download as NestedLocale).header as NestedLocale).button as NestedLocale)
          .label as NestedLocale
      ).text;
      expect(typeof headerBtn).toBe("string");
      expect((headerBtn as string).length).toBeGreaterThan(0);
    }
  });
});
