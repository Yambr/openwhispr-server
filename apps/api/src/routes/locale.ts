// SPDX-License-Identifier: Apache-2.0
// Phase 15 / Plan 02 / Task 1 — Public GET /api/locale.
//
// Returns the locale negotiated by the i18next-http-middleware from the
// Accept-Language header as a small JSON body `{ locale }`. Used by:
//   1. The desktop client / web app to read the server's negotiated
//      locale before any user preference is set (e.g. on first load
//      before the language switcher's cookie exists).
//   2. The Phase 13 @cjm-6.2 / Phase 15 @cjm-traefik-host-split
//      Gherkin scenarios — proves api.localhost host-split routing
//      reaches the Fastify API (not the Next.js web container).
//
// Negotiation: relies on `req.language` set by the i18nPlugin
// (apps/api/src/i18n/init.ts). i18next-http-middleware's
// LanguageDetector reads Accept-Language and picks the best match from
// the configured `supportedLngs: ['en','ru']` set, falling back to
// `fallbackLng: 'en'` when no supported language is offered.
//
// Public — no auth guard, no DB access, no env reads. Rate-limit budget
// matches /api/auth/providers (60/min/IP) since this is also an
// unauthenticated discovery endpoint exposed at the public edge.
//
// Cache-Control: `no-store` because the negotiated locale depends
// entirely on the per-request Accept-Language header — caching would
// poison clients of upstream proxies sitting between the desktop and
// Traefik. The body is tiny so cache hits would save negligible bytes.
//
// Info-leak gate: response keys are EXACTLY `['locale']`. Adding a
// field requires extending the unit test that asserts the key set.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SUPPORTED = ["en", "ru"] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED as readonly string[]).includes(value);
}

/**
 * Resolve the negotiated locale from a Fastify request.
 *
 * Order of resolution:
 *   1. `req.language` — set by i18next-http-middleware (preferred).
 *      The middleware honors q-weighted Accept-Language ordering and
 *      already constrains to `supportedLngs`.
 *   2. fallback `en` — matches the i18next `fallbackLng`.
 *
 * Exported for unit-testing the pure function separately from the
 * Fastify wiring. Tests against the live route exercise the full path.
 */
export function resolveLocale(req: FastifyRequest): SupportedLocale {
  const lang = (req as unknown as { language?: string }).language;
  if (typeof lang === "string") {
    // i18next-http-middleware may return a fully-qualified tag like
    // `ru-RU`; squash to the primary subtag before checking.
    const primary = lang.toLowerCase().split(/[-_]/)[0];
    if (isSupported(primary)) return primary;
  }
  return "en";
}

// biome-ignore lint/complexity/noBannedTypes: forward-compat — zero deps today; keep shape so future env/db hooks land non-breaking
export type LocaleDeps = Record<string, never>;

export const buildLocaleRoutes = (_deps: LocaleDeps = {} as LocaleDeps) =>
  async function localeRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/locale",
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const locale = resolveLocale(req);
        return reply
          .header("cache-control", "no-store")
          .header("content-type", "application/json; charset=utf-8")
          .code(200)
          .send({ locale });
      },
    });
  };

export default buildLocaleRoutes;
