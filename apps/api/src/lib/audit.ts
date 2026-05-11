// Phase 6 / Plan 05 / Task 1 — canonical audit-log emission helper.
//
// Source of truth:
//   - .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
//     D-A1 (sync in-band INSERT), D-A6 (18-action enum, locked),
//     D-A7 (per-action required keys + forbidden-key list).
//   - packages/data/src/schema/audit_log.ts (AUDIT_LOG_ACTIONS,
//     AuditLogAction type, audit_log_action_check CHECK constraint).
//
// Design:
//   - recordAudit() is the SINGLE chokepoint for writing to audit_log
//     across the API. Every emission site flows through here.
//   - Caller passes the `tx` from `withTenant(db, tenantId, async tx => …)`
//     so the INSERT participates in the route's transaction — the
//     audit row exists iff the audited action commits (D-A1, threat
//     T-audit-loss). If the route fails before COMMIT, the audit row
//     rolls back with it. No async fanout, no outbox.
//   - Per-action Zod schemas enforce D-A7 required keys at compile time
//     (the `satisfies Record<AuditAction, …>` cast catches missing
//     entries) AND at runtime (`.parse()` before the INSERT).
//   - FORBIDDEN_AUDIT_KEYS is a hard runtime guard against a programmer
//     accidentally stuffing a secret into the payload. Case-insensitive
//     so `Authorization: Bearer …` is caught as well as `authorization`.
//   - `AUDIT_REDACT_IP=true` clamps payload.ip to null. user_agent is
//     truncated to 512 chars (D-A7).
//
// Threat refs:
//   - T-audit-loss — sync INSERT inside route tx.
//   - T-bearer-leak — forbidden-key sweep prevents raw secrets reaching
//     JSONB; sentinel test in audit.test.ts proves enforcement.

import type { ExecutableTx } from "@openwhispr/data";
import { AUDIT_LOG_ACTIONS, type AuditLogAction } from "@openwhispr/data/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Re-exported from the data package so route code can import the
 * const-union and the type from a single audit-domain entrypoint.
 */
export const AUDIT_ACTIONS = AUDIT_LOG_ACTIONS;
export type AuditAction = AuditLogAction;

/**
 * Forbidden keys — D-A7. Case-insensitive. recordAudit throws if the
 * caller-supplied payload contains any of these AT THE TOP LEVEL.
 * Nested-object scrubbing is out of scope here; the per-action Zod
 * schemas are `.strict()`-equivalent (only declared keys land in the
 * payload) so adversarial nesting cannot reach the JSONB column.
 */
export const FORBIDDEN_AUDIT_KEYS = [
  "password",
  "token",
  "bearer",
  "access_token",
  "refresh_token",
  "code",
  "state",
  "virtual_key",
  "api_key",
  "authorization",
] as const;

const FORBIDDEN_AUDIT_KEY_SET = new Set<string>(FORBIDDEN_AUDIT_KEYS);

/**
 * Always-required ctx fields. `actor_user_id` is nullable for unauth
 * `auth.signin_failed` and `security.*` rows that cannot identify a
 * user yet.
 */
export interface AuditCtx {
  tenant_id: string;
  actor_user_id?: string | null;
  request_id: string;
  ip: string | null;
  user_agent: string;
}

// Base ctx validation — uuid + ip + user_agent shape. tenant_id +
// actor_user_id are UUIDs; ip is either an IPv4/IPv6 literal or null
// (operator-controlled by AUDIT_REDACT_IP).
const ctxSchema = z.object({
  tenant_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable().optional(),
  request_id: z.string().uuid(),
  ip: z.union([z.ipv4(), z.ipv6(), z.null()]),
  user_agent: z.string(),
});

// D-A7 enums — shared across multiple action payloads.
const authMethod = z.enum([
  "password",
  "oauth_google",
  "oauth_github",
  "oauth_microsoft",
  "oauth_okta",
  "email_otp",
]);
const signinFailedReason = z.enum([
  "bad_credentials",
  "expired_otp",
  "oauth_state_mismatch",
  "locked",
  "unknown",
]);
const passwordChangeMethod = z.enum(["self", "admin_forced"]);
const keyRevokeReason = z.enum(["rotated", "manual", "compromised"]);
const sha256Hex = z.string().length(64);

/**
 * Per-action payload schemas. The `satisfies Record<AuditAction, …>`
 * cast is what catches a missing entry at compile time if a new
 * action is added to AUDIT_LOG_ACTIONS without a schema entry here.
 */
export const auditPayloadSchemas = {
  "auth.signin": z.object({ method: authMethod }),
  "auth.signin_failed": z.object({ method: authMethod, reason: signinFailedReason }),
  "auth.signout": z.object({}),
  "auth.password_change": z.object({ method: passwordChangeMethod }),
  "auth.oauth_link": z.object({ provider: z.string().min(1) }),
  "account.delete": z.object({}),
  "account.delete_requested": z.object({ grace_window_seconds: z.number().int().positive() }),
  "key.issued": z.object({ key_id: z.string().min(1) }),
  "key.revoked": z.object({ key_id: z.string().min(1), reason: keyRevokeReason }),
  "settings.tenant_changed": z.object({
    field: z.string().min(1),
    before_hash: sha256Hex,
    after_hash: sha256Hex,
  }),
  "settings.user_changed": z.object({
    field: z.string().min(1),
    before_hash: sha256Hex,
    after_hash: sha256Hex,
  }),
  "admin.tenant_created": z.object({ tenant_id: z.string().uuid() }),
  "admin.tenant_suspended": z.object({
    tenant_id: z.string().uuid(),
    reason: z.string().min(1),
  }),
  "admin.user_impersonated": z.object({
    target_user_id: z.string().uuid(),
    reason: z.string().min(1),
  }),
  "admin.role_changed": z.object({
    target_user_id: z.string().uuid(),
    before: z.string().min(1),
    after: z.string().min(1),
  }),
  "security.cross_tenant_attempt": z.object({
    attempted_tenant_id: z.string().uuid(),
    route: z.string().min(1),
  }),
  "security.rate_limit_exceeded": z.object({
    rule: z.string().min(1),
    route: z.string().min(1),
  }),
  "security.ssrf_blocked": z.object({
    target_url_host: z.string().min(1),
    rule: z.string().min(1),
    mode: z.enum(["enforce", "warn"]).optional(),
  }),
} as const satisfies Record<AuditAction, z.ZodTypeAny>;

/**
 * Per-action typed payload — `AuditPayload<'auth.signin'>` is
 * `{ method: 'password' | 'oauth_google' | ... }`.
 */
export type AuditPayload<A extends AuditAction> = z.infer<(typeof auditPayloadSchemas)[A]>;

function rejectForbidden(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_AUDIT_KEY_SET.has(key.toLowerCase())) {
      throw new Error(`audit payload contains forbidden key: ${key} (D-A7 / T-bearer-leak)`);
    }
  }
}

const MAX_USER_AGENT_CHARS = 512;

/**
 * Best-effort failure semantics:
 *
 * recordAudit throws on validation errors (caller misuse — programmer
 * bug, must surface). It also throws if the INSERT itself fails (DB
 * down, CHECK violation, etc.) because the caller's transaction MUST
 * roll back per D-A1 — if the audit row cannot be written, the
 * audited action MUST NOT commit. Route handlers should NOT catch this
 * error: let it bubble up so the global error handler returns the
 * canonical envelope and the tx rolls back atomically.
 *
 * Operator-facing observability of audit failures is via Loki: the
 * INSERT error is logged by the standard pino error path attached to
 * the route's failure. Grafana alert on `level=error AND msg=~"audit"`
 * is the surface; Plan 06-11 (alerts) extends this.
 */
export async function recordAudit<A extends AuditAction>(
  tx: ExecutableTx,
  ctx: AuditCtx,
  action: A,
  payload: AuditPayload<A>,
): Promise<void> {
  // Validate ctx (uuid + ip + ua shape).
  ctxSchema.parse(ctx);

  // Validate the per-action payload (compile-time-checked schema map).
  const schema = auditPayloadSchemas[action] as z.ZodTypeAny;
  const validated = schema.parse(payload) as Record<string, unknown>;

  // Forbidden-key sweep on the CALLER-supplied payload — `.parse()`
  // strips unknown keys for the declared schema, but we want to reject
  // (not silently drop) so a programmer mistake fails loudly. Run the
  // sweep over the raw input.
  rejectForbidden(payload as Record<string, unknown>);

  const ip = process.env.AUDIT_REDACT_IP === "true" ? null : ctx.ip;
  const userAgent = ctx.user_agent.slice(0, MAX_USER_AGENT_CHARS);

  const fullPayload: Record<string, unknown> = {
    ...validated,
    request_id: ctx.request_id,
    ip,
    user_agent: userAgent,
  };

  await tx.execute(
    sql`INSERT INTO audit_log (tenant_id, actor_user_id, action, payload)
        VALUES (${ctx.tenant_id}, ${ctx.actor_user_id ?? null}, ${action}, ${fullPayload})`,
  );
}

/**
 * Convenience builder for routes — extracts ctx from a Fastify request
 * shape so emission sites stay one-liners. The route handler still
 * needs to pass the `tx` from withTenant explicitly.
 */
export interface RequestLikeForAudit {
  id: string;
  ip: string;
  headers: { "user-agent"?: string | undefined } & Record<string, unknown>;
}

export function auditCtxFromRequest(
  req: RequestLikeForAudit,
  tenantId: string,
  actorUserId: string | null,
): AuditCtx {
  const ua = (req.headers["user-agent"] ?? "unknown") as string;
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    request_id: req.id,
    ip: req.ip ?? null,
    user_agent: ua,
  };
}
