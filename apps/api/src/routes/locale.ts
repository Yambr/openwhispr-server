// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 15 / Plan 02 / Task 1 — Public GET /api/locale.
// Quick-task 260524-u00 / Task A5 — POST /api/locale sibling.
//
// GET returns the locale negotiated by the i18next-http-middleware from the
// Accept-Language header as a small JSON body `{ locale }`. Used by:
//   1. The desktop client / web app to read the server's negotiated
//      locale before any user preference is set (e.g. on first load
//      before the language switcher's cookie exists).
//   2. The Phase 13 @cjm-6.2 / Phase 15 @cjm-traefik-host-split
//      Gherkin scenarios — proves api.localhost host-split routing
//      reaches the Fastify API (not the Next.js web container).
//
// POST persists the user's explicit choice from the language switcher:
//   - Always: Set-Cookie i18next=<locale>; HttpOnly; SameSite=Lax; Path=/;
//     Max-Age=1y; Secure when request was https. Future requests are
//     detected by i18next-http-middleware's cookie LanguageDetector
//     (cookie name `i18next` is its built-in default; see
//     apps/api/src/i18n/init.ts:155 `i18nMiddleware.handle(i18n)` call
//     which does not override `cookieName`).
//   - When authenticated (req.user present): also UPDATE users.locale so
//     the choice survives cookie clears + cross-device sign-in.
//
// Negotiation (GET): relies on `req.language` set by the i18nPlugin
// (apps/api/src/i18n/init.ts). i18next-http-middleware's
// LanguageDetector reads Accept-Language and picks the best match from
// the configured `supportedLngs: ['en','ru']` set, falling back to
// `fallbackLng: 'en'` when no supported language is offered.
//
// Public — no auth guard, no DB access on GET. POST is also auth-optional
// (anonymous users use it on the sign-in/sign-up pages, which is exactly
// the bug peer reported in chart 1.0.5). Rate-limit: GET 60/min/IP
// (unauth discovery), POST 10/min/IP (write endpoint per LOCKER-04).
//
// Cache-Control: `no-store` because the negotiated locale depends
// entirely on the per-request Accept-Language header — caching would
// poison clients of upstream proxies sitting between the desktop and
// Traefik. The body is tiny so cache hits would save negligible bytes.
//
// Info-leak gate: response keys are EXACTLY `['locale']`. Adding a
// field requires extending the unit test that asserts the key set.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { LocaleSetRequest, LocaleSetResponse } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

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
  const lang = req.language;
  if (typeof lang === "string") {
    // i18next-http-middleware may return a fully-qualified tag like
    // `ru-RU`; squash to the primary subtag before checking.
    // Phase 52 / Plan 52-04b — `String.split()[0]` is `string | undefined`
    // under `noUncheckedIndexedAccess`. Default to empty string so
    // `isSupported("")` returns false and we fall through to `"en"`.
    const primary = lang.toLowerCase().split(/[-_]/)[0] ?? "";
    if (isSupported(primary)) return primary;
  }
  return "en";
}

// Quick-task 260524-u00 / Task A5 — LocaleDeps gains a `db` handle so
// POST /api/locale can UPDATE users.locale for authenticated callers.
// Mirrors CheckUserDeps shape (apps/api/src/routes/check-user.ts:28-30).
export interface LocaleDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildLocaleRoutes = (deps: LocaleDeps) =>
  async function localeRoutes(app: FastifyInstance): Promise<void> {
    const { db } = deps;
    app.route({
      method: "GET",
      url: "/api/locale",
      // Phase 19b / SR-19b.3 — opt out of the global dualAuthHook so this
      // route is genuinely public (its doc comment has always claimed
      // "Public — no auth guard, no DB access, no env reads"). The
      // missing `auth: false` was a Phase 15 production bug that
      // surfaced when @cjm-traefik-host-split was finally executable
      // post-STRUCT-05 fix — every prior phase saw the scenario as
      // @expected-red and the regression slipped through.
      config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const locale = resolveLocale(req);
        return reply
          .header("cache-control", "no-store")
          .header("content-type", "application/json; charset=utf-8")
          .code(200)
          .send({ locale });
      },
    });

    // POST /api/locale — Quick-task 260524-u00 / Task A5 / Plan A5.
    //
    // Public (auth: false) because the language switcher fires from the
    // unauthenticated sign-in / sign-up pages too — that's the exact
    // path peer reported as 404 on chart 1.0.5. When req.user is
    // present we ALSO persist to users.locale so the choice survives
    // cookie clears and propagates across devices on next sign-in.
    //
    // LOCKER-04: schema + rateLimit are mandatory; both supplied below.
    app.route({
      method: "POST",
      url: "/api/locale",
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: LocaleSetRequest,
        response: { 200: LocaleSetResponse },
      },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const body = LocaleSetRequest.parse(req.body);

        // Authenticated path: persist to users.locale under the default
        // tenant context. v1 single-tenant — resolveDefaultTenantId()
        // returns the seeded UUID per Phase-1 D-17. withTenant binds
        // app.tenant_id for the duration of the UPDATE so RLS resolves
        // to the user's tenant scope.
        const userId = req.user?.id;
        if (typeof userId === "string" && userId.length > 0) {
          const tenantId = await resolveDefaultTenantId();
          await withTenant(db, tenantId, async (tx) => {
            await tx.execute(sql`UPDATE users SET locale = ${body.locale} WHERE id = ${userId}`);
          });
        }

        // Cookie is set regardless (anonymous users on /sign-in /sign-up
        // get only the cookie path; i18next-http-middleware picks it up
        // on subsequent requests via its default cookie LanguageDetector
        // with cookieName='i18next'). Secure flag follows the request
        // protocol — Fastify honours x-forwarded-proto via trustProxy:true
        // configured in apps/api/src/index.ts:439.
        return reply
          .setCookie("i18next", body.locale, {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            secure: req.protocol === "https",
          })
          .header("cache-control", "no-store")
          .code(200)
          .send({ locale: body.locale });
      },
    });
  };

export default buildLocaleRoutes;
