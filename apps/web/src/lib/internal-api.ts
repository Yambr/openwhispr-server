// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11b — REVIEW web HIGH HI-03 closure.
//
// Single source of truth for the API base URL used by RSC pages and
// server actions to reach `apps/api` over the internal docker network.
// Before this module, seven call sites duplicated the same helper —
// an env-var rename in one would have silently desynced.
//
// Contract:
//   - Reads `process.env.INTERNAL_API_URL` (set by docker-compose to
//     `http://api:3000` and by the Helm chart to the in-cluster
//     service URL).
//   - Falls back to `http://api:3000` ONLY when the var is unset OR
//     empty — preserves backward compatibility with the legacy
//     duplicated helper. Operators wiring a hostile env value
//     (e.g. an external URL) bear responsibility; defence-in-depth
//     URL-shape validation is deferred to Plan 51-18 (LOW).
//
// MUST be imported wherever the previous duplicated helper lived —
// pinned by `tests/unit/internal-api-url-dedup.test.ts`.

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

export function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}
