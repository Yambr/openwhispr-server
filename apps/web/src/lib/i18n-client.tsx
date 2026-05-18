// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 + Phase 10 / Plan 02 — i18next App-Router Client provider.
//
// RESEARCH § Pattern 6 + Pitfall 1: the Client provider receives a serialized
// `resources` snapshot from the nearest RSC parent and never re-fetches.
// `resources` is a plain object (no functions / class instances / Dates) so
// the RSC→Client serialization boundary is safe.
//
// Implementation: create the instance synchronously in `useMemo` and pass it
// to `I18nextProvider`. Synchronous `init()` is fine when `resources` are
// inlined — no backend plugin needed on the Client.
//
// Phase 10 / Plan 02 registers `i18next-icu` here as well so client-side
// re-renders (e.g. when a `count` interpolation changes) use the same CLDR
// plural rules as the SSR pass. The plugin operates entirely on the
// in-memory instance, so it does not break the RSC→Client serialization
// boundary (only the plain `resources` snapshot crosses the wire).
"use client";

import { createInstance } from "i18next";
import ICU from "i18next-icu";
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
    i.use(ICU);
    i.init({
      lng,
      // Phase 53 / Plan 53-30 — mirror server's fallbackLng to avoid
      // hydration mismatch (React error #418) when a key is missing
      // from the active-locale bundle. Server returns the EN fallback
      // string; client without fallback returned the key literal —
      // even one such divergence triggers React's hydration panic.
      // `ns` order is sorted to stabilise i18next's internal counter
      // (any nondeterminism in Object.keys insertion order would
      // shift useId() outputs across server/client).
      fallbackLng: "en",
      resources: { [lng]: resources },
      ns: Object.keys(resources).sort(),
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
    return i;
  }, [lng, resources]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
