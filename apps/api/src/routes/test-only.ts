// Phase 2 / Plan 08 / Task 2 — `/api/_test/*` routes (NODE_ENV=test gated).
// Phase 02.12 — migrated to plain-text session.token storage (BA-native).
//
// Closes 02-VERIFICATION.md gap that
// `packages/contract-tests/src/token-rotation.test.ts` (CONTRACT-01)
// requires:
//   * POST /api/_test/force-rotate — forces a session-token rotation,
//     emits the NEW bearer in the `set-auth-token` response header, and
//     records the OLD token (plain text) on the session row so the
//     AUTH-04 5-minute overlap window admits subsequent requests carrying
//     the OLD bearer.
//   * GET  /api/_test/health-authed — minimal authenticated probe
//     returning {status:"ok", userId}. Used by the contract test to
//     fire 100 concurrent OLD-token requests post-rotation.
//
// Gating: registered ONLY when EITHER
//   (a) NODE_ENV === 'test' (in-process unit tests, vitest sets it), OR
//   (b) OPENWHISPR_TEST_ROUTES === 'true' (compose contract-test stack
//       opts in via docker-compose.yml api service environment block).
//
// Phase 02.21 / Residual C — the compose api container runs with
// NODE_ENV=production (per the cluster's deploy posture), so the
// NODE_ENV=test branch alone never registered the routes inside the
// contract-test E2E and `/api/_test/force-rotate` returned 404. The
// explicit env opt-in keeps production builds 404 on these paths
// (operators NEVER set OPENWHISPR_TEST_ROUTES=true in production .env)
// while letting the canonical contract-test invocation mint the rotation.
//
// Token rotation strategy: per 02-08-PLAN Task 2, this test-only path
// generates a fresh 32-byte opaque bearer via crypto.randomBytes and
// directly UPDATEs the sessions row's `token` column. This is the
// documented shortcut — the route MUST emit a NEW bearer in
// `set-auth-token` and the production rotation seam (Better Auth's
// internal scheduling) is not test-controllable. The previous_token
// machinery is wired through `recordPreviousToken` so the contract
// test's overlap assertion holds.
import { randomBytes } from "node:crypto";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";
import { recordPreviousToken } from "../lib/token-rotation.js";
import type { AuthLike } from "../middleware/dual-auth.js";

/**
 * Local AuthLike-with-handler shape: dual-auth's AuthLike only declares
 * `api.getSession`; the test-only force-rotate path additionally tries
 * `auth.handler(Request)` (Better Auth's universal Web Request entry).
 */
export interface TestOnlyAuth extends AuthLike {
  handler?: (req: Request) => Promise<Response>;
}

export interface TestOnlyDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: TestOnlyAuth;
  /**
   * Phase 03 / Plan 10 — PROVIDER-01 introspection seam. When supplied,
   * registers `GET /api/_test/litellm-baseurl` which echoes
   * `client.baseUrl` (the value resolved by `loadLitellmConfigFromEnv()`
   * at boot, including any LITELLM_BASE_URL override). The contract test
   * `packages/contract-tests/src/litellm-base-url-override.test.ts`
   * asserts every LiteLLM-backed route reads from this single source —
   * proving PROVIDER-01's "single endpoint abstraction works under
   * env override" without spinning a second LiteLLM container. Gated by
   * the same OPENWHISPR_TEST_ROUTES env flag as the rest of this file
   * (production /api/_test/* always 404 — the gate is unchanged).
   */
  litellm?: LitellmClient;
}

function extractBearer(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? (match[1]?.trim() ?? null) : null;
}

async function lookupSessionIdByToken(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  bearer: string,
): Promise<string | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const r = (await tx.execute(sql`SELECT id FROM sessions WHERE token = ${bearer} LIMIT 1`)) as {
      rows: Array<{ id: string }>;
    };
    return r.rows[0]?.id ?? null;
  });
}

async function rotateSessionInDb(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  sessionId: string,
  oldBearer: string,
): Promise<string> {
  // Generate a NEW opaque 32-byte bearer (URL-safe base64-ish via base64url).
  const newBearer = randomBytes(32).toString("base64url");
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(
      sql`UPDATE sessions
          SET previous_token = ${oldBearer},
              previous_token_expires_at = now() + interval '5 minutes',
              token = ${newBearer},
              updated_at = now()
          WHERE id = ${sessionId}::uuid`,
    );
  });
  return newBearer;
}

interface AuthedReq extends FastifyRequest {
  user?: { id: string; email: string; tenantId?: string | null };
  tenant?: string;
  sessionId?: string;
}

/**
 * Build the /api/_test/* plugin. When NODE_ENV !== 'test' the plugin is
 * a no-op (no routes registered) so production builds 404 cleanly.
 */
export function buildTestOnlyRoutes(deps: TestOnlyDeps) {
  return async function testOnlyRoutes(app: FastifyInstance): Promise<void> {
    const enabled =
      process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true";
    if (!enabled) {
      // Gate: production / dev / staging — no routes registered.
      return;
    }

    const { db, auth, litellm } = deps;

    // Phase 03 / Plan 10 — PROVIDER-01 introspection. When the LiteLLM
    // client is wired (production / contract-test stack), expose the
    // resolved baseUrl so the contract suite can assert it matches the
    // LITELLM_BASE_URL env (proving the override is honored end-to-end).
    // Unauthenticated and rate-limit-free — same posture as the other
    // test-only diagnostic routes. Gate is OPENWHISPR_TEST_ROUTES (above).
    if (litellm) {
      app.get("/api/_test/litellm-baseurl", { config: { rateLimit: false } }, async () => {
        return { baseUrl: litellm.baseUrl };
      });
    }

    // Phase 02.21 / Residual C — opt out of the global 60/min rate-limit.
    // The token-rotation contract test fires 100 concurrent OLD-bearer
    // requests against /api/_test/health-authed in a single burst to
    // assert the AUTH-04 5-minute overlap window. With the global default
    // applied, all 100 collapse onto one IP bucket and trip 429 long
    // before the overlap-window assertion can fire. These routes are
    // gated behind OPENWHISPR_TEST_ROUTES (production = unregistered),
    // so the rate-limit opt-out has zero production exposure.
    app.post("/api/_test/force-rotate", { config: { rateLimit: false } }, async (req, reply) => {
      const r = req as AuthedReq;
      const oldBearer = extractBearer(req.headers["authorization"]);
      if (!oldBearer || !r.user || !r.tenant) {
        throw new AuthError("unauthorized");
      }
      // Resolve session id: prefer the value the dual-auth hook stashed
      // on the request; fall back to a token (plain) lookup.
      let sessionId = r.sessionId;
      if (!sessionId) {
        sessionId = (await lookupSessionIdByToken(db, r.tenant, oldBearer)) ?? undefined;
      }
      if (!sessionId) {
        // Couldn't bind to a real row — surface as 401 rather than 500.
        throw new AuthError("session not found");
      }

      // First try Better Auth's universal handler — if it ships a
      // rotation seam in the future, prefer that. Today we use the
      // direct DB rotation shortcut documented in 02-08-PLAN Task 2.
      let newBearer: string | undefined;
      if (typeof auth.handler === "function") {
        try {
          const url = new URL(
            "/api/auth/rotate-session",
            process.env.AUTH_URL ?? "http://localhost:3000",
          );
          const resp = await auth.handler(
            new Request(url.toString(), {
              method: "POST",
              headers: { authorization: `Bearer ${oldBearer}` },
            }),
          );
          const headerToken = resp.headers.get("set-auth-token");
          if (resp.status < 400 && headerToken && headerToken !== oldBearer) {
            newBearer = headerToken;
            // Mirror the rotation into our previous_token machinery so the
            // SECURITY DEFINER lookup admits the OLD bearer for 5 minutes.
            await recordPreviousToken(db, r.tenant, sessionId, oldBearer);
          }
        } catch {
          // Better Auth has no rotation route — fall through to DB shortcut.
        }
      }

      if (!newBearer) {
        // Documented test-only DB shortcut: mint a new bearer + update
        // token + record previous_token atomically.
        newBearer = await rotateSessionInDb(db, r.tenant, sessionId, oldBearer);
      }

      reply.header("set-auth-token", newBearer);
      return { rotated: true };
    });

    app.get("/api/_test/health-authed", { config: { rateLimit: false } }, async (req) => {
      const r = req as AuthedReq;
      // dual-auth hook (or its test fake) already enforced auth and
      // populated req.user. If we reach the handler without a user
      // something is structurally wrong — fail closed.
      if (!r.user) {
        throw new AuthError("unauthorized");
      }
      return { status: "ok" as const, userId: r.user.id };
    });

    // Phase 05 / Plan 10 / Task 1 — WIRE-29 negative-matrix enumeration seam.
    //
    // Returns the full Fastify route tree (output of
    // `app.printRoutes({commonPrefix:false})`) as plain text so the
    // CONTRACT-01 enumeration test (Pitfall #6 mitigation) can assert
    // every runtime `/api/*` path is covered by the negative matrix
    // inventory. Gated by the same OPENWHISPR_TEST_ROUTES env flag —
    // production deployments always 404 this path.
    //
    // The handler itself MUST grep `printRoutes` for the plan AC; the
    // /api/_test/* gate above keeps it safe.
    app.get("/api/_test/route-list", { config: { rateLimit: false } }, async () => {
      // app.printRoutes is the canonical Fastify route-tree introspection
      // API (also used by apps/api/src/__tests__/build-app-diarization-wiring.test.ts).
      const tree = app.printRoutes({ commonPrefix: false });
      return { tree };
    });
  };
}

export default buildTestOnlyRoutes;
