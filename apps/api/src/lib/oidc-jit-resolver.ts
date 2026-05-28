// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 2 — pure JIT claim → {tenantId, role} resolver.
//
// `resolveJitDecision(claims, cfg, existing?)` is the SINGLE source of truth for
// the JIT decision tree (D-69-1, Option C). It is PURE: no env read, no DB, no
// Better Auth import, no I/O. Two thin call-sites in later waves delegate to it:
//   * Web: genericOAuth's mapProfileToUser seam.
//   * Desktop: a pre-createOAuthUser projection in mint-bearer.ts.
//
// It returns a discriminated union (never throws on bad claims — a structurally
// broken profile is reported as `invalid_oidc_profile`), mirroring oidc-providers
// returning values not exceptions. The audit/log layer branches on the union.
//
// Decision tree (SPEC-ldap-keycloak.md:78-104 worked example, :137-145 failures):
//   1. Resolve the tenant key (email_domain → email domain; named-claim → claim).
//      Missing → forbidden_missing_tenant_claim. Malformed → invalid_oidc_profile.
//   2. Map the tenant key through cfg.tenantMapping. Not found → forbidden_unknown_tenant.
//   3. existing.tenantId !== resolved tenantId → forbidden_tenant_mismatch (mode 6).
//   4. Collect groups; map each through cfg.roleMapping; tie-break by cfg.rolePriority.
//   5. No match: defaultRole===null → forbidden_no_role_mapping; else role = defaultRole.
//   6. Returning admin downgraded by revocation → downgraded:true (mode 5).

import type { JitConfig, JitRole } from "./oidc-jit-config.js";

/** The 5 typed rejection codes (the decision-tree leaves that deny sign-in). */
export type RejectionCode =
  | "forbidden_missing_tenant_claim"
  | "forbidden_unknown_tenant"
  | "forbidden_no_role_mapping"
  | "forbidden_tenant_mismatch"
  | "invalid_oidc_profile";

/** Discriminated-union result of the JIT decision tree. */
export type JitDecision =
  | { ok: true; tenantId: string; role: JitRole; downgraded?: boolean }
  | { ok: false; code: RejectionCode };

/** The prior persisted identity of a returning user (re-sync + mismatch checks). */
export interface ExistingIdentity {
  readonly tenantId: string;
  readonly role: string;
}

const EMAIL_DOMAIN_MODE = "email_domain";

/**
 * Resolve an OIDC claim set to a tenant + role decision, or a typed rejection.
 *
 * Pure: no env read, no DB, no I/O. Reusable by both the web and desktop seams.
 *
 * @param claims The id_token / userinfo claim bag (untyped — coerced defensively).
 * @param cfg The validated JIT config (env arrives here, not via process.env).
 * @param existing Prior identity of a returning user; enables mode 5 + mode 6.
 */
export function resolveJitDecision(
  claims: Record<string, unknown>,
  cfg: JitConfig,
  existing?: ExistingIdentity,
): JitDecision {
  const record = asRecord(claims);
  if (record === undefined) {
    return { ok: false, code: "invalid_oidc_profile" };
  }

  // (1) Resolve the tenant key.
  const tenantKey = resolveTenantKey(record, cfg);
  if (tenantKey.kind === "invalid") {
    return { ok: false, code: "invalid_oidc_profile" };
  }
  if (tenantKey.kind === "missing") {
    return { ok: false, code: "forbidden_missing_tenant_claim" };
  }

  // (2) Map the tenant key through tenantMapping.
  const tenantId = cfg.tenantMapping?.[tenantKey.value];
  if (tenantId === undefined) {
    return { ok: false, code: "forbidden_unknown_tenant" };
  }

  // (3) Returning user whose tenant claim changed → reject (RLS invariant, mode 6).
  if (existing !== undefined && existing.tenantId !== tenantId) {
    return { ok: false, code: "forbidden_tenant_mismatch" };
  }

  // (4) Collect groups and map to roles.
  const groupsRaw = record[cfg.groupClaim];
  if (groupsRaw !== undefined && asStringArray(groupsRaw) === undefined) {
    // groupClaim present but not a string[] → structurally broken profile.
    return { ok: false, code: "invalid_oidc_profile" };
  }
  const groups = asStringArray(groupsRaw) ?? [];
  const matchedRoles = matchRoles(groups, cfg.roleMapping);

  // (5) Pick the resolved role (tie-break via rolePriority) or fall back to default.
  if (matchedRoles.length > 0) {
    const role = highestPriorityRole(matchedRoles, cfg.rolePriority);
    return finalize(tenantId, role, existing);
  }

  if (cfg.defaultRole === null) {
    return { ok: false, code: "forbidden_no_role_mapping" };
  }
  const defaultRole = asJitRole(cfg.defaultRole);
  if (defaultRole === undefined) {
    // An OIDC_DEFAULT_ROLE outside admin|member|viewer is an operator config
    // error; treat the profile as unmappable rather than minting a bogus role.
    return { ok: false, code: "forbidden_no_role_mapping" };
  }
  return finalize(tenantId, defaultRole, existing);
}

const VALID_ROLES: readonly JitRole[] = ["admin", "member", "viewer"];

function asJitRole(value: string): JitRole | undefined {
  return VALID_ROLES.find((role) => role === value);
}

type TenantKey = { kind: "ok"; value: string } | { kind: "missing" } | { kind: "invalid" };

function resolveTenantKey(claims: Record<string, unknown>, cfg: JitConfig): TenantKey {
  if (cfg.tenantClaim === EMAIL_DOMAIN_MODE) {
    const email = claims.email;
    if (email === undefined || email === null) {
      return { kind: "missing" };
    }
    if (typeof email !== "string") {
      return { kind: "invalid" };
    }
    const at = email.lastIndexOf("@");
    if (at < 0 || at === email.length - 1) {
      // No "@", or "@" is the trailing char → not a usable email.
      return { kind: "invalid" };
    }
    return { kind: "ok", value: email.slice(at + 1) };
  }

  const raw = claims[cfg.tenantClaim];
  if (raw === undefined || raw === null) {
    return { kind: "missing" };
  }
  if (typeof raw !== "string") {
    return { kind: "invalid" };
  }
  return { kind: "ok", value: raw };
}

function matchRoles(
  groups: readonly string[],
  roleMapping: Record<string, JitRole> | undefined,
): JitRole[] {
  if (roleMapping === undefined) {
    return [];
  }
  const out: JitRole[] = [];
  for (const group of groups) {
    const role = roleMapping[group];
    if (role !== undefined) {
      out.push(role);
    }
  }
  return out;
}

function highestPriorityRole(roles: readonly JitRole[], priority: readonly string[]): JitRole {
  let best = roles[0];
  let bestRank = rankOf(best, priority);
  for (const role of roles.slice(1)) {
    const rank = rankOf(role, priority);
    if (rank < bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best;
}

function rankOf(role: JitRole, priority: readonly string[]): number {
  const idx = priority.indexOf(role);
  // Roles absent from the priority list rank lowest (after every listed role).
  return idx < 0 ? priority.length : idx;
}

function finalize(tenantId: string, role: JitRole, existing?: ExistingIdentity): JitDecision {
  if (existing !== undefined && existing.role === "admin" && role !== "admin") {
    // Returning admin whose admin group was revoked → downgraded (mode 5).
    return { ok: true, tenantId, role, downgraded: true };
  }
  return { ok: true, tenantId, role };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as readonly string[];
  }
  return undefined;
}
