// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 3 — `GET /api/auth/verification-status`.
//
// Cookie-only per BACKEND_SPEC.md (NON-NEGOTIABLE wire contract — see
// `middleware/require-cookie-only.ts` rationale). The desktop polls
// this endpoint after sign-up to detect when the verification email
// has been clicked.
//
// Behavior: return `{verified: users.email_verified_at !== null}` for
// the email in the query string under the SESSION'S tenant scope (T-02-
// 03-04: cross-tenant access via this email param is mitigated by the
// preHandler binding `req.tenant` from the session AND the SELECT
// running inside `withTenant`).
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
        const query = VerificationStatusQuery.parse(req.query);
        if (!req.tenant) {
          // requireCookieOnly should always set this; defense-in-depth.
          throw new AuthError("session expired");
        }
        const verified = await withTenant(db, req.tenant, async (tx) => {
          const res = (await tx.execute(
            sql`SELECT email_verified_at FROM users WHERE email = ${query.email} LIMIT 1`,
          )) as { rows: Array<{ email_verified_at: Date | string | null }> };
          const row = res.rows[0];
          return Boolean(row && row.email_verified_at !== null);
        });
        return { verified };
      },
    });
  };

export default buildVerificationStatusRoutes;
