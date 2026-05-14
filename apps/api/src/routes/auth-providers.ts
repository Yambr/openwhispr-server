// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 2 — Public GET /api/auth/providers.
//
// Returns the runtime list of configured OIDC providers + the email-
// verification posture, used by the wizard (Plan 12-03) and the
// auth screens to render "Continue with <Provider>" buttons WITHOUT
// baking the provider list at build time (closes TD-12.c, RESEARCH §4).
//
// Public — no auth guard. RESEARCH §15(c) info-leak gate enforces
// the response keys are EXACTLY `{providers, emailVerification}` and
// per-provider keys are EXACTLY `{id, name, enabled}` — never a secret,
// never a discoveryUrl, never an issuer URL (T-12.02-01).
//
// Rate-limit: `{max:60, timeWindow:'1 minute'}` — Better-Auth-default
// budget for unauthenticated discovery endpoints (T-12.02-03,
// RESEARCH §4).
//
// Cache-Control: `public, max-age=60` + weak ETag derived from a SHA-256
// hash of the response body. Conditional `If-None-Match` requests get
// a 304 with no body.

import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type ConfiguredProvider, listConfiguredOidcProviders } from "../lib/oidc-providers.js";

export interface AuthProvidersDeps {
  /** Optional env override for tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface EmailVerificationPosture {
  readonly required: boolean;
  readonly configured: boolean;
}

export interface AuthProvidersResponse {
  readonly providers: readonly ConfiguredProvider[];
  readonly emailVerification: EmailVerificationPosture;
}

/**
 * Mirror of apps/api/src/auth.ts:304:
 *   requireEmailVerification: process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION !== "1"
 * The wizard MUST observe the same gate the auth boot used; we re-derive
 * it from the same env here so a flip after deploy (operator unsets the
 * load-test bypass) reflects without a process restart of the wizard's
 * consumers.
 */
function deriveEmailVerification(env: NodeJS.ProcessEnv): EmailVerificationPosture {
  const required = env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION !== "1";
  // `configured` = an SMTP transport is wired. The fallback path in
  // apps/api/src/auth.ts (SMTP_HOST unset) constructs a no-op email
  // service; we treat that as "not configured" so the wizard can warn
  // the operator that verification mail won't actually leave the box.
  const configured = typeof env.SMTP_HOST === "string" && env.SMTP_HOST.length > 0;
  return { required, configured };
}

function buildResponseBody(env: NodeJS.ProcessEnv): AuthProvidersResponse {
  return {
    providers: listConfiguredOidcProviders(env),
    emailVerification: deriveEmailVerification(env),
  };
}

function computeWeakEtag(body: AuthProvidersResponse): string {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}

export const buildAuthProvidersRoutes = (deps: AuthProvidersDeps = {}) =>
  async function authProvidersRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/auth/providers",
      // T-12.02-03 — DoS mitigation. Better Auth default budget for
      // unauthenticated discovery endpoints (RESEARCH §4).
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const env = deps.env ?? process.env;
        const body = buildResponseBody(env);
        const etag = computeWeakEtag(body);

        // 304 short-circuit when the client's cached ETag matches.
        // Compare on `if-none-match` exactly — Fastify normalises
        // header names to lowercase.
        const inm = req.headers["if-none-match"];
        if (typeof inm === "string" && inm === etag) {
          return reply
            .header("etag", etag)
            .header("cache-control", "public, max-age=60")
            .code(304)
            .send();
        }

        return reply
          .header("etag", etag)
          .header("cache-control", "public, max-age=60")
          .code(200)
          .send(body);
      },
    });
  };

export default buildAuthProvidersRoutes;
