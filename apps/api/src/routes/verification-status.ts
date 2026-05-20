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
// Rate limit (D-28): 30/min keyed on (ip, sha256(lower(email))); absent
// ?email= degrades to an ip-only key — the desktop polls during
// onboarding; busy fixtures behind one corporate NAT must not DoS each
// other. Phase 63 / HR-03 implemented the route-side keyGenerator that
// the D-RL2 matrix (`config/rate-limits.ts`, keying:"composite-ip-email")
// always expected. The email component is trim()+lowerCase()-normalized
// then SHA-256-hashed before entering the key so no plaintext email
// surfaces in Valkey key dumps / traces; the keyGenerator does NO DB
// access, so it cannot become an email-existence enumeration oracle.

import { createHash } from "node:crypto";
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
          // Phase 63 / HR-03 — (ip, email) composite key per D-RL2. The
          // email is normalized (trim + lowercase) then SHA-256-hashed
          // (hex, first 16 chars — ample bucket-separation entropy) so
          // the `owrl:`-namespaced key carries no plaintext PII. Absent
          // ?email= degrades to an ip-only key (`${ip}:_` sentinel) —
          // never throws. No DB access here → not an existence oracle.
          keyGenerator: (req) => {
            const raw = (req.query as { email?: unknown }).email;
            if (typeof raw !== "string" || raw.trim() === "") {
              return `${req.ip}:_`;
            }
            const norm = raw.trim().toLowerCase();
            const emailKey = createHash("sha256").update(norm).digest("hex").slice(0, 16);
            return `${req.ip}:${emailKey}`;
          },
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
