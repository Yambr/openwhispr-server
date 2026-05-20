---
phase: 65-high-findings-api-routes-transcriptions
plan: 01
subsystem: apps/api routes — transcriptions/tokens/agent/realtime/diarization/streaming
tags: [security, error-shape, robustness, high-findings, tdd]
requires: []
provides:
  - "WR-01..WR-11 closed (10 fixed RED→GREEN, 1 already-closed + guard)"
affects:
  - apps/api/src/routes/tokens/openai-realtime.ts
  - apps/api/src/routes/agent/web-search.ts
  - apps/api/src/lib/web-search/{types,tavily-adapter,yandex-adapter}.ts
  - apps/api/src/routes/diarization.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/src/routes/agent/stream.ts
  - apps/api/src/routes/transcriptions/{batch-delete,list}.ts
  - apps/api/src/routes/streaming-usage.ts
tech-stack:
  added: []
  patterns:
    - "withTypeProvider<ZodTypeProvider>() for typed + validated req.body (drops redundant inline parse)"
    - "crypto.randomBytes for multipart boundary nonce"
    - "constant-time failure-path floor against timing oracles"
key-files:
  created:
    - apps/api/tests/unit/routes/tokens/__tests__/openai-realtime-upstream-echo.test.ts
    - apps/api/tests/unit/routes/agent/web-search-envvar-label.test.ts
    - apps/api/tests/unit/routes/diarization/wr-06-boundary-nonce.test.ts
    - apps/api/tests/unit/routes/diarization/wr-08-error-envelope.test.ts
    - apps/api/tests/unit/routes/realtime/wr-03-auth-error-code.test.ts
    - apps/api/tests/unit/routes/realtime/wr-09-raw-url-mutation.test.ts
    - apps/api/tests/unit/routes/agent/stream-wr-03-04.test.ts
    - apps/api/tests/unit/routes/transcriptions/batch-delete-wr-07-timing.test.ts
    - apps/api/tests/unit/routes/transcriptions/list-wr-10-redacted-log.test.ts
    - apps/api/tests/unit/routes/streaming-usage-wr-11-text-preview.test.ts
    - .planning/phases/65-high-findings-api-routes-transcriptions/verify-first.log
  modified:
    - apps/api/src/routes/tokens/openai-realtime.ts
    - apps/api/src/routes/agent/web-search.ts
    - apps/api/src/lib/web-search/types.ts
    - apps/api/src/lib/web-search/tavily-adapter.ts
    - apps/api/src/lib/web-search/yandex-adapter.ts
    - apps/api/src/routes/diarization.ts
    - apps/api/src/routes/realtime.ts
    - apps/api/src/routes/agent/stream.ts
    - apps/api/src/routes/transcriptions/batch-delete.ts
    - apps/api/src/routes/transcriptions/list.ts
    - apps/api/src/routes/streaming-usage.ts
decisions:
  - "WR-04: zod-type-provider validatorCompiler IS attached → inline parse dropped"
  - "WR-09: Option A (document sentinel + relative-url guard) — no proxy URL-rewrite hook exists"
metrics:
  duration: ~1h05m
  completed: 2026-05-21
---

# Phase 65 Plan 01: HIGH findings api-routes-transcriptions Summary

Cleared all 11 WARNING-level findings (WR-01..WR-11) in the `apps/api`
transcriptions / tokens / agent / realtime / diarization / streaming route
cluster via strict RED→GREEN TDD — WR-01 confirmed already-closed (Phase 62
HI-03) with a regression guard; WR-02..WR-11 each fixed with an ID-referenced
test. All 8 constitutional lockers stay green; typecheck unchanged at the
5-error baseline; the `@openwhispr/api` suite is 1475 passing / 0 failing.

## Per-finding disposition

- **WR-01 — ALREADY-CLOSED.** Verified all 7 throw sites (`transcribe.ts:221`,
  `reason.ts:119`, `diarization.ts:194`, `tokens/{assemblyai,deepgram,openai-realtime}.ts`,
  `agent/web-search.ts:113/:127`) emit a two-arg code+literal pair —
  `ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable")`
  / `TypedServiceUnavailable("WEB_SEARCH_*", "Service temporarily unavailable")`.
  Phase 62 HI-03 swept them; the upstream `.message` is logged server-side
  only. The review's WR-01 text (citing `transcribe.ts:115` raw `.message`)
  was STALE. No production fix; GREEN-only regression guard test added.
  Commit `4a751c18`.
- **WR-02 — FIXED.** Disposition: drop the `upstream` field (not allowlist —
  no wire-doc consumer needs `code`/`type`/`param`). The raw
  `upstream400.upstreamBody` blob is dropped from the 400 envelope and logged
  server-side only. RED+GREEN atomic commit `4a751c18`.
- **WR-03 — FIXED.** `realtime.ts:182` + `agent/stream.ts:145` now throw the
  two-arg `AuthError("UNAUTHORIZED", "unauthorized")` form; both routes
  confirmed `code === "UNAUTHORIZED"` (asserted via a fake-i18n harness that
  maps `errors.UNAUTHORIZED` vs `errors.AUTH_ERROR` to distinct wire strings).
  RED+GREEN atomic commit `c8b5d9ae`.
- **WR-04 — FIXED. Validator-attached determination: ATTACHED.** Confirmed
  `plugins/zod-type-provider.ts:21` calls `setValidatorCompiler`, registered
  at the buildApp boundary, so the declarative `schema.body` validates before
  the handler. The route now registers via `app.withTypeProvider<ZodTypeProvider>()`
  for a typed `req.body`; the redundant inline `AgentStreamRequestSchema.parse()`
  is dropped. (Distinct from Phase 64 H-1's conversations routes which do NOT
  declare `schema.body`.) RED+GREEN atomic commit `c8b5d9ae`.
- **WR-05 — FIXED.** Interface-member shape chosen: a `readonly envVarLabel:
  string` property (mirrors `name`, simpler than a method). Added to
  `WebSearchProvider`; tavily + yandex adapters supply their own label; the
  route reads `provider.envVarLabel` generically — no `provider.name ===`
  fork. RED+GREEN atomic commit `b41a57b8`.
- **WR-06 — FIXED.** The Speaches multipart boundary segment is
  `crypto.randomBytes(16).toString("hex")` (32 hex chars); `randomBytes` added
  to the existing `node:crypto` import. RED proves a 32-hex segment + that two
  successive boundaries differ. RED+GREEN atomic commit `73661033`.
- **WR-07 — FIXED.** Timing-mitigation shape: a constant-time wall-clock floor
  (`FAILURE_PATH_FLOOR_MS = 750`, measured from handler entry) on the mismatch
  branch — the failure path waits out the remaining budget before throwing
  `NotFoundError`. Budget exceeds the p99 all-hit duration for the 500-id cap
  (a soft-delete UPDATE of 500 indexed rows is sub-50ms on loopback). The RED
  stayed timing-based: a structural floor assertion (all-miss 500-id batch
  takes ≥ the floor) + a comparative median assertion (all-miss median not
  systematically faster than all-hit), both real-Postgres. RED+GREEN atomic
  commit `59b7d732`.
- **WR-08 — FIXED.** The 502 (job failed/cancelled) and 504 (poll-ceiling)
  sends now emit the canonical `{error:<string>}` envelope (a string) with NO
  inline `jobId` field; the 504 operator-speak is replaced with user-facing
  copy referencing the documented Idempotency-Key resume mechanism. Scope: the
  jobId-carrying 502/504 sites only — the envelope-correct non-jobId inline
  sends were already canonical and untouched. The 504 status-code path is
  covered by the existing fake-timer ceiling test in `diarization.test.ts`;
  the new WR-08 504 assertion is a source-level guard (the poll ceiling is
  300_000ms with no test override). RED+GREEN atomic commit `73661033`.
- **WR-09 — FIXED. Option A chosen.** Rationale: `@fastify/http-proxy@11.4.4`
  exposes no per-request upstream-URL rewrite hook (only
  `wsClientOptions.rewriteRequestHeaders`, headers-only), so Option B is not
  cleanly achievable and Option C (HALT) is unwarranted — Option A is the
  genuine improvement. The `"http://internal"` sentinel parser base is now
  documented; the preHandler asserts `req.raw.url` is relative (rejects loudly
  if absolute, surfacing the silent scheme/host-drop bug); the in-place
  mutation stays as the last preHandler statement. RED+GREEN atomic commit
  `970e17bd`.
- **WR-10 — FIXED.** `transcriptions/list.ts` logs `{ name: (err as
  Error).name }` instead of the raw `err` Error object. RED+GREEN atomic
  commit `1c71fafc`.
- **WR-11 — FIXED.** `streaming-usage.ts` drops `text_preview` (and the
  now-dead `previewCap` local) from the structured log; `text_sha256` +
  `text_length` (hash + count, not content) stay. RED+GREEN atomic commit
  `1c71fafc`.

## Deviations from Plan

None — plan executed exactly as written. The pre-existing diarization and
streaming-usage tests that asserted the WR-08 `jobId` shape and the WR-11
`text_preview` field were updated in the same GREEN commits (those tests were
guarding the defective behavior; updating them IS the fix, not a workaround).

## Verification

- `pnpm --filter @openwhispr/api test` — 1475 passed / 0 failing / 2 skipped
  (1454 baseline + 21 new; the 2 skips are pre-existing).
- `pnpm lint:lockers` — exit 0, all 8 lockers green. LOCKER-05 secret-shape /
  content-leak discipline strengthened by WR-02/WR-08/WR-10/WR-11 (raw upstream
  blob, jobId field, raw Error object, STT preview all removed from the wire /
  logs).
- `pnpm typecheck` — 5 errors, identical to the documented baseline (verified
  by stash-comparing against clean HEAD); 0 new errors.

## Self-Check: PASSED

All 10 created test files exist; all 8 commit SHAs (`4a751c18`, `b41a57b8`,
`73661033`, `c8b5d9ae`, `970e17bd`, `59b7d732`, `1c71fafc`, `b259f389`) plus
the verify-first commit `a3364f0d` are on HEAD; `git status --short` shows no
orphaned edits from this plan.
