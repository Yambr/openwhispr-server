# Phase 41.c — DEFERRED items

## D-c-1 — Loading-state e2e specs lose their SSR-prefetch bypass

**What changed:** Phase 41.c (HI-2) removed the
`PLAYWRIGHT_DISABLE_SSR_PREFETCH` runtime env branch from five RSC
pages. RSC `queryClient.prefetchQuery` now runs unconditionally in
every environment, including the e2e test stack. Pre-existing
Playwright loading-state specs that relied on the env-var to keep SSR
prefetch off can no longer assert their loading branch reliably — the
SSR-side fetch hits real apps/api, the dehydrated cache wins the
race, and the Client `useQuery` resolves synchronously from the
hydrated cache without ever issuing a browser-side request that
`page.route()` could stall.

**Affected specs (loading-state branches; success/error/empty
branches still work via real-data + `page.route()`-error patterns):**

- `apps/web/tests/e2e/u4-usage.spec.ts` — `"loading state — Skeleton cards while usage endpoint is stalled"`
- `apps/web/tests/e2e/u6-trx-list.spec.ts` — loading branch
- `apps/web/tests/e2e/u8-notes-list.spec.ts` — loading branch
- `apps/web/tests/e2e/u11-conv-list.spec.ts` — loading branch
- `apps/web/tests/e2e/u12-conv-detail.spec.ts` — loading branch

**Why deferred (not fixed in 41.c):** the proper fix (review-cited
"Playwright fixtures that mock at the apps/api boundary") requires
either (a) a shadow apps/api container the e2e stack can route
through when a `mock-mode` flag is set on the Traefik label, or (b) a
substantial RSC refactor to `<Suspense>` + `useSuspenseQuery` so the
network boundary moves to the client where `page.route()` can
intercept. Both are larger than 41.c's residual-sweep scope and
deserve their own phase.

**Current CI posture:** prior CI runs of the affected specs may have
already been silently broken (`.env.full.example` default for
`PLAYWRIGHT_DISABLE_SSR_PREFETCH` was empty; CI workflows did NOT
export the var, so the env branch was never taken). 41.c removes
ambiguity; the test-side migration is the remaining work.

**Suggested resolution phase:** insert a "Phase 41.h — Playwright
SSR-prefetch e2e migration" or roll into the next pre-OSS hardening
phase. Estimated work: ~1d to add a `apps/api` mock-mode flag +
`page.route()` re-pointing, or ~2-3d for the Suspense refactor across
five RSC + five Client components.

## D-c-2 — Local `.env` `PLAYWRIGHT_DISABLE_SSR_PREFETCH=1` becomes a no-op

**Action required (none, informational):** developers who currently
have `PLAYWRIGHT_DISABLE_SSR_PREFETCH=1` in their local `.env` will
see no change in production code behaviour after this phase — the
var is no longer read by any production source. The compose service
declarations were also removed in 41.c so the var no longer
propagates into the `web` container even at runtime.

Developers running the loading-state e2e specs locally will hit the
same race the CI runs already had. Document in
`docs/conventions.md` (out-of-scope edit for 41.c) when D-c-1
resolution lands.
