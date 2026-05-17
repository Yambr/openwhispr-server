// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 1 — POST /api/setup/admin.
//
// Idempotent atomic-UPDATE-claim handler that bootstraps the first
// admin user via Better Auth `signUpEmail`, flips the singleton
// `setup_state` row from 'pending' to 'completed', sets users.role
// to 'admin' (server-side, NOT from request body), and renames the
// default tenant singleton to the wizard's `workspace` value.
//
// Contract verbatim from RESEARCH §3 + Q1 (workspace persistence):
//
//   1. UPDATE setup_state SET status='completed' WHERE status='pending'
//      RETURNING ...   -- atomic claim under PgBouncer txn-mode
//   2. rowCount===0    -> 200 alreadyCompleted:true (NEVER 409, P1)
//   3. rowCount===1    -> auth.api.signUpEmail({email,password,name,locale})
//   4. signUpEmail err -> compensating UPDATE setup_state SET status='pending'
//                          -> 400 ADMIN_CREATE_FAILED (T-12.03-05)
//   5. UPDATE users SET role='admin' WHERE id=$1
//   6. UPDATE tenants SET name=$workspace WHERE id=DEFAULT_TENANT_ID
//        (wrapped in try/catch — failure does NOT roll back the admin;
//         response carries warnings:['tenant_rename_failed'])
//   7. 201 { admin:{email}, alreadyCompleted:false [, warnings] }
//
// Why no transaction wrap (RESEARCH §3 open-q): Better Auth's
// signUpEmail opens its own DB connection through the Drizzle adapter
// (drizzleAdapter does NOT accept a transaction context — Better Auth
// #1841). The atomic UPDATE-RETURNING idiom in step 1 gives us the
// race-safe claim WITHOUT needing a wrapping transaction.
//
// Schema-availability notes (verified against codebase, 2026-05-14):
//   * tenants.name text NOT NULL EXISTS (packages/data/src/schema/tenants.ts:9).
//   * users.role text added by migration 0017_setup_state.sql, NOT declared
//     in the drizzle schema TS — we write it via raw SQL using the owner
//     Pool so the column doesn't need to round-trip through drizzle types.
//   * users.timezone DOES NOT EXIST. The wizard's `timezone` body field is
//     accepted for forward-compat but is NEVER persisted (deferred per
//     CONTEXT.md <deferred_ideas>). The handler whitelists payload fields
//     before forwarding to signUpEmail so a hostile `role:'admin'` extra
//     field cannot escalate (T-12.03-07).
//
// Rate-limit: `{max:5, timeWindow:'1 minute'}` per IP (T-12.03-02 / §15.b).

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

/**
 * Stable seeded UUID of the singleton root tenant. Cited from
 * `packages/data/src/schema/tenants.ts` header / 0000_initial.sql seed.
 * Wizard's workspace name is UPDATEd onto this row's `name` column
 * (RESEARCH Q1).
 */
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Shape of the call this handler issues into Better Auth. Mirrors the
 * subset of `auth.api.signUpEmail({body})` the route relies on. The
 * existing AuthLike in `middleware/dual-auth.ts` declares getSession
 * only; rather than widen it (which would force every existing dual-
 * auth fake in the suite to grow a stub), we declare a tiny per-route
 * shape that downstream wiring can adapt with a one-liner.
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
 * Best-effort tenant rename. Default implementation issues a raw SQL
 * UPDATE through the owner pool; tests can inject a throwing stub to
 * exercise the warnings-array branch (T-12.03-05 sub-test 7) without
 * having to corrupt the live schema.
 */
export type SetupAdminRenameTenant = (workspace: string) => Promise<void>;

export interface SetupAdminDeps {
  db: TransactionalDb<ExecutableTx>;
  /**
   * Owner pool — used for raw-SQL writes against columns NOT declared
   * in drizzle schema TS (users.role; see migration 0017). Production
   * wiring passes the same pool buildApp() uses for drizzle.
   */
  ownerPool: Pool;
  signUpEmail: SetupAdminSignUpEmail;
  /** Override for the tenant-rename failure test (T-12.03-05 sub-test 7). */
  renameTenant?: SetupAdminRenameTenant;
}

/**
 * Request body schema. `role` is INTENTIONALLY absent — we read only
 * the whitelisted fields and the unknown-key fallthrough drops any
 * hostile escalation attempt (T-12.03-07). `timezone` is accepted but
 * NOT forwarded into the DB (deferred; CONTEXT.md <deferred_ideas>).
 *
 * Password min(12) mirrors the wizard schema in
 * apps/web/src/lib/schemas/setup.ts (D-14 — no zxcvbn meter, just a
 * floor + character-class regex).
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

export const buildSetupAdminRoutes = (deps: SetupAdminDeps) =>
  async function setupAdminRoutes(app: FastifyInstance): Promise<void> {
    const { db, ownerPool, signUpEmail } = deps;
    // Default tenant-rename implementation: small UPDATE against the
    // owner pool. Sits OUTSIDE Better Auth's transaction boundary by
    // construction (signUpEmail uses its own drizzle adapter connection).
    const renameTenant: SetupAdminRenameTenant =
      deps.renameTenant ??
      (async (workspace: string) => {
        await ownerPool.query(`UPDATE tenants SET name = $1 WHERE id = $2`, [
          workspace,
          DEFAULT_TENANT_ID,
        ]);
      });

    app.route({
      method: "POST",
      url: "/api/setup/admin",
      // T-12.03-02 — anti-spam floor; 5/min/IP. Plan 12-03 RESEARCH §15(b).
      // Distinct from /api/setup-state's 30/min/IP — that endpoint is a
      // cheap polled read; THIS endpoint mutates state.
      //
      // Phase 51 / Plan 51-01 (REVIEW-INDEX CR-3) — `auth: false` opt-out
      // of the global dualAuthHook. The wizard runs BEFORE any admin
      // exists, so the global hook would 401 every claim before the
      // handler could create the first user. Same opt-out pattern as the
      // sister route /api/setup-state (Phase 35 / CRIT-FIX-04). Anti-abuse
      // is preserved by the per-IP rateLimit above.
      config: { auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // 1. Parse + validate. Unknown extra keys (e.g. `role:'admin'`)
        //    are silently dropped — Zod's default behaviour is "strip
        //    unknown", which is exactly the whitelist semantics we need
        //    for T-12.03-07.
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

        // 2. Atomic claim. RESEARCH §3 — UPDATE...RETURNING under txn-mode
        //    PgBouncer is the canonical race-safe single-statement claim.
        //    drizzle's pg `execute(sql\`...\`)` returns `{rows, rowCount}`
        //    matching the libpq result shape.
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
          // 2a. Race-loser / already-completed. P1: return 200, NEVER 409.
          //     Surface the existing admin's email (best-effort SELECT
          //     against the raw role column).
          const adminRes = await ownerPool.query<AdminLookupRow>(
            `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
          );
          const existingEmail = adminRes.rows[0]?.email;
          return reply.code(200).send({ admin: { email: existingEmail }, alreadyCompleted: true });
        }

        // 3. Winner branch — create the admin user via Better Auth.
        //    Whitelist the forwarded fields (T-12.03-07): NEVER pass
        //    the raw request body, NEVER forward `role`.
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
          // 3a. Compensating rollback — re-open the gate (RESEARCH §3 step 4).
          //     UPDATE setup_state SET status='pending', completed_at=NULL.
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

        // 4. Flip role server-side. Raw SQL because users.role is not
        //    declared in the drizzle schema TS (migration-only column).
        //
        // Phase 35 / CR-4 (CRIT-FIX-06) — compensating rollback when the
        // role flip fails (transient pool error / statement timeout / net
        // blip). Without this guard, a step-4 throw left setup_state at
        // 'completed' AND a non-admin user row, which then made every
        // subsequent POST short-circuit to `alreadyCompleted: true` with
        // `admin: { email: undefined }` (the SELECT WHERE role='admin'
        // returns zero rows) and the instance was wedged. The fix:
        //   (a) DELETE the half-created user (so the next attempt has a
        //       clean slate against the email-unique index),
        //   (b) UPDATE setup_state SET status='pending', completed_at=NULL
        //       (re-opens the claim gate, exactly as the signUpEmail
        //       compensating branch on lines 213-217 does),
        //   (c) return 503 ADMIN_CREATE_FAILED so the wizard surfaces a
        //       retryable error instead of a "setup already done" lie.
        // Cleanup queries themselves are best-effort — on a cascading
        // outage the operator still reaches a recoverable state on the
        // next request after the transient condition clears.
        try {
          await ownerPool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
            signUpResult.data.user.id,
          ]);
        } catch (err) {
          req.log.error(
            { err, userId: signUpResult.data.user.id },
            "role_flip_failed_rolling_back_setup_admin",
          );
          // (a) DELETE the half-created user. CASCADE removes any
          //     Better-Auth-emitted session/account rows tied to the id.
          try {
            await ownerPool.query(`DELETE FROM users WHERE id = $1`, [signUpResult.data.user.id]);
          } catch (cleanupErr) {
            req.log.warn(
              { err: cleanupErr, userId: signUpResult.data.user.id },
              "role_flip_cleanup_user_delete_failed",
            );
          }
          // (b) Re-open the setup_state gate.
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`
                UPDATE setup_state SET status='pending', completed_at=NULL WHERE id = 1
              `);
            });
          } catch (cleanupErr) {
            req.log.warn({ err: cleanupErr }, "role_flip_cleanup_setup_state_rollback_failed");
          }
          // (c) Recoverable error envelope (NOT `alreadyCompleted: true`).
          return reply.code(503).send({
            error: {
              code: "ADMIN_CREATE_FAILED",
              message: "admin role assignment failed; please retry",
              requestId: req.id,
            },
          });
        }

        // 5. Best-effort tenant rename (RESEARCH Q1).
        //    Failure does NOT roll back the admin — that would block
        //    legitimate sign-in. Surface as a warnings entry instead
        //    (T-12.03-05).
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

        // 6. Success. Note: we do NOT persist `body.timezone` anywhere
        //    — no users.timezone column exists (CONTEXT.md
        //    <deferred_ideas>). Sub-test 6 asserts the column absence
        //    via information_schema as a regression net.
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
 * Phase-10 i18next chain accepts ('en' or 'ru'). The auth.ts
 * additionalFields.locale.defaultValue is 'en' so an unparseable
 * header falls through gracefully; we keep the function defensive.
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
