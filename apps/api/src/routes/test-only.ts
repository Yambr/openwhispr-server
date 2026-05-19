// SPDX-License-Identifier: FSL-1.1-ALv2
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
import { randomBytes, randomUUID } from "node:crypto";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import { SeedTenantRequest } from "@openwhispr/wire-schemas";
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

/**
 * Phase 56 / Plan 56-01 / R1 — Better Auth signUpEmail shape used by
 * `/api/_test/seed-tenant`. Mirrors the subset of
 * `auth.api.signUpEmail({body})` consumed by the handler (same shape
 * setup-admin uses; declared locally to avoid widening AuthLike, which
 * would ripple through every dual-auth fake in the suite).
 */
export interface TestOnlySignUpResult {
  readonly data: { readonly user: { readonly id: string; readonly email: string } } | null;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

export type TestOnlySignUpEmail = (call: {
  body: { email: string; password: string; name: string };
}) => Promise<TestOnlySignUpResult>;

/**
 * Phase 56 / Plan 56-01 / R1 — minted-bearer sink. The seed-tenant
 * handler generates an opaque bearer + records it here so the
 * downstream dual-auth path (which consults the same map in tests, and
 * the real sessions table in production wiring) can resolve subsequent
 * `Authorization: Bearer <token>` requests to the seeded user.
 *
 * Tests pass a plain Map; production wiring leaves this undefined and
 * the handler instead INSERTs the session row directly into the
 * sessions table (also covered below).
 */
export interface TestOnlySessionSink {
  set(token: string, value: { id: string; email: string; tenantId: string }): void;
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
  /**
   * Phase 56 / Plan 56-01 / R1 — `auth.api.signUpEmail` bound to the
   * production Better Auth instance. When omitted, the seed-tenant
   * route is NOT registered (the rest of the test-only surface still
   * works). Tests inject a fake that emulates the Drizzle-adapter
   * INSERT side-effect against an in-process fake `users` table.
   */
  signUpEmail?: TestOnlySignUpEmail;
  /**
   * Phase 56 / Plan 56-01 / R1 — minted-bearer sink (see
   * `TestOnlySessionSink`). Tests pass a Map; production omits it (the
   * handler writes to the real sessions table via the DB pool).
   */
  sessions?: TestOnlySessionSink;
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

    // Phase 55 / Plan 55-05 — setup-wizard e2e reset seam.
    //
    // Flips the singleton `setup_state` row back to 'pending' so the
    // /setup wizard re-renders. The slim docker instance bootstraps
    // with status='completed' (migration 0017 + first /api/setup/admin
    // POST), so without this seam the wizard 302s to /admin and the
    // long-form acceptance spec at
    // apps/web/tests/e2e/100-acceptance/setup-wizard-happy-path.spec.ts
    // can never exercise the IntersectionObserver-driven 3-section flow.
    //
    // Idempotent — safe to call repeatedly. UPSERT pattern mirrors the
    // helper at apps/api/src/routes/__tests__/setup.ts:213-230 (re-
    // implemented inline because production code cannot import from
    // __tests__/ per LOCKER-04 + the project hard rule).
    //
    // Unauthenticated by design — the wizard runs while signed-out so
    // any bearer gate here would defeat the seam. Safety is provided by
    // the OPENWHISPR_TEST_ROUTES + NODE_ENV gate above (production
    // 404s the path entirely; the env knob is operator-controlled and
    // documented as test-only).
    //
    // Does NOT truncate the users table — concurrent specs share the
    // alice+N fixture pool and a blanket TRUNCATE would orphan their
    // sessions. The /api/setup/admin handler is idempotent over the
    // admin user row (race-loser branch returns 200 + alreadyCompleted).
    app.post("/api/_test/reset-setup", { config: { rateLimit: false } }, async () => {
      // setup_state is a singleton (id=1, no tenant_id column —
      // packages/data/src/schema/setup_state.ts) so we do NOT need
      // withTenant. A plain transaction is enough; Drizzle commits on
      // resolve and rolls back on reject.
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO setup_state (id, status, completed_at)
          VALUES (1, 'pending'::setup_state_status, NULL)
          ON CONFLICT (id) DO UPDATE
            SET status = 'pending',
                completed_at = NULL
        `);
      });
      return { ok: true };
    });

    // Phase 56 / Plan 56-01 / R1 — POST /api/_test/seed-tenant.
    //
    // Spec: /Users/dev/openwhispr/.planning/phases/08-client-server-audit/
    //   SERVER-REQUIREMENTS.md §R1 (lines 21-83). Locked decisions:
    //   .planning/phases/56-client-contract-conformance/CONTEXT.md §D-1.
    //
    // The route bridges Better Auth's signUp flow — which (a) rejects
    // every non-browser fetch() with MISSING_OR_NULL_ORIGIN, and (b)
    // returns `{token: null, user}` until the verification-email round-
    // trip completes — for contract-level e2e callers that need a real
    // session bearer in one round-trip. It unblocks 22 of 28 Phase 9
    // client e2e scenarios.
    //
    // Bypasses:
    //   - No trustedOrigins / MISSING_OR_NULL_ORIGIN check. Fastify
    //     handlers do not enforce the Better-Auth CSRF gate by default;
    //     by NOT routing through `auth.handler(Request)` we sidestep it.
    //   - Email-verification skipped via a direct UPDATE users SET
    //     email_verified=true, email_verified_at=now() after signUpEmail
    //     succeeds.
    //   - Bearer is minted with `crypto.randomBytes(32).toString('base64url')`
    //     (same shape as `/api/_test/force-rotate`); INSERTed into the
    //     `sessions` table so the bearer-plugin lookup admits it on
    //     subsequent requests.
    //
    // Gate defence-in-depth: a fresh NODE_ENV==='production' veto here
    // makes the route 404 even if an operator mis-sets
    // OPENWHISPR_TEST_ROUTES=true in production. The outer `enabled`
    // gate already covers the default-deny posture; this is the second
    // independent layer per the R1 spec.
    // Phase 56 / Plan 56-01 / R1 — D-1 mandates a TIGHTER gate for
    // seed-tenant than the rest of the test-only surface. The outer
    // `enabled` gate (above) admits NODE_ENV='test' alone for legacy
    // reasons (reset-setup / health-authed / force-rotate). Seed-tenant
    // additionally requires the explicit `OPENWHISPR_TEST_ROUTES=true`
    // env opt-in regardless of the runtime mode — see
    // SERVER-REQUIREMENTS.md §R1 gate-2 + CONTEXT.md §D-1.
    if (deps.signUpEmail && process.env.OPENWHISPR_TEST_ROUTES === "true") {
      const signUpEmail = deps.signUpEmail;
      app.post("/api/_test/seed-tenant", { config: { rateLimit: false } }, async (req, reply) => {
        // Defence-in-depth: refuse in production even if the env opt-in
        // was mis-set. The outer gate would already have skipped
        // registration, but a second handler-side check costs nothing
        // and pins the contract under operator mis-configuration.
        if (process.env.NODE_ENV === "production") {
          return reply.code(404).send({ error: "not found" });
        }
        const parsed = SeedTenantRequest.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: "invalid body",
            code: "INVALID_BODY",
            details: parsed.error.flatten(),
          });
        }
        const body = parsed.data;

        // 1. Mint (or look up) the user via Better Auth's signUpEmail.
        //    Idempotency contract (test 6): a second call with the same
        //    email returns the existing user row + a fresh session.
        //    The bound signUpEmail handles dedupe (Better Auth's
        //    USER_ALREADY_EXISTS or our test fake's lower-case lookup);
        //    on error we synthesise an idempotent lookup against the
        //    users table (production path — Better Auth on duplicate
        //    email surfaces a typed error rather than the existing row).
        const signUp = await signUpEmail({
          body: { email: body.email, password: body.password, name: body.name },
        });

        let userId: string;
        let userEmail: string;
        let createdAt: string;
        if (signUp.data) {
          userId = signUp.data.user.id;
          userEmail = signUp.data.user.email;
          createdAt = new Date().toISOString();
        } else {
          // Better Auth refused — try the idempotent lookup branch
          // (e.g. USER_ALREADY_EXISTS). The seed-tenant contract
          // promises 200 + the existing row on repeat invocation.
          const lookup = (await db.transaction(async (tx) => {
            return (await tx.execute(sql`
              SELECT id, email, created_at FROM users
              WHERE lower(email) = lower(${body.email})
              LIMIT 1
            `)) as {
              rows: Array<{ id: string; email: string; created_at: string | Date }>;
            };
          })) as { rows: Array<{ id: string; email: string; created_at: string | Date }> };
          const existing = lookup.rows[0];
          if (!existing) {
            return reply.code(500).send({
              error: signUp.error?.message ?? "signUpEmail failed",
              code: signUp.error?.code ?? "SIGNUP_FAILED",
            });
          }
          userId = existing.id;
          userEmail = existing.email;
          createdAt =
            typeof existing.created_at === "string"
              ? existing.created_at
              : existing.created_at.toISOString();
        }

        // 2. Flip email_verified=true straight on the user row. Skips
        //    the verification-email round-trip per R1. Bound parameter
        //    is the freshly-minted user id; no string interpolation.
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE users
               SET email_verified = true,
                   email_verified_at = now()
             WHERE id = ${userId}::uuid
          `);
        });

        // 3. Mint a fresh opaque bearer and INSERT a sessions row so
        //    Better Auth's bearer plugin admits subsequent requests
        //    carrying it. Same 32-byte base64url shape as the rest of
        //    the test-only surface (force-rotate / health-authed).
        const token = randomBytes(32).toString("base64url");
        const sessionId = randomUUID();
        // 30-day TTL mirrors the production session config (auth.ts
        // sessions.expiresIn = 60*60*24*30).
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            INSERT INTO sessions (id, user_id, tenant_id, token, expires_at, created_at, updated_at)
            VALUES (${sessionId}::uuid,
                    ${userId}::uuid,
                    (SELECT tenant_id FROM users WHERE id = ${userId}::uuid),
                    ${token},
                    ${expiresAt}::timestamptz,
                    now(),
                    now())
          `);
        });

        // 4. Test-only seam — when caller passed a sessions Map (unit
        //    tests), mirror the token there so the in-process dual-auth
        //    fake resolves the bearer to the same user. Production
        //    wiring leaves this undefined; the bearer plugin reads the
        //    real sessions row written above.
        if (deps.sessions) {
          deps.sessions.set(token, {
            id: userId,
            email: userEmail,
            tenantId: req.headers["x-test-tenant-id"]?.toString() ?? "",
          });
        }

        return reply.code(200).send({
          token,
          user: {
            id: userId,
            email: userEmail,
            emailVerified: true,
            createdAt,
          },
        });
      });
    }
  };
}

export default buildTestOnlyRoutes;
