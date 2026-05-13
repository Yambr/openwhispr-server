// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 01 / Task 3 — resolve the seeded "default" tenant UUID.
//
// Phase 1 seeded a single `default` tenant with a stable UUID
// (00000000-0000-0000-0000-000000000000) in 0000_initial.sql. Phase 2's
// pre-auth flows (sign-up, OAuth callback) hard-pin to this tenant since
// multi-tenant signup is a Phase 5/6 concern.
//
// We look up by the stable seeded UUID rather than by name, because:
//   1. The migration uses ON CONFLICT (id) DO NOTHING; the UUID is the
//      authoritative identifier.
//   2. There is no `slug` column on the tenants table today; querying
//      by `name='default'` would couple tightly to a presentation field
//      that operators may want to relabel.
//
// The result is memoised after the first call. If a future plan replaces
// the stable-UUID seeding with random UUIDs we can swap to a real DB
// lookup here without changing any caller.
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let cached: string | undefined;

/**
 * Returns the UUID of the default tenant. Memoised after first call.
 *
 * Currently a synchronous constant return because Phase 1 seeds the row
 * with a stable UUID. The signature is kept Promise-returning so that
 * future plans can swap to a real DB lookup without breaking callers.
 */
export async function resolveDefaultTenantId(): Promise<string> {
  if (cached) return cached;
  cached = DEFAULT_TENANT_ID;
  return cached;
}

// Test-only escape hatch: lets the smoke tests reset the memoised value
// between describe blocks without exporting the cache directly.
export function _resetDefaultTenantCacheForTesting(): void {
  cached = undefined;
}
