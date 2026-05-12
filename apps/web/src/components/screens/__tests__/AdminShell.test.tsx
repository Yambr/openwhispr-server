// Phase 07.1 / Plan 06 — AdminShell component tests (RED before GREEN).
//
// AdminShell wraps the (admin) route group. NO session check (D-ADMIN-1 —
// Traefik basic-auth gates /admin/* at the edge). NO sign-out button.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { ThemeProvider } from "@/lib/theme-provider";
import { AdminShell } from "../AdminShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/observability",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const resources = {
  admin: {
    admin: {
      observability: { nav: { sidebar: { label: "Observability" } } },
      config: { nav: { sidebar: { label: "Configuration" } } },
    },
  },
  common: { common: { theme: { toggle: { label: "Toggle theme" } } } },
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

describe("AdminShell (Phase 07.1 / Plan 06)", () => {
  it("renders two admin nav rows", () => {
    render(
      <Wrap>
        <AdminShell>
          <span>child</span>
        </AdminShell>
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /observability/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /configuration/i })).toBeInTheDocument();
  });

  it("renders no sign-out button (D-ADMIN-1)", () => {
    render(
      <Wrap>
        <AdminShell>
          <span>child</span>
        </AdminShell>
      </Wrap>,
    );
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("renders children in main", () => {
    render(
      <Wrap>
        <AdminShell>
          <span data-testid="ac">admin-child</span>
        </AdminShell>
      </Wrap>,
    );
    expect(screen.getByTestId("ac")).toHaveTextContent("admin-child");
  });
});
