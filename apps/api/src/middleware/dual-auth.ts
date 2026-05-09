// Phase 2 / Plan 03 / Task 2 — `dualAuthHook` (D-04, AUTH-03).
//
// Source of truth: 02-RESEARCH-AUTH.md § Dual-Auth Hook.
//
// Behavior:
//   1. If the route opts out via `routeOptions.config.auth === false`,
//      the hook returns immediately (no auth check).
//   2. Otherwise we hand the request headers to Better Auth's
//      `auth.api.getSession({headers})`. Better Auth internally tries
//      bearer THEN cookie (bearer plugin participates in the chain).
//   3. If a session is found, we attach `req.user` + `req.tenant` and
//      return.
//   4. If NO session AND a bearer token is present, we attempt the
//      AUTH-04 5-minute overlap window via `tryPreviousToken`.
//   5. If both fail we `throw new AuthError("unauthorized")`. The
//      centralized `setErrorHandler` (Plan 03 Task 1) is the single
//      emission point for the 401 envelope (D-13, PITFALLS #1).
//      Throwing rather than calling `reply.code(401).send(...)` inline
//      keeps the envelope shape uniform across every route.
//
// Tenant binding:
//   `req.tenant` is set from the session's user.tenantId when present;
//   falls back to the seeded default tenant otherwise (v1 single-tenant
//   model — Phase 5/6 introduces real tenant resolution).
//
// What we do NOT do here:
//   * `withTenant(...)` wrapping. Per the WIRE-Q1 resolution (in the
//     plan), individual route handlers call `withTenant(db, req.tenant,
//     ...)` themselves. That keeps the GUC binding next to the actual
//     query and avoids any preHandler-vs-handler transaction-scope
//     ambiguity under Fastify's hook lifecycle.
import type { FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

/**
 * Minimal shape of Better Auth's getSession response that we consume.
 * Better Auth's full type leaks zod-internals across package boundaries
 * (see `auth.ts` AuthInstance comment); we couple to the structural
 * surface only.
 */
export interface SessionResult {
  user: { id: string; email: string; tenantId?: string | null };
}

/**
 * Minimal shape of the Better Auth instance the hook needs. Lets us
 * unit-test the hook with a hand-rolled fake without dragging in the
 * full betterAuth() construction.
 */
export interface AuthLike {
  api: {
    getSession(opts: { headers: Headers }): Promise<SessionResult | null>;
  };
}

/**
 * Optional fallback for the AUTH-04 5-minute token-rotation overlap
 * window. The DB-touching helper (`tryPreviousToken`) lives in a Wave
 * 2/3 plan; this hook accepts it as an injected dependency so today's
 * code path stays testable and tomorrow's wiring is a one-line plug-in.
 *
 * Returns null if the bearer doesn't match a recently-rotated session,
 * or `{user, tenantId}` if it does (handler attaches them to req).
 */
export type TryPreviousToken = (
  bearerToken: string,
) => Promise<{ user: SessionResult["user"]; tenantId: string } | null>;

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionResult["user"];
    tenant?: string;
  }
  interface FastifyContextConfig {
    /**
     * Set to `false` to opt this route out of the dual-auth hook.
     * Used by `/api/check-user` (pre-auth flow) and `/api/health`.
     */
    auth?: boolean;
    // Note: `rateLimit` is declared by `@fastify/rate-limit` itself
    // once Plan 04 registers the plugin (its module augmentation
    // adds `rateLimit?: false | RateLimitOptions` to FastifyContextConfig).
    // We do NOT redeclare it here to avoid duplicate-property errors.
  }
}

export interface DualAuthOptions {
  auth: AuthLike;
  /** Optional overlap-window fallback (Wave 2/3). */
  tryPreviousToken?: TryPreviousToken;
}

/**
 * Build the Fastify preHandler hook bound to a specific Better Auth
 * instance. Returning a closure (rather than a free function reading
 * a module-scoped `auth`) keeps the api buildable + testable without
 * env-time side effects.
 */
export function buildDualAuthHook(opts: DualAuthOptions) {
  const { auth, tryPreviousToken } = opts;

  return async function dualAuthHook(req: FastifyRequest): Promise<void> {
    // Per-route opt-out (e.g. /api/check-user pre-auth flow).
    if (req.routeOptions?.config?.auth === false) return;

    const headers = fastifyHeadersToWebHeaders(req.headers);
    const session = await auth.api.getSession({ headers });

    if (session) {
      req.user = session.user;
      req.tenant = session.user.tenantId ?? (await resolveDefaultTenantId());
      return;
    }

    // Session lookup miss. If a bearer token is present, try the AUTH-04
    // overlap window (rotated within last 5 minutes).
    const bearer = extractBearer(req.headers["authorization"]);
    if (bearer && tryPreviousToken) {
      const overlap = await tryPreviousToken(bearer);
      if (overlap) {
        req.user = overlap.user;
        req.tenant = overlap.tenantId;
        return;
      }
    }

    // PITFALLS #1: 401, NEVER 200-with-error. Throw so the centralized
    // setErrorHandler emits the envelope (single emission point).
    throw new AuthError("unauthorized");
  };
}

/**
 * Fastify's `req.headers` is `IncomingHttpHeaders` — a plain record with
 * string | string[] | undefined values. Better Auth's `getSession`
 * expects a Web-Standards `Headers` instance. Convert preserving array
 * headers via comma-join (the Web platform's documented multi-value
 * behavior).
 */
function fastifyHeadersToWebHeaders(
  src: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return headers;
}

/**
 * Pull the opaque bearer token out of an `Authorization` header value.
 * Returns null if the header is absent or not a `Bearer ...` value.
 */
function extractBearer(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? (match[1]?.trim() ?? null) : null;
}

// Exported for direct unit-testing.
export const __test = { fastifyHeadersToWebHeaders, extractBearer };
