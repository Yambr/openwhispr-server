// SPDX-License-Identifier: FSL-1.1-ALv2
// R21 — verification-status identity resolver (4A additive dual-path).
//
// `GET /api/auth/verification-status` was cookie-only (R5/R15). Under
// Better Auth 1.6.9 `requireEmailVerification: true`, `POST /sign-up/email`
// issues NO session (vendored proof: `sign-up.mjs` L160-161 / L249 returns
// `{token:null}` before `createSession`). The desktop polls this route in
// the sign-up→verify window with no session ⇒ every poll 401 ⇒ the window
// is structurally unsatisfiable. The client is immutable; the fix is
// server-side: accept BOTH auth paths, cookie wins.
//
// Resolution priority (deterministic):
//   1. valid session cookie present → identity session-derived; the
//      `?email=` param is IGNORED even on mismatch — no silent mixing,
//      the route returns verified-state for the COOKIE owner.
//   2. no session + `req.query.email` (already Zod-validated by the
//      route schema) → identity email-derived; tenant = default tenant.
//   3. no session + no `?email=` → `{ email: undefined }`; the route
//      collapses an absent/unknown email to `{verified:false}`.
//
// The cookie path strips `Authorization` (reuses `cookieOnlyHeaders`) so a
// stray bearer can never satisfy this route — the R5/R15 cookie-only
// contract is preserved as a strict superset, not reversed.

import type { FastifyRequest } from "fastify";
import type { AuthLike } from "../middleware/dual-auth.js";
import { cookieOnlyHeaders } from "../middleware/require-cookie-only.js";
import { resolveDefaultTenantId } from "./default-tenant.js";

export interface ResolveVerificationIdentityOptions {
  auth: AuthLike;
}

/** The (email, tenant) pair the verification-status SELECT is bound to. */
export interface VerificationIdentity {
  /** Lookup email — `undefined` when neither a session nor a param yields one. */
  email: string | undefined;
  /** Tenant scope for the `withTenant` SELECT — never undefined. */
  tenant: string;
}

/**
 * Build the verification-status identity resolver bound to a Better Auth
 * instance. Returning a closure keeps the api buildable + unit-testable
 * with a hand-rolled `AuthLike` fake (no full `betterAuth()` construction).
 */
export function buildResolveVerificationIdentity(opts: ResolveVerificationIdentityOptions) {
  const { auth } = opts;

  return async function resolveVerificationIdentity(
    req: FastifyRequest,
  ): Promise<VerificationIdentity> {
    // Cookie path — drop Authorization so a stray bearer cannot satisfy
    // this route (cookie-only contract, preserved per R5/R15).
    const headers = cookieOnlyHeaders(req.headers);
    const session = await auth.api.getSession({ headers });
    if (session) {
      // Cookie wins: identity is session-derived. `?email=` is ignored
      // even on mismatch — never blend a client-supplied address into
      // the authoritative lookup.
      return {
        email: session.user.email,
        tenant: session.user.tenantId ?? (await resolveDefaultTenantId()),
      };
    }

    // Email path — no session. `req.query.email` was already validated by
    // the route's Zod `querystring` schema (strict, RFC-5321 ≤254 bytes);
    // a malformed value 400s before reaching here. Guard the type anyway:
    // the helper is route-agnostic and must not assume the schema ran.
    const raw = (req.query as { email?: unknown }).email;
    const email = typeof raw === "string" ? raw : undefined;
    return { email, tenant: await resolveDefaultTenantId() };
  };
}

export default buildResolveVerificationIdentity;
