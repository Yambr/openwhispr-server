// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11b — REVIEW web HIGH HI-03 closure.
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-06 closure.
//
// Single source of truth for the API base URL used by RSC pages and
// server actions to reach `apps/api` over the internal docker network.
// Before this module, seven call sites duplicated the same helper —
// an env-var rename in one would have silently desynced.
//
// Contract:
//   - Reads `process.env.INTERNAL_API_URL`. docker-compose sets it to the
//     in-network service URL; the Helm chart sets it to the in-cluster
//     service URL. Both supported deploy paths ALWAYS set it.
//   - HI-06: the helper is FAIL-CLOSED — it throws when the var is unset
//     or empty rather than falling back to a hardcoded host:port literal.
//     The previous hardcoded `http://api:<port>` default put a port
//     literal on the LOCKER-03-scanned surface; fail-closing removes the
//     literal entirely. Operators MUST set `INTERNAL_API_URL` — which
//     every supported deploy path already does — so there is no real cost.
//
// MUST be imported wherever the previous duplicated helper lived —
// pinned by `tests/unit/internal-api-url-dedup.test.ts`.

/**
 * Resolve the internal API base URL from `INTERNAL_API_URL`.
 *
 * @throws if `INTERNAL_API_URL` is unset or empty (fail-closed — HI-06).
 */
export function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  if (!raw || raw.length === 0) {
    throw new Error(
      "INTERNAL_API_URL is not set. It must be configured by the deploy " +
        "environment (docker-compose / Helm chart) to the internal apps/api URL.",
    );
  }
  return raw;
}
