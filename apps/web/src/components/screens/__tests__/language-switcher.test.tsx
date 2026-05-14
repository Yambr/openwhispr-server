// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 02 — LanguageSwitcher unit tests.
//
// The component is a small client island that:
//   1. Reads the active locale from i18next (`i18n.language`).
//   2. POSTs to /api/locale on toggle.
//   3. Calls router.refresh() so the RSC tree picks up the new `x-locale`.
// All three behaviors are exercised here with `next/navigation` mocked at
// the process boundary (allowed by CLAUDE.md — internal logic uses real
// react-i18next).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { LanguageSwitcher } from "../language-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/sign-in",
}));

const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

const resources = {
  common: {
    common: {
      language: {
        label: { label: "Language" },
        english: { label: "English" },
        russian: { label: "Russian" },
      },
    },
  },
} as Record<string, Record<string, unknown>>;

beforeEach(() => {
  fetchSpy.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LanguageSwitcher (Phase 10 / Plan 02)", () => {
  it("renders en + ru buttons and marks the active locale aria-pressed", () => {
    render(
      <I18nProvider lng="en" resources={resources}>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Russian" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("POSTs to /api/locale and calls router.refresh on toggle", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider lng="en" resources={resources}>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Russian" }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/locale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ locale: "ru" }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("no-ops when clicking the already-active locale", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider lng="en" resources={resources}>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
