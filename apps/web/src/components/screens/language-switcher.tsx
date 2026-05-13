// Phase 10 / Plan 02 — Language switcher (en | ru toggle).
//
// Mounted in AppShell next to the theme switcher (authenticated layout) and
// independently from the public route layouts that compose with the root
// layout. The component is a small client island:
//   1. Reads the current locale from i18next's `i18n.language`.
//   2. On click, POSTs to `/api/locale` to persist `NEXT_LOCALE`.
//   3. Calls `router.refresh()` so the RSC subtree re-renders with the new
//      `x-locale` header on the next request.
//
// All labels come through i18next keys (`common.language.english`,
// `common.language.russian`, `common.language.label`) — no Cyrillic
// literals appear in this source file, which keeps the
// `tools/lint-english.ts` scanner clean.
"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type SupportedLocale = "en" | "ru";
const LOCALES: readonly SupportedLocale[] = ["en", "ru"];

export function LanguageSwitcher(): React.JSX.Element {
  const { t, i18n } = useTranslation("common");
  const router = useRouter();
  const active = (i18n.language === "ru" ? "ru" : "en") as SupportedLocale;

  async function pick(next: SupportedLocale): Promise<void> {
    if (next === active) return;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    // Re-fetches the RSC tree against the now-updated cookie so the new
    // `x-locale` header drives the layout language.
    router.refresh();
  }

  return (
    <fieldset
      aria-label={t("common.language.label.label")}
      className="inline-flex items-center gap-1 border-0 p-0"
    >
      {LOCALES.map((locale) => {
        const label =
          locale === "en" ? t("common.language.english.label") : t("common.language.russian.label");
        const isActive = locale === active;
        return (
          <Button
            aria-pressed={isActive}
            key={locale}
            onClick={() => {
              void pick(locale);
            }}
            size="sm"
            variant={isActive ? "default" : "outline"}
          >
            {label}
          </Button>
        );
      })}
    </fieldset>
  );
}
