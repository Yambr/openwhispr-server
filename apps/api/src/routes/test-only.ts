// Phase 2 / Plan 08 / Task 2 — `/api/_test/*` routes (NODE_ENV=test gated).
//
// Closes 02-VERIFICATION.md gap that
// `packages/contract-tests/src/token-rotation.test.ts` (CONTRACT-01)
// requires:
//   * POST /api/_test/force-rotate — forces a session-token rotation,
//     emits the NEW bearer in the `set-auth-token` response header, and
//     records the OLD token's hash on the session row so the AUTH-04
//     5-minute overlap window admits subsequent requests carrying the
//     OLD bearer.
//   * GET  /api/_test/health-authed — minimal authenticated probe
//     returning {status:"ok", userId}. Used by the contract test to
//     fire 100 concurrent OLD-token requests post-rotation.
//
// Gating: when NODE_ENV !== 'test' the plugin registers NO routes —
// production / dev / staging builds therefore 404 on these paths.
//
// Token rotation strategy: per 02-08-PLAN Task 2, this test-only path
// generates a fresh 32-byte opaque bearer via crypto.randomBytes and
// directly UPDATEs the sessions row's token_hash. This is the documented
// shortcut — the route MUST emit a NEW bearer in `set-auth-token` and
// the production rotation seam (Better Auth's internal scheduling) is
// not test-controllable. The previous_token machinery is wired through
// `recordPreviousToken` so the contract test's overlap assertion holds.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTenant, type ExecutableTx, type TransactionalDb } from "@openwhispr/data";
import type { AuthLike } from "../middleware/dual-auth.js";
import { AuthError } from "../errors.js";
import { hashToken, recordPreviousToken } from "../lib/token-rotation.js";

export interface TestOnlyDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
}

function extractBearer(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? (match[1]?.trim() ?? null) : null;
}

async function lookupSessionIdByTokenHash(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  hash: Buffer,
): Promise<string | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const r = (await tx.execute(
      sql`SELECT id FROM sessions WHERE token_hash = ${hash} LIMIT 1`,
    )) as { rows: Array<{ id: string }> };
    return r.rows[0]?.id ?? null;
  });
}

async function rotateSessionInDb(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  sessionId: string,
  oldHash: Buffer,
): Promise<string> {
  // Generate a NEW opaque 32-byte bearer (URL-safe base64-ish via base64url).
  const newBearer = randomBytes(32).toString("base64url");
  const newHash = hashToken(newBearer);
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(
      sql`UPDATE sessions
          SET previous_token_hash = ${oldHash},
              previous_token_expires_at = now() + interval '5 minutes',
              token_hash = ${newHash},
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
    if (process.env.NODE_ENV !== "test") {
      // Gate: production / dev / staging — no routes registered.
      return;
    }

    const { db, auth } = deps;

    app.post("/api/_test/force-rotate", async (req, reply) => {
      const r = req as AuthedReq;
      const oldBearer = extractBearer(req.headers["authorization"]);
      if (!oldBearer || !r.user || !r.tenant) {
        throw new AuthError("unauthorized");
      }
      // Resolve session id: prefer the value the dual-auth hook stashed
      // on the request; fall back to a token_hash lookup.
      let sessionId = r.sessionId;
      if (!sessionId) {
        sessionId = (await lookupSessionIdByTokenHash(
          db,
          r.tenant,
          hashToken(oldBearer),
        )) ?? undefined;
      }
      if (!sessionId) {
        // Couldn't bind to a real row — surface as 401 rather than 500.
        throw new AuthError("session not found");
      }

      // First try Better Auth's universal handler — if it ships a
      // rotation seam in the future, prefer that. Today we use the
      // direct DB rotation shortcut documented in 02-08-PLAN Task 2.
      let newBearer: string | undefined;
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
          await recordPreviousToken(db, r.tenant, sessionId, hashToken(oldBearer));
        }
      } catch {
        // Better Auth has no rotation route — fall through to DB shortcut.
      }

      if (!newBearer) {
        // Documented test-only DB shortcut: mint a new bearer + update
        // token_hash + record previous_token_hash atomically.
        newBearer = await rotateSessionInDb(
          db,
          r.tenant,
          sessionId,
          hashToken(oldBearer),
        );
      }

      reply.header("set-auth-token", newBearer);
      return { rotated: true };
    });

    app.get("/api/_test/health-authed", async (req) => {
      const r = req as AuthedReq;
      // dual-auth hook (or its test fake) already enforced auth and
      // populated req.user. If we reach the handler without a user
      // something is structurally wrong — fail closed.
      if (!r.user) {
        throw new AuthError("unauthorized");
      }
      return { status: "ok" as const, userId: r.user.id };
    });
  };
}

export default buildTestOnlyRoutes;
