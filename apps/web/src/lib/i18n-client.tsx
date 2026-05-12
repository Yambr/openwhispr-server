// Phase 07.1 / Plan 06 — i18next App-Router Client provider (D-STACK-7).
//
// RESEARCH § Pattern 6 + Pitfall 1: the Client provider receives a serialized
// `resources` snapshot from the nearest RSC parent and never re-fetches.
// `resources` is a plain object (no functions / class instances / Dates) so
// the RSC→Client serialization boundary is safe.
//
// Implementation: create the instance synchronously in `useMemo` and pass it
// to `I18nextProvider`. Synchronous `init()` is fine when `resources` are
// inlined — no backend plugin needed on the Client.
"use client";

import { createInstance } from "i18next";
import { type ReactNode, useMemo } from "react";
import { I18nextProvider } from "react-i18next";

export function I18nProvider({
  lng,
  resources,
  children,
}: {
  lng: string;
  resources: Record<string, Record<string, unknown>>;
  children: ReactNode;
}): React.JSX.Element {
  const i18n = useMemo(() => {
    const i = createInstance();
    i.init({
      lng,
      resources: { [lng]: resources },
      ns: Object.keys(resources),
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
    return i;
  }, [lng, resources]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
