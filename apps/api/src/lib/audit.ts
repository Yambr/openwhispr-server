// SPDX-License-Identifier: FSL-1.1-ALv2
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
// Hex UUID regex — matches the same accepted shape as withTenant() in
// `packages/data/src/tenant-context.ts` so any tenant id that passes
// the request-tier RLS gate also passes the audit ctx gate. Zod 4's
// `z.string().uuid()` enforces the strict RFC-4122 variant byte
// (8/9/a/b), which rejects the project's test-fixture tenant_ids
// (`00000000-0000-0000-0000-00000000000b`) that the seed + RLS
// invariants accept everywhere else. Strict RFC validation is
// applied in the audit_log_tenant_id_tenants_id_fk + RLS layers
// downstream; our schema only enforces well-formedness of the
// correlator.
const HEX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hexUuid = z.string().regex(HEX_UUID_RE, "invalid uuid");

const ctxSchema = z.object({
  tenant_id: hexUuid,
  actor_user_id: hexUuid.nullable().optional(),
  // Fastify's default `genReqId` emits an incrementing counter
  // (`req-N`), not a UUID. We require a non-empty correlator string;
  // operators wiring a UUID-shaped request-id middleware (Phase 6 /
  // Plan 03 pino correlation) get UUID values, but the helper does
  // not refuse non-UUID correlators.
  request_id: z.string().min(1),
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

// D-69-2 — SSO JIT provisioning enums. `rolesEnum` is the canonical
// application role set (mirrors users.role); the SSO payloads carry the
// role verbatim (non-PII). `tenantClaimMode` / `roleUpdateReason` /
// `jitRejectionCode` are the closed value sets locked in 69-DECISIONS.md.
const rolesEnum = z.enum(["admin", "member", "viewer"]);
const tenantClaimMode = z.enum(["named_claim", "email_domain"]);
const roleUpdateReason = z.enum(["group_change", "revocation_downgrade"]);
const jitRejectionCode = z.enum([
  "forbidden_missing_tenant_claim",
  "forbidden_unknown_tenant",
  "forbidden_no_role_mapping",
  "forbidden_tenant_mismatch",
  "invalid_oidc_profile",
]);

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
  "admin.tenant_created": z.object({ tenant_id: hexUuid }),
  "admin.tenant_suspended": z.object({
    tenant_id: hexUuid,
    reason: z.string().min(1),
  }),
  "admin.user_impersonated": z.object({
    target_user_id: hexUuid,
    reason: z.string().min(1),
  }),
  "admin.role_changed": z.object({
    target_user_id: hexUuid,
    before: z.string().min(1),
    after: z.string().min(1),
  }),
  "security.cross_tenant_attempt": z.object({
    attempted_tenant_id: hexUuid,
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
  // D-69-2 — SSO JIT provisioning audit payloads. NO PII: email / name /
  // sub / raw groups / the email_domain literal MUST NOT enter the
  // payload. `.strict()` REJECTS any extra key (PII or otherwise) instead
  // of silently stripping it, so a leak fails loud at the recordAudit
  // chokepoint. The winning group is carried ONLY as a SHA-256 hash,
  // mirroring settings.*_changed before/after_hash.
  "sso.jit.user.created": z
    .object({
      tenant_id: hexUuid,
      role: rolesEnum,
      tenant_claim_mode: tenantClaimMode,
      matched_group_hash: sha256Hex.optional(),
    })
    .strict(),
  "sso.jit.role.updated": z
    .object({
      tenant_id: hexUuid,
      before: rolesEnum,
      after: rolesEnum,
      reason: roleUpdateReason,
    })
    .strict(),
  "sso.jit.rejected": z
    .object({
      tenant_id: hexUuid,
      code: jitRejectionCode,
    })
    .strict(),
} as const satisfies Record<AuditAction, z.ZodTypeAny>;

/**
 * Per-action typed payload — `AuditPayload<'auth.signin'>` is
 * `{ method: 'password' | 'oauth_google' | ... }`.
 */
export type AuditPayload<A extends AuditAction> = z.infer<(typeof auditPayloadSchemas)[A]>;

/**
 * Phase 69 / Plan 69-03 — per-action carve-outs from the forbidden-key sweep.
 *
 * `FORBIDDEN_AUDIT_KEYS` blocks `code` because the OAuth authorization `code`
 * is a one-time secret that must never reach the JSONB column. But the
 * `sso.jit.rejected` action (D-69-2) legitimately carries a `code` key whose
 * value is a CLOSED, non-secret rejection-code enum (`jitRejectionCode`),
 * `.strict()`-validated above — there is no secret to leak. Without this
 * carve-out the action is structurally UNWRITABLE (the sweep throws on every
 * emit), so the SPEC-mandated `sso.jit.rejected` audit row could never land.
 * The allowance is scoped to (action, key) pairs so `code` stays forbidden for
 * every other action and the OAuth-secret protection is unchanged.
 */
const FORBIDDEN_KEY_ACTION_ALLOWLIST: ReadonlyMap<AuditAction, ReadonlySet<string>> = new Map([
  ["sso.jit.rejected", new Set(["code"])],
]);

function rejectForbidden(payload: Record<string, unknown>, action: AuditAction): void {
  const allowed = FORBIDDEN_KEY_ACTION_ALLOWLIST.get(action);
  for (const key of Object.keys(payload)) {
    const lower = key.toLowerCase();
    if (allowed?.has(lower)) continue;
    if (FORBIDDEN_AUDIT_KEY_SET.has(lower)) {
      throw new Error(`audit payload contains forbidden key: ${key} (D-A7 / T-bearer-leak)`);
    }
  }
}

/**
 * Phase 10 / Plan 10-01d — Cyrillic guard (T-10-01 mitigation).
 *
 * Constitutional rule (CLAUDE.md): audit_log payload values MUST stay
 * English-only. Localized strings belong in apps/api/src/i18n/locales —
 * NEVER inside `audit_log.payload`, which downstream forensics tooling
 * (SIEM ingestion, grep audits, Loki queries) treats as a stable
 * English corpus.
 *
 * This guard fails LOUD on any Cyrillic codepoint reaching the helper
 * — programmer-error, not user-facing. No log redaction, no INSERT.
 * The DB transaction rolls back via `recordAudit`'s normal throw path
 * (caller's withTenant tx aborts).
 *
 * Coverage:
 *   - Cyrillic block (U+0400..U+04FF)
 *   - Cyrillic Supplement (U+0500..U+052F)
 *   - Cyrillic Extended-A (U+2DE0..U+2DFF)
 *   - Cyrillic Extended-B (U+A640..U+A69F)
 * Built only from \u escapes so this file remains ASCII-clean and the
 * tools/lint-english.ts scanner does not self-flag.
 */
// Ranges (\u escapes only — keeps this source ASCII-clean for
// tools/lint-english.ts):
//   U+0400..U+04FF Cyrillic
//   U+0500..U+052F Cyrillic Supplement
//   U+2DE0..U+2DFF Cyrillic Extended-A
//   U+A640..U+A69F Cyrillic Extended-B
const CYRILLIC_RE = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]/;

export class AuditCyrillicError extends Error {
  override name = "AuditCyrillicError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Recursively scan a value for Cyrillic codepoints. Only string leaf
 * values are scanned — numbers/booleans/null pass through. Plain objects
 * and arrays are walked; cycles are bounded by `maxDepth` to defend
 * against pathological inputs. Throws `AuditCyrillicError` on first hit.
 *
 * The `path` accumulator gives the programmer a precise pointer to the
 * offending key (e.g. `payload.reason`, `payload.nested.deep.value`).
 */
function assertEnglishOnly(value: unknown, path: string, maxDepth = 16): void {
  if (maxDepth < 0) return;
  if (typeof value === "string") {
    if (CYRILLIC_RE.test(value)) {
      throw new AuditCyrillicError(
        `audit payload contains Cyrillic codepoints at ${path} (T-10-01 / CLAUDE.md english-only rule)`,
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertEnglishOnly(value[i], `${path}[${i}]`, maxDepth - 1);
    }
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertEnglishOnly(v, `${path}.${k}`, maxDepth - 1);
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
/**
 * Quick 260602-fda (blocker #1 / option A) — operator kill-switch. When
 * `AUDIT_LOG_DISABLED` is `"1"` or `"true"` (case-insensitive), `recordAudit`
 * is a no-op: no validation, no INSERT. This lets an operator run on a
 * managed Postgres that does not need an audit trail at all (and frees them
 * from the fail-closed in-transaction INSERT that would otherwise block
 * `auth.signin` if the audit_log partition were unavailable). Default OFF —
 * audit stays fail-closed. Read directly from `process.env` like the existing
 * `AUDIT_REDACT_IP` operator knob (not a NODE_ENV branch — LOCKER-01 unaffected).
 */
function auditDisabled(): boolean {
  const raw = process.env.AUDIT_LOG_DISABLED;
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

export async function recordAudit<A extends AuditAction>(
  tx: ExecutableTx,
  ctx: AuditCtx,
  action: A,
  payload: AuditPayload<A>,
): Promise<void> {
  // Operator kill-switch: skip entirely (no validation, no INSERT).
  if (auditDisabled()) return;

  // Validate ctx (uuid + ip + ua shape).
  ctxSchema.parse(ctx);

  // Validate the per-action payload (compile-time-checked schema map).
  const schema = auditPayloadSchemas[action] as z.ZodTypeAny;
  const validated = schema.parse(payload) as Record<string, unknown>;

  // Forbidden-key sweep on the CALLER-supplied payload — `.parse()`
  // strips unknown keys for the declared schema, but we want to reject
  // (not silently drop) so a programmer mistake fails loudly. Run the
  // sweep over the raw input.
  rejectForbidden(payload as Record<string, unknown>, action);

  // Phase 10 / Plan 10-01d — Cyrillic guard (T-10-01). Scans BOTH the
  // caller-supplied payload AND the ctx user_agent because both flow
  // into the JSONB row. Fails LOUD before the INSERT — no log, no row.
  assertEnglishOnly(payload, "payload");
  assertEnglishOnly(ctx.user_agent, "ctx.user_agent");

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
