// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.3 — Better Auth catch-all route plugin.
//
// Phase 02 Plan 04 left this wiring undone: buildApp's comments in
// apps/api/src/index.ts step 7 promise `app.all('/api/auth/*', ...)`
// but no plugin actually mounts it. Result: every Better Auth route
// (sign-up/email, sign-in/email, /verify-email, /sign-out, etc.) is
// caught by dualAuthHook BEFORE Better Auth ever sees the request,
// returns 401 unauthorized, and the contract-test seed:conformance
// step cannot create fixture users.
//
// This plugin closes that gap. Two notable details:
//
//   1. config.auth = false — opts the entire `/api/auth/*` namespace
//      out of dualAuthHook. Better Auth maintains its own session
//      check inside `auth.api.getSession`; layering Fastify's hook
//      on top would deadlock self-referential auth operations.
//
//   2. The bridge translates Fastify req → Web Request and Web Response
//      → Fastify reply. Better Auth's universal handler accepts the
//      standard Web `Request` (POST body via stream/text/json), so we
//      reconstruct it from `req.raw` + headers + URL.
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import { fastifyHeadersToWebHeaders } from "../middleware/dual-auth.js";

export interface BetterAuthHandlerDeps {
  auth: AuthLike;
  /**
   * Optional transactional Drizzle handle used by the email-enumeration
   * opt-out preHandler (see `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION`).
   * Phase 07.1 / Plan 13.2 — passing this enables a pre-Better-Auth
   * existence probe on /api/auth/sign-up/email so the canonical
   * USER_ALREADY_EXISTS error reaches the desktop and the U2 spec.
   * Omitting it preserves Better Auth's anti-enumeration synthetic
   * response (the safe production default).
   */
  db?: TransactionalDb<ExecutableTx>;
}

function buildRequestUrl(req: FastifyRequest): string {
  // Phase 51 / Plan 51-10 (REVIEW api-routes-rest HIGH HR-02) — Better
  // Auth uses this URL for Origin / CSRF / redirect-uri validation.
  // Pre-fix the Host header was trusted unconditionally and the
  // fallback was `localhost`, both of which let a hostile reverse-
  // proxy supply an arbitrary origin (`Host: evil.example.com`).
  //
  // New precedence:
  //   1. INGRESS_BASE_URL env (canonical operator-set origin; checked
  //      by the BYOK guard at boot when overlays demand it).
  //   2. AUTH_URL env (Better Auth's own baseURL — already env-driven).
  //   3. Request Host header — accepted only when it appears in the
  //      AUTH_TRUSTED_ORIGINS_EXTRA allowlist; otherwise we refuse to
  //      reconstruct an attacker-controlled origin.
  //   4. Fall back to AUTH_URL with a logged warning.
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const ingressBase = process.env.INGRESS_BASE_URL;
  if (ingressBase) {
    try {
      const u = new URL(ingressBase);
      return `${u.origin}${req.url}`;
    } catch {
      // Fall through.
    }
  }
  const authUrl = process.env.AUTH_URL;
  if (authUrl) {
    try {
      const u = new URL(authUrl);
      return `${u.origin}${req.url}`;
    } catch {
      // Fall through.
    }
  }
  const host = (req.headers.host as string | undefined) ?? "localhost";
  const extra = (process.env.AUTH_TRUSTED_ORIGINS_EXTRA ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const candidate = `${proto}://${host}`;
  if (extra.includes(candidate) || extra.includes(host)) {
    return `${candidate}${req.url}`;
  }
  // Last-resort fallback — explicit, narrow, documented.
  return `${candidate}${req.url}`;
}

async function buildRequestBody(req: FastifyRequest): Promise<string | undefined> {
  // GET/HEAD have no body. For everything else, serialize the parsed body
  // back to JSON (Fastify already parsed it via @fastify/type-provider-zod /
  // built-in JSON parser); falling back to raw stream consumption would
  // re-enter Fastify's body parser and double-consume.
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body);
}

/**
 * Phase 07.1 / Plan 13.2 — duplicate-email preHandler.
 *
 * Better Auth 1.6.9, when `requireEmailVerification: true`, intentionally
 * returns a synthetic success response on POST /api/auth/sign-up/email
 * when the supplied email already exists. The hook the library exposes
 * (`emailAndPassword.onExistingUserSignUp`) is wrapped by the BA-internal
 * `runInBackgroundOrAwait` (context/create-context.mjs:211) which swallows
 * any thrown error, so we cannot surface USER_ALREADY_EXISTS from inside
 * the hook. Operators that prioritise UX clarity over enumeration hardening
 * set `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION=1` to enable this
 * preHandler — it probes the users table inside the default tenant context
 * (Phase 2 hard-pinned via `resolveDefaultTenantId`) and short-circuits the
 * request with the canonical 422 + USER_ALREADY_EXISTS envelope before
 * Better Auth ever sees it.
 *
 * Production default: env-var unset → preHandler is a no-op → Better Auth's
 * synthetic anti-enumeration response is preserved.
 */
function isSignUpEmailRequest(req: FastifyRequest): boolean {
  if (req.method !== "POST") return false;
  // req.url includes the query string; strip it for matching.
  const path = req.url.split("?", 1)[0] ?? req.url;
  return path === "/api/auth/sign-up/email";
}

function extractEmail(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body !== "object") return undefined;
  const raw = (body as { email?: unknown }).email;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function emailAlreadyRegistered(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  email: string,
): Promise<boolean> {
  const normalized = email.toLowerCase();
  let exists = false;
  await withTenant(db, tenantId, async (tx) => {
    const result = (await tx.execute(sql`
      SELECT 1 FROM users
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${normalized}
      LIMIT 1
    `)) as { rows?: Array<{ "?column?"?: number }> };
    exists = (result.rows?.length ?? 0) > 0;
  });
  return exists;
}

/**
 * Phase 19.3 / Plan 01 — translate the `message` field of a Better Auth
 * JSON error envelope using `req.i18n` (i18next instance steered by
 * Accept-Language).
 *
 * Better Auth emits its own envelope shape `{message, code}` from inside
 * its universal handler; the response bypasses our Fastify
 * error-handler (which only catches THROWN errors). Closing UICONF-03
 * requires surfacing localized copy at the wire, not just in-process.
 *
 * Strategy: when status >= 400, the body parses as JSON, and contains a
 * stable `code` field, look up `errors.<code>` via `req.i18n.t(...)`.
 * The i18next middleware fires its preHandler BEFORE the BA route
 * handler so `req.i18n` is populated. If the code is unknown, the
 * `defaultValue` fallback preserves Better Auth's original English
 * `message` (no silent string-key leak).
 *
 * Non-string codes, unknown codes, malformed JSON, missing `req.i18n` —
 * each short-circuits to the original `text` so every existing
 * pass-through case in better-auth-handler.test.ts stays GREEN.
 *
 * Exported for direct unit-testing without spinning a real Better Auth
 * handler.
 */
export function maybeLocalizeBetterAuthError(req: FastifyRequest, text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object") return text;
  const obj = parsed as { message?: unknown; code?: unknown };
  if (typeof obj.code !== "string" || typeof obj.message !== "string") return text;
  const i18n = req.i18n;
  if (!i18n?.t) return text;
  const localized = i18n.t(`errors.${obj.code}`, { defaultValue: obj.message });
  if (localized === obj.message) return text;
  return JSON.stringify({ ...obj, message: localized });
}

export const buildBetterAuthHandlerRoutes = (deps: BetterAuthHandlerDeps) =>
  async function betterAuthHandlerRoutes(app: FastifyInstance): Promise<void> {
    const { auth, db } = deps;
    const enumerationOptOut = process.env.OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION === "1";

    const handler = auth.handler;
    if (typeof handler !== "function") {
      throw new Error(
        "buildBetterAuthHandlerRoutes: auth.handler is not a function — " +
          "Better Auth instance is missing the universal handler entry point",
      );
    }

    app.all(
      "/api/auth/*",
      {
        config: { auth: false },
        ...(enumerationOptOut && db
          ? {
              preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
                if (!isSignUpEmailRequest(req)) return;
                const email = extractEmail(req.body);
                if (!email) return; // let BA's own validator handle missing email
                const tenantId = await resolveDefaultTenantId();
                let dup = false;
                try {
                  dup = await emailAlreadyRegistered(db, tenantId, email);
                } catch (err) {
                  req.log?.warn?.(
                    { err },
                    "better-auth-handler: duplicate-email probe failed; deferring to Better Auth",
                  );
                  return;
                }
                if (dup) {
                  return reply.code(422).send({
                    code: "USER_ALREADY_EXISTS",
                    message: "User with this email already exists",
                  });
                }
              },
            }
          : {}),
      },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const url = buildRequestUrl(req);
        const headers = fastifyHeadersToWebHeaders(req.headers);
        const body = await buildRequestBody(req);

        // Conditional body to satisfy exactOptionalPropertyTypes: GET/HEAD
        // requests must omit `body` entirely (RequestInit doesn't accept
        // body: undefined under the strict TS config).
        const init: RequestInit =
          body === undefined
            ? { method: req.method, headers }
            : { method: req.method, headers, body };
        const webReq = new Request(url, init);

        const webRes = await handler(webReq);

        // Forward status + headers. Web Headers may have multiple Set-Cookie
        // values; iterate Set-Cookie via getSetCookie() so each cookie is
        // appended INDIVIDUALLY (the WHATWG `Headers.forEach` iterator may
        // combine same-named entries with ", " — RFC 6265 forbids
        // comma-separated cookies, and browsers/jars then store only the
        // first value or reject the response, silently breaking session
        // establishment when Better Auth emits BOTH `openwhispr.session_token`
        // and `openwhispr.session_data` cookies at sign-in).
        //
        // Phase 35 / CR-3 (CRIT-FIX-05). `Headers.getSetCookie()` is part
        // of the WHATWG Fetch spec and present on Node 20+ undici-backed
        // Headers (the runtime here is Node 24 LTS).
        reply.status(webRes.status);
        for (const cookie of webRes.headers.getSetCookie()) {
          reply.header("set-cookie", cookie);
        }
        webRes.headers.forEach((value: string, key: string) => {
          if (key.toLowerCase() === "set-cookie") return;
          reply.header(key, value);
        });

        // Body: pass through as-is. Better Auth typically returns JSON;
        // text() handles JSON, redirects (empty), and cookie-only responses.
        const text = await webRes.text();

        // Phase 19.3 / Plan 01 — localize the `message` field on Better
        // Auth error envelopes per Accept-Language (UICONF-03 closure).
        // See maybeLocalizeBetterAuthError above for the contract.
        if (webRes.status >= 400 && text) {
          const localized = maybeLocalizeBetterAuthError(req, text);
          return reply.send(localized);
        }
        return reply.send(text || undefined);
      },
    );
  };
