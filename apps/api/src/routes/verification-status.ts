// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 3 — `GET /api/auth/verification-status`.
//
// Cookie-only per BACKEND_SPEC.md (NON-NEGOTIABLE wire contract — see
// `middleware/require-cookie-only.ts` rationale). The desktop polls
// this endpoint after sign-up to detect when the verification email
// has been clicked.
//
// Behavior: return `{verified: users.email_verified_at !== null}` for
// the SESSION-DERIVED caller email under the session's tenant scope.
// The `?email=` query param is OPTIONAL per R5 (Phase 59 / Track D —
// R15 re-opened R5): when present it is validated (strict, RFC-5321
// ≤254 bytes) but its VALUE is intentionally discarded; when ABSENT the
// route still succeeds — identity is always derived from the session.
// R5 mandates the server accept the param "without warning, without
// error", which includes its absence — a required-param 400 was the
// direct inverse of R5. Param-vs-session mismatch is silently tolerated
// (no 400) per R5 disposition: "if not [security-purposed], just ignore
// it silently per current behavior" (R5 lines 243-244). T-02-03-04:
// belt-and-suspenders — tenant from session AND the SELECT runs inside
// `withTenant`.
//
// Rate limit (D-28): 30/min keyed on (ip, email) — the desktop polls
// during onboarding; busy fixtures must not DoS each other.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { VerificationStatusQuery, VerificationStatusResponse } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import { buildRequireCookieOnly } from "../middleware/require-cookie-only.js";

export interface VerificationStatusDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
}

export const buildVerificationStatusRoutes = (deps: VerificationStatusDeps) =>
  async function verificationStatusRoutes(app: FastifyInstance): Promise<void> {
    const { db, auth } = deps;
    const requireCookieOnly = buildRequireCookieOnly({ auth });

    app.route({
      method: "GET",
      url: "/api/auth/verification-status",
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      schema: {
        querystring: VerificationStatusQuery,
        response: { 200: VerificationStatusResponse },
      },
      preHandler: requireCookieOnly,
      handler: async (req) => {
        // R5: validate the param shape (strict, ≤254 bytes) but discard
        // its value — identity is session-derived. Parse-and-drop also
        // guards against a future schema drift where a strict-only
        // tolerance regression could leak in.
        VerificationStatusQuery.parse(req.query);
        if (!req.tenant) {
          // requireCookieOnly should always set this; defense-in-depth.
          throw new AuthError("session expired");
        }
        const sessionEmail = req.user?.email;
        if (!sessionEmail) {
          // Defense-in-depth: requireCookieOnly attaches `req.user`. If
          // it ever resolves a session without an email (e.g., upstream
          // provider quirk), treat as no-such-user → verified=false.
          return { verified: false };
        }
        const verified = await withTenant(db, req.tenant, async (tx) => {
          const res = (await tx.execute(
            sql`SELECT email_verified_at FROM users WHERE email = ${sessionEmail} LIMIT 1`,
          )) as { rows: Array<{ email_verified_at: Date | string | null }> };
          const row = res.rows[0];
          return Boolean(row && row.email_verified_at !== null);
        });
        return { verified };
      },
    });
  };

export default buildVerificationStatusRoutes;
