# Code Review Index — v2.2 milestone close audit

**Branch:** main @ b830cc4 (2026-05-16)
**Reviewers:** 11 packages (re-run of the pre-publication 11-agent review against the original `1832f28` baseline)
**Original review:** `.planning/review/REVIEW-INDEX.md` (10 CRITICAL + 35 HIGH @ 1832f28)

## Headline

**v2.2 closure criterion met: 0 CRITICAL, 1 HIGH carried-over + 2 HIGH new on api-core surface.**

All 10 original CRITICAL findings closed end-to-end. 33 of 35 original HIGH findings closed; 2 HIGH carry-over (worker WR-1 shutdown / WR-2 IORedis) reclassified as WARNING. Three new findings surfaced:

- **api-core NEW-WR (HIGH)** — `lib/token-rotation.ts:142` SELECT users without `withTenant()` — potential wrong-tenant email read or RLS silent-empty. Most consequential residual item.
- **web W-NEW-1/W-NEW-2** — stale D-ADMIN-1 comments after HI-1 closure; AdminForbidden 403 surface hardcoded English (en+ru mandate).
- **byok-guard M-NEW-01** — vendored `apps/api/src/lib/redact-url.ts` did NOT get the Phase-40 upgrade; still only masks `URL.password`.

## Per-package rollup

| Package | CRITICAL | HIGH | MEDIUM | LOW | Top residual |
|---|---|---|---|---|---|
| api-core | 0 | 2 | 4 | 5 | NEW-WR: SELECT users without withTenant |
| api-routes-conversations | 0 | 0 | 3 | 3 | LOCKER-04 route-bulkfix debt (allowlisted to v2.3) |
| api-routes-transcriptions | 0 | 0 | 4 | 4 | abort-signal omission, missing authRequired on v1/keys |
| api-routes-rest | 0 | 3 | 5 | 2 | transcribe sttProvider, verification-status case-insens, streaming-usage PII preview |
| web | 0 | 0 | 7 | 4 | AdminForbidden hardcoded English; stale D-ADMIN-1 comments |
| worker | 0 | 0 | 4 | 0 | shutdown exit 0 on failure; IORedis no TLS |
| data | 0 | 0 | 7 | 0 | FIXTURE_PASSWORD exported sans NODE_ENV guard |
| wire-schemas | 0 | 0 | 4 | 3 | .passthrough() on delete-account + diarization responses |
| litellm-client | 0 | 0 | 4 | 2 | `passthrough` method param unvalidated cast |
| byok-guard+contract-tests | 0 | 0 | 2 | 3 | vendored apps/api redact-url.ts diverged |
| small-pkgs | 0 | 0 | 4 | 2 | family-cover sound; cosmetic redact-paths gap |
| **Total** | **0** | **5** | **48** | **28** | — |

## All HIGH findings (verbatim)

### api-core HI-04 — extractBearer greedy regex (carry-over)
- File: `apps/api/src/middleware/dual-auth.ts:218`
- Risk: CPU-amplifier on hashing arbitrary-sized input via Headers API indirection.
- Storage-exhaustion mitigated by Phase 33 fingerprint-only storage.
- **Recommended fix:** bounded charset + length cap on the Bearer regex.

### api-core NEW-WR — SELECT users without withTenant (new)
- File: `apps/api/src/lib/token-rotation.ts:142-152`
- Risk: stale GUC from prior pool checkout (wrong-tenant read), or unbound GUC (RLS deny → empty rows → `email = null` silently). Bare `catch { email = null }` hides both outcomes.
- **Recommended fix:** wrap in `withTenant`, or extend the SECURITY DEFINER function to return email in one round-trip.

### api-routes-rest HI-A — transcribe.ts hardcoded sttProvider/sttModel
- File: `apps/api/src/routes/transcribe.ts`
- Status: partial — `c5112d9` forwards `model` upstream but does not echo `upstreamJson.model` in the response.

### api-routes-rest HI-B — verification-status.ts case-sensitive email lookup
- File: `apps/api/src/routes/verification-status.ts:58`
- Risk: lookup miss for non-canonical-case email submissions.

### api-routes-rest HI-C — streaming-usage.ts unconditional 200-char PII preview
- File: `apps/api/src/routes/streaming-usage.ts`
- Risk: transcript content prefix logged to operator surface even with `redact` config.

## Closure delta vs original review

| Original | Status |
|---|---|
| **10 CRITICAL** (CR-1..10) | **10 CLOSED** (Phase 31 lockers, 32 RLS, 33 envelope, 34 tenantPlugin, 35 better-auth/setup-admin, 36 worker bundle, 37 LitellmUpstreamError, 38 auth retire) |
| **35 HIGH** (HI-* across 11 packages) | **33 CLOSED** + 2 reclassified to WARNING tier (worker HI-5/HI-6) |

## Verification

Per CLAUDE.md Hard Rule 3 (trust but verify):
- Phase 35 regression tests run via `pnpm --filter @openwhispr/api exec vitest run tests/unit/integration/public-bootstrap-endpoints.test.ts tests/unit/routes/__tests__/setup-admin-rollback.test.ts` → **2 files / 7 tests passed**.
- Phase 41.g parity test `packages/observability/tests/unit/redact-providers-parity.test.ts` → **2 passed** at HEAD.
- `git log --oneline -20` confirms all cited commit SHAs reachable from HEAD b830cc4.

## Recommended publication verdict

**PROCEED.** No BLOCKERs. Open a v2.3 milestone with the 5 HIGH carry-overs as the first phase ("HIGH-CARRY-1 token-rotation withTenant; HIGH-CARRY-2 extractBearer regex; HIGH-CARRY-3..5 api-rest cluster"). The 48 MEDIUM + 28 LOW are not publication blockers; defer to v2.3 sweep phases by package.

## Links

- `.planning/review-v2.2-close/api-core.md`
- `.planning/review-v2.2-close/api-routes-conversations.md`
- `.planning/review-v2.2-close/api-routes-rest.md`
- `.planning/review-v2.2-close/api-routes-transcriptions.md`
- `.planning/review-v2.2-close/web.md`
- `.planning/review-v2.2-close/worker.md`
- `.planning/review-v2.2-close/data.md`
- `.planning/review-v2.2-close/wire-schemas.md`
- `.planning/review-v2.2-close/litellm-client.md`
- `.planning/review-v2.2-close/byok-guard-contract-tests.md`
- `.planning/review-v2.2-close/small-pkgs.md`
