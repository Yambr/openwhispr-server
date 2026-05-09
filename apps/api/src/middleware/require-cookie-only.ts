// Phase 2 / Plan 03 / Task 2 — `requireCookieOnly` (BACKEND_SPEC.md
// §verification-status, §delete-account).
//
// Per BACKEND_SPEC.md, `/api/auth/verification-status` and
// `/api/auth/delete-account` are cookie-only — the desktop is REQUIRED
// to authenticate via the session cookie on these two endpoints, and a
// bearer token MUST NOT be accepted (this is non-negotiable wire
// contract; it prevents replay-after-rotation for the security-critical
// account-deletion path).
//
// Implementation: build a `Headers` object from the request that
// EXPLICITLY DOES NOT include `Authorization`. Hand that to Better
// Auth's `getSession`. If the cookie path resolves to a session, attach
// `req.user` + `req.tenant` and return. Otherwise throw `AuthError`
// (single 401-emission point — see error-handler.ts).
//
// A stray bearer token in the request is silently ignored — the cookie
// is the ONLY accepted credential. Test asserts: bearer-only request
// (no cookie) => 401.
import type { FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";
import type { AuthLike, SessionResult } from "./dual-auth.js";

export interface RequireCookieOnlyOptions {
  auth: AuthLike;
}

export function buildRequireCookieOnly(opts: RequireCookieOnlyOptions) {
  const { auth } = opts;

  return async function requireCookieOnly(req: FastifyRequest): Promise<void> {
    const headers = cookieOnlyHeaders(req.headers);
    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw new AuthError("unauthorized");
    }
    req.user = session.user;
    req.tenant = session.user.tenantId ?? (await resolveDefaultTenantId());
  };
}

/**
 * Build a Web-Standards Headers object from Fastify request headers
 * with `authorization` stripped. Cookie header(s) are preserved
 * verbatim. Other headers (host, user-agent, etc.) flow through
 * unchanged so Better Auth's cookie validator can see the request
 * context.
 */
export function cookieOnlyHeaders(
  src: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(src)) {
    // Cookie-only contract: drop authorization entirely.
    if (k.toLowerCase() === "authorization") continue;
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return headers;
}

export type { SessionResult };
