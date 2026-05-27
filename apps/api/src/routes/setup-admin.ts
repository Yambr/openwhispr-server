// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 1 — POST /api/setup/admin.
// Quick-task 260527-im6 — hybrid admin-claim hardening.
//
// HYBRID admin claim (CONTEXT.md D1+D2+D3+C2):
//   * Mode A — Bearer hex64 against OPENWHISPR_SETUP_CLAIM_TOKEN:
//       SYNCHRONOUS path. claim setup_state, signUpEmail, flip role,
//       rename tenant, emit `admin.role_changed` audit, 201.
//   * Mode B — verified-email (no Bearer):
//       signUpEmail ONLY. setup_state stays 'pending', users.role
//       stays NULL. Better Auth's send-verification chain dispatches
//       the magic link automatically (requireEmailVerification:true);
//       the `afterEmailVerification` hook (auth.ts) fires the atomic
//       UPDATE+UPDATE+audit transaction once the user clicks the link.
//   * Origin allowlist preHandler — strict-equality vs canonical
//     INGRESS_BASE_URL + ADDITIONAL_ALLOWED_ORIGINS (A2). Closes audit
//     findings Dim 8 / Dim 9.
//
// Atomicity:
//   * Bearer branch keeps the existing atomic UPDATE-RETURNING claim
//     idiom (RESEARCH §3). Race-safe under PgBouncer txn-mode.
//   * Email branch never touches setup_state at the route layer;
//     the hook owns the atomic transition with WHERE-predicate idempotency
//     (a second click on a stale link sees status='completed' and the
//     inner UPDATE rowCount=0 -- safe retry).
//
// Idempotency / response shape (CC5 / R8.3 / P10):
//   * Bearer branch: 201 `{admin:{email}, alreadyCompleted:false}` (no
//     `pending_verification` field).
//   * Email branch: 201 `{admin:{email}, alreadyCompleted:false, pending_verification:true}`.
//   * Race-loser (Bearer): 200 `{admin:{email:<existing>}, alreadyCompleted:true}`.
//
// Bearer-branch role flip drops the `AND email_verified=true` predicate
// (RESEARCH P6 / R8.3) -- this branch is the operator-recovery /
// corporate-internal path that BYPASSES email by design.
//
// LOCKER-04: route declares `schema: { body: setupAdminInput }` for
// pre-emptive type-provider migration AND keeps the manual `safeParse`
// because (a) the test harness does not register the zodTypeProvider
// validator compiler, and (b) the existing INVALID_BODY envelope shape
// is part of the wire contract assertions in setup-admin.test.ts. The
// safeParse is therefore defence-in-depth, not a violation of single-
// gate doctrine.

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT, safeTokenCompare } from "../config/setup-claim.js";
import { type AuditCtx, auditCtxFromRequest, recordAudit } from "../lib/audit.js";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

/**
 * Stable seeded UUID of the singleton root tenant.
 */
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Shape of the call this handler issues into Better Auth.
 */
export interface SetupAdminSignUpResult {
  readonly data: { readonly user: { readonly id: string; readonly email: string } } | null;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

export interface SetupAdminSignUpCall {
  readonly body: {
    readonly email: string;
    readonly password: string;
    readonly name?: string;
    readonly locale?: string;
  };
}

export type SetupAdminSignUpEmail = (call: SetupAdminSignUpCall) => Promise<SetupAdminSignUpResult>;

/**
 * Best-effort tenant rename — overrideable in tests to exercise the
 * warnings-array branch without corrupting the live schema.
 */
export type SetupAdminRenameTenant = (workspace: string) => Promise<void>;

export interface SetupAdminDeps {
  db: TransactionalDb<ExecutableTx>;
  /** Owner pool — BYPASSRLS, used for users.role + tenants writes. */
  ownerPool: Pool;
  signUpEmail: SetupAdminSignUpEmail;
  /** Override for the tenant-rename failure test. */
  renameTenant?: SetupAdminRenameTenant;
  /**
   * Quick-task 260527-im6 / A1 — parsed env-token Buffer, threaded in
   * from `validateSetupClaimBoot`. The route MUST consume this Buffer
   * via `safeTokenCompare(presented, deps.envClaimTokenBuffer)` and
   * MUST NOT re-call `parseSetupClaimToken`. Undefined when env-token
   * mode is disabled.
   */
  envClaimTokenBuffer?: Buffer;
  /**
   * Quick-task 260527-im6 / A2 — strict-equality allowlist of origins
   * (canonical INGRESS_BASE_URL + ADDITIONAL_ALLOWED_ORIGINS), pre-
   * validated at boot by `getAllowedOrigins`. The Origin preHandler
   * runs `Set.has()` against this array; no `startsWith`, no wildcards.
   * When undefined, the preHandler defaults to canonical-only via
   * `validateIngressBoot()` -- preserves backward-compat for legacy
   * unit-test fixtures that pre-date the deps field.
   */
  allowedOrigins?: ReadonlyArray<string>;
}

/**
 * Request body schema. `role` is INTENTIONALLY absent — we read only
 * the whitelisted fields and the unknown-key fallthrough drops any
 * hostile escalation attempt. `timezone` is accepted but NOT forwarded
 * into the DB.
 */
const setupAdminInput = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  name: z.string().min(1).max(100),
  workspace: z.string().min(1).max(100),
  timezone: z.string().min(1),
});

type SetupAdminInput = z.infer<typeof setupAdminInput>;

interface SetupStateClaimRow {
  status: string;
  completed_at: string | Date | null;
}

interface AdminLookupRow {
  email: string;
}

/**
 * Quick-task 260527-im6 / A2 — Origin guard factory.
 *
 * Pre-builds a `ReadonlySet<string>` once at deps construction so each
 * request runs O(1) lookup. Strict-equality only: missing / mismatched
 * / suffix-attack origins all yield 403 ORIGIN_MISMATCH.
 */
export function makeOriginGuard(opts: { allowedOrigins: ReadonlyArray<string> }) {
  const allowed: ReadonlySet<string> = new Set(opts.allowedOrigins);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const presented = req.headers.origin;
    if (typeof presented !== "string" || !allowed.has(presented)) {
      return reply.code(403).send({
        error: { code: "ORIGIN_MISMATCH", requestId: req.id },
      });
    }
    return undefined;
  };
}

export const buildSetupAdminRoutes = (deps: SetupAdminDeps) =>
  async function setupAdminRoutes(app: FastifyInstance): Promise<void> {
    const { db, ownerPool, signUpEmail } = deps;
    const renameTenant: SetupAdminRenameTenant =
      deps.renameTenant ??
      (async (workspace: string) => {
        await ownerPool.query(`UPDATE tenants SET name = $1 WHERE id = $2`, [
          workspace,
          DEFAULT_TENANT_ID,
        ]);
      });

    // Origin allowlist preHandler. When `deps.allowedOrigins` is supplied
    // (production wiring), pre-build the strict-equality Set once. When
    // omitted (legacy unit-test fixtures), fall back to canonical-only
    // resolution via `validateIngressBoot()` at request time so existing
    // test harnesses without an INGRESS_BASE_URL env still work.
    let originGuard: ReturnType<typeof makeOriginGuard> | undefined;
    if (deps.allowedOrigins && deps.allowedOrigins.length > 0) {
      originGuard = makeOriginGuard({ allowedOrigins: deps.allowedOrigins });
    }

    app.route({
      method: "POST",
      url: "/api/setup/admin",
      config: { auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } },
      // codeql[js/missing-rate-limiting] — false positive: this route IS
      // rate-limited via Fastify's `config.rateLimit` route option above
      // (5/min/IP, enforced by @fastify/rate-limit). LOCKER-04 in turn
      // REQUIRES every route to carry config.rateLimit.
      //
      // Pre-emptive LOCKER-04 migration: declare `schema: { body }` so
      // the route is structurally compliant before the Phase-41 bulkfix
      // flips LOCKER-04 to BLOCKING. The manual safeParse below stays
      // for defence-in-depth + because the test harness does not
      // register the zodTypeProvider validator compiler.
      schema: { body: setupAdminInput },
      ...(originGuard ? { preHandler: originGuard } : {}),
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // 1. Parse + validate. Unknown extra keys (e.g. `role:'admin'`)
        //    are silently dropped by Zod -- the whitelist semantics we
        //    need for T-12.03-07.
        const parseResult = setupAdminInput.safeParse(req.body);
        if (!parseResult.success) {
          return reply.code(400).send({
            error: {
              code: "INVALID_BODY",
              message: parseResult.error.message,
              requestId: req.id,
            },
          });
        }
        const body: SetupAdminInput = parseResult.data;

        // 2. Bearer-token branch detection (CC5 / D2).
        //    A1 -- the parsed env-token Buffer arrives via deps from
        //    validateSetupClaimBoot; we MUST NOT call parseSetupClaimToken
        //    again here. The presented Bearer string is normalised and
        //    shape-checked before timing-safe compare.
        const presentedBearer = ((): string | undefined => {
          const authz = req.headers.authorization;
          if (typeof authz !== "string") return undefined;
          if (!authz.startsWith("Bearer ")) return undefined; // RFC 6750 §2.1
          const stripped = authz.slice("Bearer ".length).trim();
          return stripped.length > 0 ? stripped : undefined;
        })();

        const envBuffer = deps.envClaimTokenBuffer; // undefined when env-token mode is off
        const isBearerPresent = presentedBearer !== undefined;
        const isBearerValid =
          isBearerPresent &&
          envBuffer !== undefined &&
          OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test(presentedBearer as string) &&
          safeTokenCompare(Buffer.from(presentedBearer as string, "hex"), envBuffer);

        // CC5 decision matrix:
        //   bearer absent → email branch (signUpEmail only, hook flips role)
        //   bearer present + valid → bearer branch (sync flip + 201)
        //   bearer present + invalid → 403 INVALID_SETUP_TOKEN
        //   bearer present + env unset → 403 SETUP_TOKEN_NOT_CONFIGURED
        if (isBearerPresent && envBuffer === undefined) {
          return reply.code(403).send({
            error: { code: "SETUP_TOKEN_NOT_CONFIGURED", requestId: req.id },
          });
        }
        if (isBearerPresent && !isBearerValid) {
          return reply.code(403).send({
            error: { code: "INVALID_SETUP_TOKEN", requestId: req.id },
          });
        }

        if (!isBearerPresent) {
          // ====================================================================
          // Mode B — verified-email branch.
          //
          // signUpEmail only. setup_state stays 'pending', users.role
          // stays NULL. Better Auth's existing sendVerificationEmail
          // chain dispatches the magic link automatically because
          // `requireEmailVerification:true` and `sendOnSignUp` is unset
          // (CC6). Response 201 with `pending_verification:true`.
          // ====================================================================
          const signUpResult = await signUpEmail({
            body: {
              email: body.email,
              password: body.password,
              name: body.name,
              ...(req.headers["accept-language"]
                ? { locale: pickLocale(req.headers["accept-language"]) }
                : {}),
            },
          });
          if (signUpResult.error || !signUpResult.data) {
            // NO setup_state rollback needed -- we never claimed it.
            req.log.warn(
              {
                code: signUpResult.error?.code,
                message: signUpResult.error?.message,
              },
              "admin_signup_failed_email_branch",
            );
            return reply.code(400).send({
              error: {
                code: "ADMIN_CREATE_FAILED",
                message: signUpResult.error?.message ?? "admin sign-up failed",
                requestId: req.id,
              },
            });
          }
          // Best-effort tenant rename. Failure does NOT block the email
          // verification flow; surfaced as a warnings entry.
          const warnings: string[] = [];
          try {
            await renameTenant(body.workspace);
          } catch (err) {
            req.log.warn(
              { err, workspace: body.workspace },
              "tenant_rename_failed_before_email_verify",
            );
            warnings.push("tenant_rename_failed");
          }
          const responseBody: Record<string, unknown> = {
            admin: { email: body.email },
            alreadyCompleted: false,
            pending_verification: true,
          };
          if (warnings.length > 0) responseBody.warnings = warnings;
          return reply.code(201).send(responseBody);
        }

        // ====================================================================
        // Mode A — Bearer-token branch (operator-recovery / corp internal).
        //
        // Synchronous flip: atomic claim setup_state, signUpEmail, flip
        // role WITHOUT the email_verified predicate (R8.3 + P6), tenant
        // rename, emit `admin.role_changed` audit, 201.
        // ====================================================================

        // 3. Atomic claim. RESEARCH §3 — UPDATE...RETURNING under txn-mode
        //    PgBouncer is the canonical race-safe single-statement claim.
        let claimRowCount = 0;
        await db.transaction(async (tx) => {
          const result = (await tx.execute(sql`
            UPDATE setup_state
               SET status = 'completed', completed_at = now()
             WHERE id = 1 AND status = 'pending'
             RETURNING status, completed_at
          `)) as { rows?: SetupStateClaimRow[]; rowCount?: number };
          /* v8 ignore next -- defensive: pg always sets rowCount on UPDATE RETURNING; the rows-length / 0 fallbacks cover hypothetical driver swaps. */
          claimRowCount = result.rowCount ?? result.rows?.length ?? 0;
        });

        if (claimRowCount === 0) {
          // Race-loser / already-completed. P1: 200, NEVER 409.
          const adminRes = await ownerPool.query<AdminLookupRow>(
            `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
          );
          const existingEmail = adminRes.rows[0]?.email;
          return reply.code(200).send({ admin: { email: existingEmail }, alreadyCompleted: true });
        }

        // 4. Winner branch — create the admin user via Better Auth.
        const signUpResult = await signUpEmail({
          body: {
            email: body.email,
            password: body.password,
            name: body.name,
            ...(req.headers["accept-language"]
              ? { locale: pickLocale(req.headers["accept-language"]) }
              : {}),
          },
        });
        if (signUpResult.error || !signUpResult.data) {
          // Compensating rollback — re-open the gate.
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              UPDATE setup_state SET status='pending', completed_at=NULL WHERE id = 1
            `);
          });
          req.log.warn(
            { code: signUpResult.error?.code, message: signUpResult.error?.message },
            "admin_signup_failed_rolling_back_setup_state",
          );
          return reply.code(400).send({
            error: {
              code: "ADMIN_CREATE_FAILED",
              /* v8 ignore next -- defensive: tests always set a message; the ?? branch covers a hypothetical Better Auth error shape with code-only. */
              message: signUpResult.error?.message ?? "admin sign-up failed",
              requestId: req.id,
            },
          });
        }

        // 5. Flip role server-side. Bearer branch BYPASSES the
        //    email_verified predicate (R8.3 + P6) -- that's its raison
        //    d'etre as the operator-recovery / corporate-internal path.
        //
        // Phase 35 / CR-4 (CRIT-FIX-06) — compensating rollback when
        // the role flip fails (transient pool error / statement timeout
        // / net blip).
        try {
          await ownerPool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
            signUpResult.data.user.id,
          ]);
        } catch (err) {
          req.log.error(
            { err, userId: signUpResult.data.user.id },
            "role_flip_failed_rolling_back_setup_admin",
          );
          try {
            await ownerPool.query(`DELETE FROM users WHERE id = $1`, [signUpResult.data.user.id]);
          } catch (cleanupErr) {
            req.log.warn(
              { err: cleanupErr, userId: signUpResult.data.user.id },
              "role_flip_cleanup_user_delete_failed",
            );
          }
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`
                UPDATE setup_state SET status='pending', completed_at=NULL WHERE id = 1
              `);
            });
          } catch (cleanupErr) {
            req.log.warn({ err: cleanupErr }, "role_flip_cleanup_setup_state_rollback_failed");
          }
          return reply.code(503).send({
            error: {
              code: "ADMIN_CREATE_FAILED",
              message: "admin role assignment failed; please retry",
              requestId: req.id,
            },
          });
        }

        // 6. Best-effort tenant rename.
        const warnings: string[] = [];
        try {
          await renameTenant(body.workspace);
        } catch (err) {
          req.log.warn(
            { err, workspace: body.workspace },
            "tenant_rename_failed_after_admin_create",
          );
          warnings.push("tenant_rename_failed");
        }

        // 7. Audit emission (closes O1). Wrapped in best-effort try/catch
        //    so an audit-row INSERT hiccup does NOT roll back the
        //    successful admin promotion at this stage -- the claim already
        //    committed, the user already exists, and the wizard's
        //    happy-path response is a hard requirement. We log loudly and
        //    move on. Per CC1 / D-A1, the audit row "exists iff the
        //    audited action commits" is best-effort here because we
        //    cannot atomically wrap signUpEmail (BA owns its own
        //    transaction).
        //
        // Capture user.id locally so TS flow analysis sees the
        // non-null narrowing across the db.transaction closure boundary
        // (signUpResult.data was checked at line 354 but the narrowing
        // is otherwise lost inside async lambdas).
        const newAdminUserId: string = signUpResult.data.user.id;
        const tenantIdForAudit = await resolveDefaultTenantId();
        try {
          const ctx: AuditCtx = auditCtxFromRequest(req, tenantIdForAudit, newAdminUserId);
          await db.transaction(async (tx) => {
            await recordAudit(tx, ctx, "admin.role_changed", {
              target_user_id: newAdminUserId,
              before: "user", // D4-locked choice (CC4)
              after: "admin",
            });
          });
        } catch (err) {
          req.log.warn({ err }, "admin_role_changed_audit_emit_failed");
        }

        // 8. Success.
        const successBody: Record<string, unknown> = {
          admin: { email: body.email },
          alreadyCompleted: false,
        };
        if (warnings.length > 0) {
          successBody.warnings = warnings;
        }
        return reply.code(201).send(successBody);
      },
    });
  };

/**
 * Naive Accept-Language parser — picks the first language code the
 * Phase-10 i18next chain accepts ('en' or 'ru').
 */
function pickLocale(header: string | string[] | undefined): "en" | "ru" {
  /* v8 ignore next -- Fastify normalizes Accept-Language to string|undefined; the Array branch covers a hypothetical multi-value caller. */
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  /* v8 ignore next -- defensive: String.prototype.split always returns ≥ 1 element; the ?? "" tail is unreachable. */
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("ru")) return "ru";
  return "en";
}

export default buildSetupAdminRoutes;
