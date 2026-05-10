---
phase: 03-litellm-integration-bundled-oss-models
fixed_at: 2026-05-10T19:51:00Z
review_path: .planning/phases/03-litellm-integration-bundled-oss-models/03-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-05-10T19:51:00Z
**Source review:** `.planning/phases/03-litellm-integration-bundled-oss-models/03-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical + 5 Warning; Info findings excluded by `fix_scope=critical_warning`)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: `/v1/audio/diarization` is never registered in the production entrypoint (Valkey client never wired)

**Files modified:**
- `apps/api/src/index.ts`
- `apps/api/src/__tests__/build-app-diarization-wiring.test.ts` (new)

**Commit:** `65d2401`

**Applied fix:**
- Added `redis?: RedisLike` and `mockDiarization?: boolean` to `BuildAppOptions`.
- `buildApp` forwards both options into `buildAllRoutes` deps so the diarization route's existing `deps.redis` gate fires correctly when an operator wires VALKEY_URL.
- Production bootstrap constructs a `@redis/client` client from `process.env.VALKEY_URL` (with optional `VALKEY_PASSWORD`), `await client.connect()`s it, and threads it through. When VALKEY_URL is unset, leaves `redis` undefined and emits a one-line operator-actionable warning — the centralized notFoundHandler then returns the canonical 404 envelope on /v1/audio/diarization (distinct from a 503 on a registered-but-dead route).
- New test file `build-app-diarization-wiring.test.ts` asserts:
  1. `/v1/audio/diarization` appears in the route tree when redis is supplied.
  2. The route is absent when redis is omitted.
  3. `mockDiarization` opt threads through (route still registered).

### WR-01: `idempotency-cache.bindJobId` rescue path drops `bodyHash`, breaking conflict detection on legitimate retries

**Files modified:**
- `apps/api/src/lib/idempotency-cache.ts`
- `apps/api/src/lib/__tests__/idempotency-cache.test.ts`
- `apps/api/src/routes/diarization.ts`

**Commit:** `4d95ff8`

**Applied fix:**
- Added required `bodyHash: string` parameter to `IdempotencyCache.bindJobId`.
- Both rescue branches (expired key + corrupt JSON) now persist the real fingerprint instead of `bodyHash: "unknown"`.
- Diarization route passes the body fingerprint it already computed.
- New test asserts that a post-rescue retry returns `state='hit'` (no spurious 409).

### WR-02: `bindJobId` is non-atomic (GET + parse + SET) — concurrent binds can clobber each other

**Files modified:**
- `apps/api/src/lib/idempotency-cache.ts`
- `apps/api/src/lib/__tests__/idempotency-cache.test.ts`

**Commit:** `4dc57a3`

**Applied fix:**
- Introduced sibling key `diar:idem:<key>:jobid` written with `SET NX EX` to provide true atomic first-writer-wins semantics for jobId binding under concurrent submitters.
- `lookupOrReserve` reads the sibling key first; falls back to legacy inline `entry.jobId` for entries written by older builds during the 24h TTL deploy overlap window.
- Test asserts: concurrent `Promise.all` binds converge on a single jobId (no clobber, no interleaved value).

### WR-03: WSS `upstreamWs` scheme replace loses original case for `HTTPS://` baseUrls

**Files modified:**
- `apps/api/src/routes/realtime.ts`
- `apps/api/src/routes/realtime.test.ts`

**Commit:** `ee2bb14`

**Applied fix:**
- Extracted `httpToWsScheme()` and rewrote as two narrow case-insensitive replaces (`/^https:/i → wss:`, then `/^http:/i → ws:`). The previous one-shot regex `replace(/^http(s?):/i, "ws$1:")` produced `wsS://` for uppercase `HTTPS://` inputs because the `$1` capture preserved the uppercase `S`.
- Unit tests cover lowercase `http://` / `https://`, all-caps `HTTP://` / `HTTPS://`, and mixed-case `Https://`.

### WR-04: `pyannote-client.classify` leaks upstream body fragment into Error.message

**Files modified:**
- `apps/api/src/lib/pyannote-client.ts`
- `apps/api/src/lib/__tests__/pyannote-client.test.ts`

**Commit:** `66e2eed`

**Applied fix:**
- Mirrored the `LitellmUpstreamError` pattern: `PyannoteBadRequestError.message` and `PyannoteUpstreamError.message` are now generic (`"pyannote <status>"`); the truncated upstream body is parked on a separate `bodyText` field.
- All call sites in `classify()` and `uploadToPresignedUrl()` updated to construct errors with `bodyText` rather than embedding it in `.message`.
- Two new tests assert `.message` does NOT contain the leaky body fragment and `.bodyText` does.

### WR-05: `index.ts:204` minimal-mode `tryPrev` synthesizes `email: ""` for previous-token user

**Files modified:**
- `apps/api/src/lib/token-rotation.ts`
- `apps/api/src/lib/token-rotation.test.ts`
- `apps/api/src/index.ts`

**Commit:** `27c58b3`

**Applied fix:**
- `tryPreviousToken` now executes a follow-up `SELECT email FROM users WHERE id = <userId>` after the SECURITY DEFINER lookup resolves the tenant, returning `email: string | null` on `PreviousTokenMatch`.
- The follow-up query is wrapped in try/catch so RLS denial or row-deletion mid-rotation surfaces `email: null` (NOT a thrown error that would block the existing 5-minute overlap admission).
- `buildApp`'s minimal-mode adapter surfaces `"<previous-token-no-email>"` when email is null — an obviously synthetic sentinel so downstream consumers (audit logs, ledger metadata) fail loud on accidental dependence rather than seeing a silent empty string.
- Updated existing test to assert email field; added two new tests for `email: null` paths (missing user row + query throws).

## Notes

- **All commits used `git commit --no-verify`** because the project's lefthook `english` hook is broken locally (`pnpm install` aborts with a `core.hooksPath` conflict). Bypassing was authorized by the orchestrator instructions.
- **5 pre-existing test failures** were observed in the full API test suite (`litellm-spike-request-id.test.ts` missing audio fixture; `scripts/check-default-secrets.test.ts` exit-code expectations) — verified to exist on the pre-fix HEAD via `git stash`. Not caused by these fixes; out of scope for this iteration.
- **TypeScript pre-existing errors** in `apps/api/src/routes/realtime.test.ts` and `apps/api/src/routes/realtime.ts` (missing `@types/node` declarations for `@fastify/http-proxy`'s `wsClientOptions` overload, and `exactOptionalPropertyTypes` violations in `realtime.test.ts` and `test-only.test.ts`) — verified pre-existing, not introduced by this iteration.
- **Test count increase:** 369 passing → 380 passing (+11 new tests across the 6 fixes).
- **Info findings (IN-01..IN-04) intentionally excluded** per `fix_scope=critical_warning`. They remain documented in REVIEW.md for a future iteration.

---

_Fixed: 2026-05-10T19:51:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
