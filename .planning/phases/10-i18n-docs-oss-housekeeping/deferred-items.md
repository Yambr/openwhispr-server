# Phase 10 — Deferred / Pre-existing Issues

Found during execution of 10-01a (and earlier sub-phases); NOT caused by Plan 10-01a edits.

## apps/api pre-existing test failures (baseline-confirmed via `git stash`)

1. **scripts/check-default-secrets.test.ts** (4 tests) — `ERR_MODULE_NOT_FOUND`
   for `apps/api/apps/api/scripts/check-default-secrets.ts` (path doubling).
   CWD assumption bug in the test harness; same failure on a clean checkout.

2. **src/routes/tokens/__tests__/rate-limit-isolation.integration.test.ts**
   `T3: unauthenticated requests 401 BEFORE the rate-limit hook fires` —
   Valkey bucket key `owrl:ip:127.0.0.1` is now created on unauth requests.
   Same failure on baseline (stashed) checkout.

3. **Conversations / folders / notes / transcriptions / streaming-usage / usage
   integration tests** — Postgres connection-terminated errors during
   testcontainer teardown. Baseline-confirmed.

These should be fixed in a dedicated tech-debt plan; out of scope for 10-01a.

## 10-01b — additional pre-existing items (baseline-confirmed)

4. **packages/contract-tests/src/transcriptions.test.ts** — parse error
   `await is only allowed within async functions` at line 188:40
   (`expect(() => Envelope.parse(await res.json()))` uses `await` inside
   a non-async arrow). Baseline-confirmed via `git stash` on 2026-05-13.
   Out of scope for 10-01b (worker-only plan).

5. **apps/worker/src/lib/typed-queue.ts + with-tenant-context.ts** —
   pre-existing TypeScript errors (Promise-of-Promise return-type mismatch
   in scheduler shim; `unknown` -> `string` widening in AsyncLocalStorage
   store). Baseline-confirmed via `git stash` on 2026-05-13. Worker test
   suite is green; only `tsc --noEmit` flags these.
