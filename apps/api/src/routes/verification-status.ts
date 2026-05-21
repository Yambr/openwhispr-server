// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 3 — `GET /api/auth/verification-status`.
// R21 (Phase R21 / 4A additive) — dual-path identity resolution.
//
// The desktop polls this endpoint after sign-up to detect when the
// verification email has been clicked. Under Better Auth 1.6.9
// `requireEmailVerification: true`, `POST /sign-up/email` issues NO
// session, so a cookie-only route 401s every poll in the sign-up→verify
// window. R21 makes the route accept BOTH auth paths — COOKIE WINS:
//
//   * valid session cookie → identity session-derived (unchanged R5/R15
//     behavior); the `?email=` param is IGNORED even on mismatch.
//   * no session + format-valid `?email=` → identity email-derived;
//     `SELECT email_verified_at WHERE email = ?email=` under
//     `withTenant(defaultTenantId)`.
//   * no session + no `?email=` → `{verified:false}`.
//   * unknown email → `{verified:false}`, byte-identical to a known-but-
//     unverified user — no 404, no distinct error shape (anti-enumeration).
//
// The R5/R15 cookie-only contract is preserved as a strict SUPERSET, not
// reversed. The `?email=` param stays OPTIONAL and strict-validated
// (RFC-5321 ≤254 bytes); a malformed value still 400s from the Zod
// schema. Identity resolution lives in `lib/resolve-verification-identity.ts`.
// T-02-03-04 belt-and-suspenders preserved: the SELECT runs inside
// `withTenant` regardless of which path produced the identity.
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
import { buildResolveVerificationIdentity } from "../lib/resolve-verification-identity.js";
import type { AuthLike } from "../middleware/dual-auth.js";

export interface VerificationStatusDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
}

export const buildVerificationStatusRoutes = (deps: VerificationStatusDeps) =>
  async function verificationStatusRoutes(app: FastifyInstance): Promise<void> {
    const { db, auth } = deps;
    const resolveVerificationIdentity = buildResolveVerificationIdentity({ auth });

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
      handler: async (req) => {
        // R5: validate the param shape (strict, ≤254 bytes). Parse-and-
        // keep also guards against a future schema drift where a strict-
        // only tolerance regression could leak in.
        VerificationStatusQuery.parse(req.query);
        // R21: resolve identity via the dual-path helper — cookie session
        // if present (wins), else the validated `?email=` param.
        const identity = await resolveVerificationIdentity(req);
        if (!identity.tenant) {
          // The resolver always returns a tenant from session-or-default;
          // an empty tenant means a session with an empty-string tenantId
          // (`?? fallback` does not catch ""). Defense-in-depth — pin the
          // canonical 401 envelope so the branch doesn't regress silently.
          throw new AuthError("session expired");
        }
        const lookupEmail = identity.email;
        if (!lookupEmail) {
          // No session and no/empty `?email=` (or a non-string param).
          // Treat as no-such-user → verified=false. Byte-identical to a
          // known-but-unverified user — never an enumeration oracle.
          return { verified: false };
        }
        const verified = await withTenant(db, identity.tenant, async (tx) => {
          const res = (await tx.execute(
            sql`SELECT email_verified_at FROM users WHERE email = ${lookupEmail} LIMIT 1`,
          )) as { rows: Array<{ email_verified_at: Date | string | null }> };
          const row = res.rows[0];
          return Boolean(row && row.email_verified_at !== null);
        });
        return { verified };
      },
    });
  };

export default buildVerificationStatusRoutes;
