// Phase 07.1 / Plan 06 — i18next App-Router server instance (D-STACK-7).
//
// RESEARCH § Pattern 6. v1 ships English only; the locale negotiation chain
// (Accept-Language → cookie NEXT_LOCALE → 'en') will land in Phase 10 when
// Russian translations join the bundles. For now `lng` is effectively 'en'
// at every call site.
//
// CRITICAL: create a fresh instance per request (Pitfall 1). Re-using a
// shared module-level singleton would leak per-request state into shared
// memory under concurrent RSC renders.
//
// Anti-pattern: do NOT install `next-i18next` — Pages Router only.
import { createInstance, type i18n } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";

export async function getServerI18n(lng: string, ns: string[]): Promise<i18n> {
  const i = createInstance();
  await i
    .use(
      resourcesToBackend(
        (language: string, namespace: string) => import(`@/locales/${language}/${namespace}.json`),
      ),
    )
    .init({
      lng,
      fallbackLng: "en",
      ns,
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
  return i;
}
