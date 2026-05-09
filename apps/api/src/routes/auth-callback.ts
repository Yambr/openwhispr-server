// Phase 2 / Plan 05 / Task 2 — `/api/auth/desktop-callback/:provider`.
//
// Empirical AUTH-A1 finding (2026-05-09):
//   Better Auth 1.6.9's genericOAuth plugin (node_modules/better-auth/
//   dist/plugins/generic-oauth/{index,routes}.mjs) DOES NOT expose a
//   per-request `onSuccess({redirectTo})` hook. The OAuth callback handler
//   redirects to the `callbackURL` that was passed in at sign-in
//   initiation; there is no plugin-level rewrite hook for the post-mint
//   redirect target.
//
//   Implication: we cannot piggy-back Better Auth's
//   `/api/auth/oauth2/callback/:provider` to emit the channel-scheme
//   redirect. We ship a SEPARATE route at
//   `/api/auth/desktop-callback/:provider` (Path B per the plan) that
//   the desktop-signin route directs the IdP to call back. This route:
//
//     1. Reads `state` (= oauth_state.id) and `code` from query.
//     2. Looks up the oauth_state row. If consumed/expired/missing → 400.
//     3. Marks the row consumed_at = now() (single-use).
//     4. Calls the injected `mintBearer({code, codeVerifier, state})`
//        helper — production wires Better Auth's token-exchange + user
//        upsert; tests inject a fake. Returns the bearer token string.
//     5. Builds `<scheme>://?bearer_token=<urlencoded>` via
//        Plan 01's `buildProtocolRedirect` and emits 302.
//
//   The token issuance path is deliberately injected: Plan 06 owns the
//   real-backend conformance run that exercises the full IdP round-trip.
//   For unit-level coverage Plan 05 pins the channel-scheme echo + state
//   lifecycle (consumed/expired/missing) which are the deltas vs Better
//   Auth's stock surface.
//
// Reject envelope shape mirrors the rest of Plan 03 (D-13): single-key
// `{error:"<message>"}`, application/json; charset=utf-8.
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildProtocolRedirect } from "../lib/scheme-allowlist.js";
import {
  withTenant,
  type TransactionalDb,
  type ExecutableTx,
} from "@openwhispr/data";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

/**
 * Token-mint adapter. Production wires Better Auth's genericOAuth
 * token-exchange + account upsert; tests inject a deterministic fake.
 *
 * Implementations MUST:
 *   - Exchange `code` at the IdP token endpoint using `codeVerifier`
 *     (PKCE S256 round-trip).
 *   - Lookup-or-create the user under the resolved tenant (D-08 says
 *     v1 always uses the default tenant).
 *   - Mint an opaque bearer token via Better Auth's session API and
 *     return it as a string. The cookie side-effect (set-auth-token /
 *     Set-Cookie response headers) is Better Auth's concern — this
 *     route only needs the bearer string for the channel-scheme
 *     redirect URL.
 *
 * If an implementation cannot mint a token (network failure / IdP
 * rejected / linking conflict) it should THROW; the centralized
 * setErrorHandler will emit a 500 envelope.
 */
export interface MintBearerArgs {
  /** Authorization code from the IdP callback. */
  code: string;
  /** PKCE verifier persisted at sign-in initiation. */
  codeVerifier: string;
  /** OAuth state row id (echo for logging only). */
  stateId: string;
  /** Provider name (e.g. "oidc"). */
  provider: string;
  /** Resolved tenant — always the default tenant in v1 (D-08). */
  tenantId: string;
  /** Channel scheme (validated, lowercase). */
  scheme: string;
}

export type MintBearer = (args: MintBearerArgs) => Promise<string>;

export interface AuthCallbackDeps {
  db: TransactionalDb<ExecutableTx>;
  /**
   * Optional token-mint adapter. When unset, the route returns 503 +
   * envelope (operator hasn't wired the IdP integration). Plan 06
   * supplies the real Better Auth-backed mintBearer; this plan ships the
   * channel-scheme echo + state lifecycle.
   */
  mintBearer?: MintBearer;
}

interface OauthStateRow {
  id: string;
  scheme: string;
  code_verifier: string;
  consumed_at: string | null;
  expires_at: string;
}

const SUPPORTED_PROVIDERS = new Set<string>(["oidc"]);

export const buildAuthCallbackRoutes = (deps: AuthCallbackDeps) =>
  async function authCallbackRoutes(app: FastifyInstance): Promise<void> {
    const { db, mintBearer } = deps;
    app.get<{
      Params: { provider: string };
      Querystring: { state?: string; code?: string; error?: string };
    }>(
      "/api/auth/desktop-callback/:provider",
      { config: { auth: false } },
      async (req, reply) => {
        const { provider } = req.params;
        if (!SUPPORTED_PROVIDERS.has(provider)) {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "unsupported provider" });
        }

        // IdP-side error (user denied consent etc.). Surface as 400 with
        // the IdP's error code echoed in the envelope message — the
        // single-key shape is preserved.
        if (req.query.error) {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: `idp error: ${req.query.error}` });
        }

        const stateId = req.query.state;
        const code = req.query.code;
        if (!stateId || !code) {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "missing state or code" });
        }

        const tenantId = await resolveDefaultTenantId();
        // Atomic CAS: mark consumed_at, but only if not already
        // consumed AND not expired. RETURNING gives us the row data we
        // need (scheme + code_verifier) iff the CAS succeeded.
        //
        // We also separately fetch any row matching the id (regardless
        // of consumed/expired) so we can emit precise error envelopes
        // that distinguish "missing" / "already consumed" / "expired".
        const result = await withTenant(db, tenantId, async (tx) => {
          const fresh = (await tx.execute(
            sql`UPDATE oauth_state
                SET consumed_at = now()
                WHERE id = ${stateId}::uuid
                  AND consumed_at IS NULL
                  AND expires_at > now()
                RETURNING id, scheme, code_verifier, consumed_at, expires_at`,
          )) as { rows: OauthStateRow[] };
          if (fresh.rows.length > 0) {
            return { kind: "ok" as const, row: fresh.rows[0] };
          }
          // CAS failed — diagnose to emit the right envelope.
          const probe = (await tx.execute(
            sql`SELECT id, scheme, code_verifier, consumed_at, expires_at
                FROM oauth_state
                WHERE id = ${stateId}::uuid`,
          )) as { rows: OauthStateRow[] };
          if (probe.rows.length === 0) {
            return { kind: "missing" as const };
          }
          const row = probe.rows[0];
          if (!row) return { kind: "missing" as const };
          // CR-01 (02-REVIEW.md) / 02-VERIFICATION.md gap 3:
          // Check expires_at FIRST. A row that is both expired AND
          // consumed (legitimate consumption ≥10 min ago) must report
          // "expired" — the more authoritative time-based signal —
          // rather than the misleading "already consumed". This avoids
          // ambiguity for both the desktop client and operator logs.
          const expiresAtMs = new Date(row.expires_at).getTime();
          if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
            return { kind: "expired" as const };
          }
          if (row.consumed_at) {
            return { kind: "consumed" as const };
          }
          return { kind: "expired" as const };
        });

        if (result.kind === "missing") {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "invalid state" });
        }
        if (result.kind === "consumed") {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "state already consumed" });
        }
        if (result.kind === "expired") {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "state expired" });
        }

        const stateRow = result.row;
        if (!stateRow) {
          // Defensive — should be unreachable given the kind check.
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "invalid state" });
        }

        if (!mintBearer) {
          // Operator hasn't supplied the IdP token-exchange adapter.
          // Plan 06 wires the real Better Auth-backed adapter; until
          // then return a clean 503 (matching the unconfigured-OIDC
          // path on /api/desktop-signin).
          return reply
            .code(503)
            .type("application/json; charset=utf-8")
            .send({ error: "oauth callback not configured" });
        }

        const bearer = await mintBearer({
          code,
          codeVerifier: stateRow.code_verifier,
          stateId,
          provider,
          tenantId,
          scheme: stateRow.scheme,
        });

        const target = buildProtocolRedirect(stateRow.scheme, bearer);
        return reply.redirect(target, 302);
      },
    );
  };

export default buildAuthCallbackRoutes;
