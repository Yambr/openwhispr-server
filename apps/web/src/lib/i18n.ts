// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 + Phase 10 / Plan 02 — i18next App-Router server instance.
//
// RESEARCH § Pattern 6. Phase 07.1 shipped en-only with `lng = "en"` hard
// coded at the call site; Phase 10 / Plan 02 wires the full Accept-Language
// → NEXT_LOCALE cookie chain via the Edge middleware (`x-locale` request
// header), so `lng` here is now whatever the layout reads from
// `headers().get('x-locale')`.
//
// CRITICAL: create a fresh instance per request (Pitfall 1). Re-using a
// shared module-level singleton would leak per-request state into shared
// memory under concurrent RSC renders.
//
// Phase 10 / Plan 02 also registers the `i18next-icu` plugin so the server
// renders match the client's ICU plural categories byte-for-byte (the
// client constructor in `i18n-client.tsx` registers the same plugin).
//
// Anti-pattern: do NOT install `next-i18next` — Pages Router only.
import { createInstance, type i18n } from "i18next";
import ICU from "i18next-icu";
import resourcesToBackend from "i18next-resources-to-backend";

export async function getServerI18n(lng: string, ns: string[]): Promise<i18n> {
  const i = createInstance();
  await i
    .use(ICU)
    .use(
      resourcesToBackend(
        (language: string, namespace: string) => import(`@/locales/${language}/${namespace}.json`),
      ),
    )
    .init({
      lng,
      fallbackLng: "en",
      // Phase 53 / Plan 53-30 — sort ns so server and client both
      // initialise i18next with the same order. The internal id
      // counter that useId() depends on consumes ns in init order;
      // any divergence between server/client triggers React #418.
      ns: [...ns].sort(),
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
  return i;
}
