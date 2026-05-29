// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 05 / Task 1 — `GET /api/desktop-signin/:provider`
// (D-05, AUTH-02).
//
// Source of truth: 02-RESEARCH-AUTH.md § OAuth shim route (full flow).
//
// Responsibilities:
//   1. Validate the channel scheme (Plan 01 allow-list — RFC 3986 grammar
//      + dangerous-scheme deny-list); reject with 400 + envelope.
//   2. Generate a fresh PKCE verifier + S256 challenge (Plan 05 lib/pkce).
//   3. Persist the OAuth state row (oauth_state migration 0002) under the
//      seeded default tenant via `withTenant`. Single-use semantics +
//      10-minute TTL.
//   4. Redirect 302 to the IdP authorize URL, carrying the state row id
//      and the PKCE challenge.
//
// AUTH-A1 desktop quirk (per SELF_HOSTING.md § OAuth Flow Walkthrough):
//   the desktop sometimes embeds `protocol=...` inside callbackURL using
//   `?` rather than as a sibling `&` query param. We accept BOTH:
//     * `req.query.protocol` (canonical)
//     * regex extract from raw callbackURL (compat fallback)
//
// Unconfigured-OIDC graceful failure (D-02): if any of OIDC_ISSUER_URL,
// OIDC_CLIENT_ID, OIDC_CLIENT_SECRET is unset → 503 + envelope (operator
// hasn't enabled OIDC; clean failure mode).
//
// We do NOT 302 to a rejected scheme (open-redirect prevention).
//
// Rate limit (Phase 63 / HR-02): 60/min/IP via `config.rateLimit`. This
// route is unauthenticated, so @fastify/rate-limit's default keyGenerator
// degrades to `ip:<req.ip>`. The budget caps the abuse vectors — every
// call INSERTs an `oauth_state` row + 6 encryption sidecars (write
// amplification / table bloat) and emits a 302 to the IdP (redirect-
// launcher) — while a real desktop hits sign-in exactly once per flow.
// The over-budget request is rejected by the limiter BEFORE the handler
// runs, so no INSERT happens for it. The always-on 600/min
// GLOBAL_IP_CEILING still applies on top. Value matches the sibling
// public auth-flow cluster (auth-providers.ts, locale.ts).

import {
  type ExecutableTx,
  encryptCodeVerifier,
  type KeyProvider,
  selectProvider,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";
import { generatePkceVerifier, pkceChallengeS256 } from "../lib/pkce.js";
import { validateScheme } from "../lib/scheme-allowlist.js";

export interface DesktopSigninDeps {
  db: TransactionalDb<ExecutableTx>;
  /** Phase 33 / Plan 33-04 — optional KeyProvider override (tests). */
  keyProvider?: KeyProvider;
}

const SUPPORTED_PROVIDERS = new Set<string>(["oidc"]);

interface OidcEnv {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
}

function readOidcEnv(): OidcEnv | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const authUrl = process.env.AUTH_URL;
  if (!issuerUrl || !clientId || !clientSecret || !authUrl) return null;
  return { issuerUrl, clientId, clientSecret, authUrl };
}

/**
 * Extract the protocol value from a callbackURL when the desktop encodes
 * it as `?protocol=...` inside the URL (rather than as a sibling query
 * parameter). Belt-and-suspenders for the upstream desktop quirk.
 */
function extractEmbeddedProtocol(rawCb: string): string | undefined {
  const m = /[?&]protocol=([^&]+)/.exec(rawCb);
  if (!m || !m[1]) return undefined;
  // Phase 51 / Plan 51-10 (REVIEW api-routes-rest HIGH HR-03) —
  // pre-fix the swallowed decode error returned the RAW encoded
  // value, which then bypassed the scheme allowlist (the allowlist
  // expected decoded `openwhispr-app://` etc., not `openwhispr-app%3A//`).
  // The strict contract is: decode succeeds → return decoded; else
  // return `undefined` so the caller falls back to the documented
  // default protocol.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

export const buildDesktopSigninRoutes = (deps: DesktopSigninDeps) =>
  async function desktopSigninRoutes(app: FastifyInstance): Promise<void> {
    const { db } = deps;
    // Phase 33 / Plan 33-04 — provider resolved once at route registration.
    const keyProvider: KeyProvider = deps.keyProvider ?? selectProvider();
    app.get<{
      Params: { provider: string };
      Querystring: { callbackURL?: string; protocol?: string };
    }>(
      "/api/desktop-signin/:provider",
      { config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const { provider } = req.params;
        if (!SUPPORTED_PROVIDERS.has(provider)) {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "unsupported provider" });
        }

        const oidc = readOidcEnv();
        if (!oidc) {
          return reply
            .code(503)
            .type("application/json; charset=utf-8")
            .send({ error: "oidc not configured" });
        }

        const rawCb = req.query.callbackURL ?? "";
        const proto = req.query.protocol ?? extractEmbeddedProtocol(rawCb) ?? "";

        const validation = validateScheme(proto);
        if (!validation.ok) {
          // PITFALLS #1 / open-redirect prevention: NEVER 302 to a
          // rejected scheme.
          req.log.warn(
            { provider, scheme: proto, reason: validation.reason },
            "rejected callback scheme",
          );
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "invalid callback scheme" });
        }

        // Generate PKCE pair.
        const verifier = generatePkceVerifier();
        const challenge = pkceChallengeS256(verifier);

        // Persist oauth_state under the default tenant (Phase 2 has no
        // multi-tenant signup — D-08).
        const tenantId = await resolveDefaultTenantId();
        // Phase 33 / Plan 33-05 — plaintext `code_verifier` column dropped
        // by migration 0020. Only the 6 bytea sidecars are written; the
        // codec recovers plaintext via `decryptCodeVerifierFromRow` on the
        // auth-callback read path.
        const sidecars = await encryptCodeVerifier(keyProvider, verifier);
        const stateId = await withTenant(db, tenantId, async (tx) => {
          const r = (await tx.execute(
            sql`INSERT INTO oauth_state (tenant_id, provider, callback_url, scheme,
                                       code_verifier_dek_wrapped, code_verifier_dek_iv,
                                       code_verifier_dek_auth_tag, code_verifier_value_iv,
                                       code_verifier_value_auth_tag, code_verifier_value_ciphertext,
                                       expires_at)
                VALUES (${tenantId}, ${provider}, ${rawCb}, ${validation.scheme},
                        ${sidecars.code_verifier_dek_wrapped}, ${sidecars.code_verifier_dek_iv},
                        ${sidecars.code_verifier_dek_auth_tag}, ${sidecars.code_verifier_value_iv},
                        ${sidecars.code_verifier_value_auth_tag}, ${sidecars.code_verifier_value_ciphertext},
                        now() + interval '10 minutes')
                RETURNING id`,
          )) as { rows: Array<{ id: string }> };
          const row = r.rows[0];
          if (!row) {
            throw new Error("oauth_state insert returned no row");
          }
          return row.id;
        });

        // Build the IdP authorize URL. We use the issuer's `/authorize`
        // path directly; full discovery-doc lookup is Better Auth's
        // concern when the genericOAuth plugin runs the callback exchange
        // (Task 2). Self-host operators with a non-standard authorize
        // path can override via OIDC_AUTHORIZE_URL (rare).
        const trimmedIssuer = oidc.issuerUrl.replace(/\/+$/, "");
        const authorizeBase = process.env.OIDC_AUTHORIZE_URL ?? `${trimmedIssuer}/authorize`;
        const idpUrl = new URL(authorizeBase);
        idpUrl.searchParams.set("response_type", "code");
        idpUrl.searchParams.set("client_id", oidc.clientId);
        idpUrl.searchParams.set(
          "redirect_uri",
          `${oidc.authUrl}/api/auth/desktop-callback/${provider}`,
        );
        // Phase 69 / Plan 69-04 (D-69-1 / A1) — request the group scope so
        // Keycloak emits `groups` in the userinfo response the desktop bearer-mint
        // path reads (it bypasses genericOAuth's mapProfileToUser). The configured
        // group claim name defaults to `groups`; operators overriding
        // OIDC_GROUP_CLAIM get that scope requested instead. When JIT is disabled
        // the bare legacy scope is unchanged (backward-compat).
        const groupScope = process.env.OIDC_TENANT_CLAIM
          ? ` ${process.env.OIDC_GROUP_CLAIM && process.env.OIDC_GROUP_CLAIM.length > 0 ? process.env.OIDC_GROUP_CLAIM : "groups"}`
          : "";
        idpUrl.searchParams.set("scope", `openid email profile${groupScope}`);
        idpUrl.searchParams.set("state", stateId);
        idpUrl.searchParams.set("code_challenge", challenge);
        idpUrl.searchParams.set("code_challenge_method", "S256");

        return reply.redirect(idpUrl.toString(), 302);
      },
    );
  };

export default buildDesktopSigninRoutes;
