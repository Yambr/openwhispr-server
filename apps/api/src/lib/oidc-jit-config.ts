// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 1 — JIT SSO config loader.
//
// `readJitConfig(env)` reads the 7 OIDC JIT env vars (SPEC-ldap-keycloak.md
// §"Env vars") and returns a `JitConfig` — or `null` when JIT is disabled
// (OIDC_TENANT_CLAIM unset). It mirrors the exact env-defaulted shape of
// lib/oidc-providers.ts (`env = DEFAULT_ENV`, a `present()` guard, an early
// `return null` when the gate var is absent) so unit tests inject a stub env
// without mutating the global.
//
// The two MAPPING vars (OIDC_TENANT_MAPPING / OIDC_ROLE_MAPPING) are NOT parsed
// here. Their JSON.parse + zod validation is delegated to `validateJitBoot()`
// (config/oidc-jit-boot.ts) — keeping the loud-fail parse co-located with the
// other boot validators and ensuring it runs exactly once. This loader receives
// the already-parsed objects.
//
// Scalar env reads from lib/ are an established, LOCKER-01-compliant precedent
// (lib/oidc-providers.ts reads process.env directly). LOCKER-01 restricts only
// NODE_ENV branching — there is no NODE_ENV branch in this module.

import { type JitBootMappings, validateJitBoot } from "../config/oidc-jit-boot.js";

const DEFAULT_ENV: NodeJS.ProcessEnv = process.env;

/** Resolved role assigned to a JIT-provisioned user. */
export type JitRole = "admin" | "member" | "viewer";

/** Behaviour on a returning user whose admin group was revoked. */
export type RevocationMode = string;

/**
 * The validated JIT configuration consumed by `resolveJitDecision`. Built from
 * the 7 OIDC_* env vars; the two mapping fields arrive already-parsed from
 * `validateJitBoot`.
 */
export interface JitConfig {
  /** `"email_domain"` or a claim name carrying the tenant key. */
  readonly tenantClaim: string;
  /** Parsed OIDC_TENANT_MAPPING: claim-value → tenant-id. */
  readonly tenantMapping?: Record<string, string>;
  /** id_token claim name carrying the group-membership array. Default `groups`. */
  readonly groupClaim: string;
  /** Parsed OIDC_ROLE_MAPPING: group-name → role. */
  readonly roleMapping?: Record<string, JitRole>;
  /** Tie-break order, highest priority first. Default `["admin","member","viewer"]`. */
  readonly rolePriority: readonly string[];
  /** Role assigned when no group matches. `null` rejects sign-in. Default `null`. */
  readonly defaultRole: string | null;
  /** Behaviour on revoked admin. Default `"downgrade_to_default"`. */
  readonly revocationMode: RevocationMode;
}

const DEFAULT_GROUP_CLAIM = "groups";
const DEFAULT_ROLE_PRIORITY: readonly string[] = ["admin", "member", "viewer"];
const DEFAULT_REVOCATION_MODE = "downgrade_to_default";

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Read the JIT SSO config from `env`, or `null` when JIT is disabled.
 *
 * JIT silently disables when `OIDC_TENANT_CLAIM` is unset (mirrors
 * oidc-providers' `if (!oidcConfigured(env)) return []` early-out).
 *
 * @param env Environment snapshot. Defaults to `process.env`; tests inject a stub.
 */
export function readJitConfig(env: NodeJS.ProcessEnv = DEFAULT_ENV): JitConfig | null {
  if (!present(env.OIDC_TENANT_CLAIM)) {
    return null;
  }

  // Delegate the JSON.parse + zod validation of the mapping vars to the boot
  // validator (single loud-fail site). On malformed JSON in production this
  // exits 78 before we get here.
  const mappings: JitBootMappings = validateJitBoot(env);

  return {
    tenantClaim: env.OIDC_TENANT_CLAIM,
    // Conditional spread: under exactOptionalPropertyTypes an optional prop must be
    // omitted entirely rather than assigned an explicit `undefined`.
    ...(mappings.tenantMapping !== undefined ? { tenantMapping: mappings.tenantMapping } : {}),
    groupClaim: present(env.OIDC_GROUP_CLAIM) ? env.OIDC_GROUP_CLAIM : DEFAULT_GROUP_CLAIM,
    ...(mappings.roleMapping !== undefined ? { roleMapping: mappings.roleMapping } : {}),
    rolePriority: parseRolePriority(env.OIDC_ROLE_PRIORITY),
    defaultRole: parseDefaultRole(env.OIDC_DEFAULT_ROLE),
    revocationMode: present(env.OIDC_REVOCATION_MODE)
      ? env.OIDC_REVOCATION_MODE
      : DEFAULT_REVOCATION_MODE,
  };
}

function parseRolePriority(raw: string | undefined): readonly string[] {
  if (!present(raw)) {
    return DEFAULT_ROLE_PRIORITY;
  }
  return raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseDefaultRole(raw: string | undefined): string | null {
  if (!present(raw) || raw === "null") {
    return null;
  }
  return raw;
}
