// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-03 / Task 1 — SSO JIT Better Auth wiring.
//
// This module owns the two web-side JIT seams that auth.ts registers on the
// Better Auth instance (D-69-1, Option C — the shared pure resolver runs at
// exactly ONE call-site on the web path):
//
//   * makeMapProfileToUser(jitConfig, deps) — the genericOAuth `mapProfileToUser`
//     closure. This is the ONLY place raw OIDC claims are visible on the web
//     path (69-RESEARCH fact 1). It calls the already-built `resolveJitDecision`
//     and PROJECTS `{tenantId, role}` onto the user (the return is spread onto
//     the user by Better Auth). On a typed rejection it throws `JitRejectionError`
//     carrying the RejectionCode AND emits a no-PII `sso.jit.rejected` audit row
//     (own withTenant(DEFAULT_TENANT_ID) tx, actor_user_id=null — Pitfall 5).
//
//   * buildJitDatabaseHooks(deps) — the 4 `databaseHooks.user.{create,update}
//     .{before,after}` hooks (fire on BOTH the web genericOAuth path and the
//     desktop createOAuthUser path):
//       - create.before  : reads the projected tenantId/role (no-op pass-through;
//                           the resolver already decided). Asserts a tenantId was
//                           projected (defence-in-depth — a JIT create with no
//                           tenant is a programmer error, not a silent default).
//       - update.before   : returning-user re-sync. Compares the incoming
//                           projected tenantId against the persisted row; a
//                           changed tenant → forbidden_tenant_mismatch (mode 6).
//                           Re-syncs the role and annotates the before/after
//                           framing for the audit hook.
//       - create.after    : emits sso.jit.user.created (own withTenant tx — the
//                           after-hooks run POST-commit, D-69-2 deviation).
//       - update.after    : emits sso.jit.role.updated.
//
// No-PII (D-69-2 / T-69-09): the audit payloads + the structured-log objects
// carry ONLY tenant_id / role / code / before / after / reason. email / name /
// sub / raw groups NEVER enter either sink. `recordAudit`'s forbidden-key sweep
// + the `.strict()` payload schemas (audit.ts) fail loud on a leak.

import { withTenant } from "@openwhispr/data";
import type { AppDb } from "@openwhispr/data/client";
import type { User } from "better-auth";
import { sql } from "drizzle-orm";

import { type AuditCtx, recordAudit } from "./audit.js";
import { resolveDefaultTenantId } from "./default-tenant.js";
import type { JitConfig, JitRole } from "./oidc-jit-config.js";
import type { ExistingIdentity, RejectionCode } from "./oidc-jit-resolver.js";
import { resolveJitDecision } from "./oidc-jit-resolver.js";

/**
 * Minimal logger surface the hooks emit through. Matches the
 * `BuildAuthOptions.log` shape in auth.ts so the production wiring threads
 * `opts.log ?? fallbackLog` straight in.
 */
export interface JitLogger {
  info(msg: unknown): void;
  warn(msg: unknown): void;
}

/** Dependencies shared by the map seam + the database hooks. */
export interface JitHookDeps {
  readonly db: AppDb;
  readonly jitConfig: JitConfig;
  readonly log: JitLogger;
}

/**
 * Typed rejection raised by the JIT seams. The error-handler maps `.code` →
 * HTTP status (forbidden_* → 403, invalid_oidc_profile → 400) and emits the
 * `{ error: { code } }` envelope (Plan 69-03 Task 2). The message is the code
 * verbatim — it carries NO PII and is safe to surface.
 */
export class JitRejectionError extends Error {
  override readonly name = "JitRejectionError";
  readonly code: RejectionCode;
  constructor(code: RejectionCode) {
    super(code);
    this.code = code;
  }
}

const VALID_ROLES: readonly JitRole[] = ["admin", "member", "viewer"];

function asJitRole(value: unknown): JitRole | undefined {
  return typeof value === "string" ? VALID_ROLES.find((role) => role === value) : undefined;
}

/** Map the configured tenant-claim mode onto the audit enum. */
function tenantClaimMode(cfg: JitConfig): "named_claim" | "email_domain" {
  return cfg.tenantClaim === "email_domain" ? "email_domain" : "named_claim";
}

/**
 * Build an AuditCtx directly (the hooks have no Fastify `req`). request_id is a
 * fresh UUID correlator; ip is null and user_agent is the fixed hook marker so
 * the row is attributable to the JIT path without carrying any client data.
 */
function jitAuditCtx(tenantId: string, actorUserId: string | null): AuditCtx {
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    request_id: crypto.randomUUID(),
    ip: null,
    user_agent: "sso-jit-hook",
  };
}

/**
 * Emit `sso.jit.rejected` (no committed user row → DEFAULT_TENANT_ID,
 * actor_user_id=null; own withTenant tx — Pitfall 5 / auth.signin_failed
 * precedent). Best-effort: an audit hiccup must NOT mask the underlying
 * rejection, which is the security-relevant signal the caller surfaces.
 */
async function emitRejected(deps: JitHookDeps, code: RejectionCode): Promise<void> {
  deps.log.warn({ event: "sso.jit.rejected", code });
  try {
    const tenantId = await resolveDefaultTenantId();
    await withTenant(deps.db, tenantId, async (tx) => {
      await recordAudit(tx, jitAuditCtx(tenantId, null), "sso.jit.rejected", {
        tenant_id: tenantId,
        code,
      });
    });
  } catch (err) {
    deps.log.warn({ event: "sso.jit.rejected.audit_emit_failed", err });
  }
}

/**
 * Emit `sso.jit.user.created` (structured log + audit row, own withTenant tx).
 * Exported so BOTH the genericOAuth `create.after` hook AND the desktop
 * mint-bearer createOAuthUser path call it — the latter uses the RAW internal
 * adapter, which does NOT fire `databaseHooks.create.after`, so without this
 * explicit call the desktop OIDC path provisions the user but emits no audit.
 * Best-effort audit (a hiccup must not fail the sign-in that already committed).
 */
export async function emitUserCreated(
  deps: JitHookDeps,
  userId: string,
  tenantId: string,
  role: JitRole,
): Promise<void> {
  deps.log.info({ event: "sso.jit.user.created", tenant_id: tenantId, role });
  try {
    await withTenant(deps.db, tenantId, async (tx) => {
      await recordAudit(tx, jitAuditCtx(tenantId, userId), "sso.jit.user.created", {
        tenant_id: tenantId,
        role,
        tenant_claim_mode: tenantClaimMode(deps.jitConfig),
      });
    });
  } catch (err) {
    deps.log.warn({ event: "sso.jit.user.created.audit_emit_failed", err });
  }
}

/**
 * Emit `sso.jit.role.updated` (structured log + audit row, own withTenant tx).
 * Exported for the same reason as `emitUserCreated` — the desktop returning-user
 * role re-sync runs outside Better Auth's `update.after` hook.
 */
export async function emitRoleUpdated(
  deps: JitHookDeps,
  userId: string,
  tenantId: string,
  before: JitRole,
  after: JitRole,
  reason: "group_change" | "revocation_downgrade",
): Promise<void> {
  deps.log.info({ event: "sso.jit.role.updated", tenant_id: tenantId, before, after, reason });
  try {
    await withTenant(deps.db, tenantId, async (tx) => {
      await recordAudit(tx, jitAuditCtx(tenantId, userId), "sso.jit.role.updated", {
        tenant_id: tenantId,
        before,
        after,
        reason,
      });
    });
  } catch (err) {
    deps.log.warn({ event: "sso.jit.role.updated.audit_emit_failed", err });
  }
}

/**
 * Web claim-projection seam (D-69-1). Returns the closure Better Auth's
 * genericOAuth invokes as `mapProfileToUser(profile)`. On `ok` it projects
 * `{ tenantId, role }` onto the user; on rejection it emits `sso.jit.rejected`
 * and throws `JitRejectionError`.
 */
export function makeMapProfileToUser(
  jitConfig: JitConfig,
  deps: { db: AppDb; log: JitLogger },
): (
  profile: Record<string, unknown>,
) => Promise<Partial<User> & { tenantId: string; role: JitRole }> {
  const hookDeps: JitHookDeps = { db: deps.db, jitConfig, log: deps.log };
  return async (profile: Record<string, unknown>) => {
    const decision = resolveJitDecision(profile, jitConfig);
    if (!decision.ok) {
      await emitRejected(hookDeps, decision.code);
      throw new JitRejectionError(decision.code);
    }
    return { tenantId: decision.tenantId, role: decision.role };
  };
}

/** Shape the before-hooks return to replace the create/update payload. */
type HookData = { data: Record<string, unknown> };

/** The 4 user databaseHooks, typed structurally to Better Auth's contract. */
export interface JitDatabaseHooks {
  user: {
    create: {
      before: (user: Record<string, unknown>, context: unknown) => Promise<HookData | false>;
      after: (user: Record<string, unknown>, context: unknown) => Promise<void>;
    };
    update: {
      before: (user: Record<string, unknown>, context: unknown) => Promise<HookData | false>;
      after: (user: Record<string, unknown>, context: unknown) => Promise<void>;
    };
  };
}

/**
 * Build the 4 JIT databaseHooks bound to `db` + `jitConfig`. Fires on both the
 * web (genericOAuth) and desktop (createOAuthUser) create paths.
 */
export function buildJitDatabaseHooks(deps: JitHookDeps): JitDatabaseHooks {
  return {
    user: {
      create: {
        // The resolver already projected tenantId/role in mapProfileToUser
        // (web) or mint-bearer (desktop). create.before asserts the projection
        // landed — a JIT create with no tenant is a programmer error, not a
        // silent fall-through to the default tenant.
        before: async (user) => {
          const tenantId = user.tenantId;
          if (typeof tenantId !== "string" || tenantId.length === 0) {
            await emitRejected(deps, "invalid_oidc_profile");
            throw new JitRejectionError("invalid_oidc_profile");
          }
          return { data: { ...user } };
        },
        // POST-commit (D-69-2): own withTenant tx for the audit row.
        after: async (user) => {
          const tenantId = String(user.tenantId);
          const role = asJitRole(user.role);
          if (role === undefined) return;
          await emitUserCreated(deps, String(user.id), tenantId, role);
        },
      },
      update: {
        // Returning-user re-sync. The incoming user carries the freshly-resolved
        // projected tenantId/role; compare against the persisted identity.
        before: async (user) => {
          const id = user.id;
          const incomingTenant = user.tenantId;
          if (
            typeof id !== "string" ||
            id.length === 0 ||
            typeof incomingTenant !== "string" ||
            incomingTenant.length === 0
          ) {
            // Not a JIT-attributable update (no id / no projected tenant) →
            // pass through untouched so non-JIT updates are unaffected.
            return { data: { ...user } };
          }

          // Look the row up UNDER THE INCOMING (freshly-resolved) tenant. The
          // users RLS policy is `tenant_id = current_setting('app.tenant_id')`,
          // so a returning user bound to tenant A presenting tenant-B claims is
          // NOT visible under tenant B → that absence IS the mode-6 signal
          // (a user is permanently bound to one tenant; the claim changed).
          const existing = await loadExistingUnderTenant(deps.db, id, incomingTenant);
          if (existing === undefined) {
            // The id exists (Better Auth resolved it) but not under the claimed
            // tenant → the bound tenant changed. Mode 6 — reject (RLS invariant).
            await emitRejected(deps, "forbidden_tenant_mismatch");
            throw new JitRejectionError("forbidden_tenant_mismatch");
          }

          const incomingRole = asJitRole(user.role);
          if (incomingRole === undefined || incomingRole === existing.role) {
            // No role change to re-sync.
            return { data: { ...user } };
          }

          const reason: "group_change" | "revocation_downgrade" =
            existing.role === "admin" && incomingRole !== "admin"
              ? "revocation_downgrade"
              : "group_change";

          return {
            data: {
              ...user,
              role: incomingRole,
              // Carried hints for update.after's before/after audit framing.
              __jitRoleBefore: existing.role,
              __jitRoleReason: reason,
            },
          };
        },
        after: async (user) => {
          const before = asJitRole(user.__jitRoleBefore);
          const after = asJitRole(user.role);
          if (before === undefined || after === undefined || before === after) {
            // Nothing was re-synced → no audit row.
            return;
          }
          const tenantId = String(user.tenantId);
          const reason =
            user.__jitRoleReason === "revocation_downgrade"
              ? "revocation_downgrade"
              : "group_change";
          await emitRoleUpdated(deps, String(user.id), tenantId, before, after, reason);
        },
      },
    },
  };
}

/**
 * Read the persisted identity (tenant + role) of user `id` SCOPED TO `tenantId`.
 *
 * The users RLS policy is `tenant_id = current_setting('app.tenant_id')`
 * (migration 0018), so the row is visible only when the GUC matches the row's
 * tenant. We bind the GUC to the freshly-resolved (incoming) tenant via
 * `withTenant`: a `undefined` result therefore means "this id is NOT in the
 * claimed tenant" — either the bound tenant changed (mode 6) or no row exists.
 * Returns the row's tenant + role when found, else `undefined`.
 */
async function loadExistingUnderTenant(
  db: AppDb,
  id: string,
  tenantId: string,
): Promise<ExistingIdentity | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    // drizzle node-postgres `.execute` returns { rows }; params are bound.
    const result = await tx.execute(sqlSelectIdentity(id));
    const rows = (result as { rows?: Array<{ tenant_id?: unknown; role?: unknown }> }).rows ?? [];
    const first = rows[0];
    if (first === undefined || typeof first.tenant_id !== "string") {
      return undefined;
    }
    return {
      tenantId: first.tenant_id,
      role: typeof first.role === "string" ? first.role : "",
    };
  });
}

function sqlSelectIdentity(id: string) {
  return sql`SELECT tenant_id, role FROM users WHERE id = ${id} LIMIT 1`;
}
