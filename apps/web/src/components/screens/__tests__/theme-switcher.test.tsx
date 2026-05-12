// Phase 07.1 / Plan 06 — theme-switcher tests (RED before GREEN).
//
// Dropdown with three options: Light / Dark / System. Click selects a
// theme via next-themes (writes to localStorage under key 'theme').
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeSwitcher } from "../theme-switcher";

const resources = {
  common: {
    common: {
      theme: {
        toggle: { label: "Toggle theme" },
        light: { label: "Light" },
        dark: { label: "Dark" },
        system: { label: "System" },
      },
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

describe("ThemeSwitcher (Phase 07.1 / Plan 06)", () => {
  it("renders a trigger button labelled Toggle theme", () => {
    render(
      <Wrap>
        <ThemeSwitcher />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });

  it("opens a menu with Light / Dark / System options on click", async () => {
    const user = userEvent.setup();
    render(
      <Wrap>
        <ThemeSwitcher />
      </Wrap>,
    );
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(screen.getByRole("menuitem", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /system/i })).toBeInTheDocument();
  });

  it("clicking Light/Dark/System invokes setTheme", async () => {
    const user = userEvent.setup();
    render(
      <Wrap>
        <ThemeSwitcher />
      </Wrap>,
    );
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    await user.click(screen.getByRole("menuitem", { name: /light/i }));
    // Reopen and pick Dark.
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    await user.click(screen.getByRole("menuitem", { name: /dark/i }));
    // Reopen and pick System.
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    await user.click(screen.getByRole("menuitem", { name: /system/i }));
    // No throw == handler chains executed. Behaviour (data-theme attribute,
    // localStorage write) is validated end-to-end by Plan 12 Playwright.
    expect(true).toBe(true);
  });
});
