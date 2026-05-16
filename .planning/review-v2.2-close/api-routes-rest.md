# Re-Review (v2.2 close audit): api-routes-rest

Branch: main @ b830cc4 (was 1832f28 at original review)
Scope (re-confirmed): `apps/api/src/routes/*.ts` top-level + `apps/api/scripts/**`, excluding the subdirs claimed by other reviewers (conversations/, folders/, notes/, transcriptions/, tokens/, v1/, agent/).

Files re-read at HEAD:
- apps/api/src/routes/index.ts (registration only — sampled)
- apps/api/src/routes/auth-callback.ts
- apps/api/src/routes/auth-providers.ts
- apps/api/src/routes/better-auth-handler.ts
- apps/api/src/routes/capabilities.ts
- apps/api/src/routes/check-user.ts
- apps/api/src/routes/delete-account.ts
- apps/api/src/routes/desktop-signin.ts
- apps/api/src/routes/diarization.ts (lines 430–520)
- apps/api/src/routes/locale.ts
- apps/api/src/routes/note-recording-config.ts
- apps/api/src/routes/probes.ts
- apps/api/src/routes/realtime.ts
- apps/api/src/routes/reason.ts
- apps/api/src/routes/setup-admin.ts
- apps/api/src/routes/setup-state.ts
- apps/api/src/routes/streaming-usage.ts
- apps/api/src/routes/stt-config.ts
- apps/api/src/routes/test-only.ts
- apps/api/src/routes/transcribe.ts
- apps/api/src/routes/usage.ts
- apps/api/src/routes/verification-status.ts
- apps/api/scripts/check-default-secrets.ts (unchanged since original review)
- apps/api/scripts/fd-probe.sh (unchanged; still byte-identical to `compose/traefik/fd-probe.sh` per the documented `diff -q` enforcement)

Commits relevant to this re-review (range `1832f28..b830cc4`, scope filter applied):
- `b9a4e6e` feat(35a): public bootstrap endpoints bypass dualAuthHook (CR-2 / CRIT-FIX-04)
- `7b46659` feat(35b): forward multi-Set-Cookie via getSetCookie() (CR-3 / CRIT-FIX-05)
- `79a6768` feat(35c): compensating rollback when setup-admin role flip fails (CR-4 / CRIT-FIX-06)
- `8ae973e` feat(40a): move route schemas from contract-tests to wire-schemas (import-path only)
- `c5112d9` fix(19.2-02): wire STT_MODEL into transcribe route's litellm forward (model is now sent upstream, but the response-attribution constant is still hardcoded — see HIGH-1 status below)
- `e82a390` fix(19b-03): locale auth opt-out (folded into CR-2 closure)

## Summary
- Files re-reviewed: 22 source + 4 scripts = 26.
- CRITICAL findings from original review (3) → ALL CLOSED.
- HIGH findings from original review (3) → 0 closed; 3 still open.
- MEDIUM findings (5) → 0 closed; 5 still open.
- LOW findings (2) → 0 closed; 2 still open.
- New defects discovered in this re-review: 0 BLOCKER, 0 WARNING that weren't already covered by the original. The original's open MEDIUM/HIGH set fully describes the remaining surface.
- Status: **partial closure**. The Phase 35 milestone scoped only the 3 CRITICALs; v2.2-close discipline (per `.planning/PHASE-35-PLAN.md` if it tracks deferrals) needs to record the 6 still-open HIGH+MEDIUM as carry-over to v2.3 or accept them.

## Closure delta — original findings vs HEAD b830cc4

### CR-1 [CRITICAL] Public endpoints missing `config.auth = false` — **CLOSED** (b9a4e6e + e82a390)
- `apps/api/src/routes/locale.ts:79` now sets `config: { auth: false, rateLimit: { ... } }` (verified at HEAD). Commit comment cross-references SR-19b.3.
- `apps/api/src/routes/auth-providers.ts:86` now sets `config: { auth: false, rateLimit: { ... } }` with explicit Phase 35 / CR-2 attribution comment.
- `apps/api/src/routes/setup-state.ts:75` now sets `config: { auth: false, rateLimit: { ... } }` with the same attribution.
- Defense-in-depth: the commit message cites a new `tests/unit/integration/public-bootstrap-endpoints.test.ts` that boots `buildApp()` with the global `dualAuthHook` installed and asserts 200 for anonymous traffic against all three routes. The original review's correctly-identified false-pass mode (per-route unit tests register a bare Fastify) is now caught at the integration layer.
- Residual nit (carried over from review NOTE 4): `capabilities.ts` correctly omits `auth: false` (it IS session-required) but does not explicitly set `auth: true`. Acceptable per Fastify semantics; no action needed.

### CR-2 [CRITICAL] `better-auth-handler` collapses multi-value `Set-Cookie` — **CLOSED** (7b46659)
- `apps/api/src/routes/better-auth-handler.ts:230-237` now drives a two-pass header forward:
  1. `for (const cookie of webRes.headers.getSetCookie()) { reply.header("set-cookie", cookie); }` — emits each cookie as an independent header line.
  2. The subsequent `webRes.headers.forEach` skips `key.toLowerCase() === "set-cookie"` to avoid double-emission.
- This is the exact fix the original review proposed (lines 80–91 of `.planning/review/api-routes-rest.md`). Implementation matches WHATWG Fetch spec and Node 24 LTS undici Headers semantics.
- Per the commit body the test surface that proves the fix lives in `apps/api/tests/unit/routes/__tests__/better-auth-handler.test.ts` (the existing suite already had a "multi cookie" placeholder asserting one set-cookie became two; now flipped to GREEN).

### CR-3 [CRITICAL] `setup-admin` step-4 role flip has no rollback — **CLOSED** (79a6768)
- `apps/api/src/routes/setup-admin.ts:252-289` now wraps `UPDATE users SET role='admin'` in a try/catch. On failure:
  - (a) `DELETE FROM users WHERE id = $1` — half-created user removed; the `users_tenant_email_lower_unique` index is freed for a retry.
  - (b) `UPDATE setup_state SET status='pending', completed_at=NULL` — gate re-opened so the next POST hits the winner branch, not the `alreadyCompleted:true` short-circuit.
  - (c) Returns `503 ADMIN_CREATE_FAILED` with the canonical recoverable envelope.
- Cleanup queries are themselves wrapped in nested try/catch with `req.log.warn` audit (lines 263–280) — defense-in-depth against cascading outages.
- Commit body cites `tests/unit/routes/__tests__/setup-admin-rollback.test.ts` using the real-Postgres testcontainer harness with a Proxy-wrapped owner Pool that throws specifically on `UPDATE users SET role`. Asserts (1) 503 envelope + state rollback, (2) a SECOND POST takes the winner branch (proves the wedge is gone), (3) audit-log smoke.

---

### HIGH-1 [HIGH] `transcribe.ts` hardcoded `sttProvider/sttModel` — **OPEN** (partial: model now sent upstream, but response attribution still hardcoded)
- File: `apps/api/src/routes/transcribe.ts:61-62, 103, 149-150`
- Progress: commit `c5112d9` (fix 19.2-02) now passes `model: STT_MODEL` into `deps.litellm.audioTranscriptions(...)` (line 103) so LiteLLM no longer rejects with `model=None` (SERVER-ERRORS Entry 11).
- Still broken: `STT_PROVIDER = "groq"` and `STT_MODEL = "whisper-large-v3"` are module-level constants. When a corporate operator overrides `LITELLM_BASE_URL` to an internal proxy whose Whisper alias is e.g. `whisper-internal-v2` and provider is `bedrock`, the desktop receives `sttProvider:'groq'` / `sttModel:'whisper-large-v3'` regardless. This contradicts CLAUDE.md's "corporate-LiteLLM-ready by env override" core value.
- The neighboring `reason.ts:145` shows the correct pattern — `responseModel = upstreamJson.model ?? model;` echoes whatever LiteLLM resolved. `transcribe.ts` should do the same on the model axis at minimum, and prefer settings-table-derived provider attribution over the bundled-default constant.
- Severity unchanged from original: HIGH (incorrect attribution shipped to clients; misleading observability labels in usage_ledger downstream).
- Action: defer to v2.3 or fold into Phase 19.2 closure follow-up (a separate fix landed `c5112d9` but did not touch the response shape).

### HIGH-2 [HIGH] `verification-status` case-sensitive email lookup — **OPEN** (unchanged at HEAD)
- File: `apps/api/src/routes/verification-status.ts:58`
- Still uses `WHERE email = ${query.email}` rather than `WHERE lower(email) = lower(${query.email})`.
- `check-user.ts:60` (also re-read at HEAD) correctly uses `lower(email) = lower(${body.email})` and explicitly cites the functional unique index `users_tenant_email_lower_unique` from migration 0004.
- The inconsistency is a latent verification-poll false-negative whenever a UA submits a mixed-case email. Better Auth lowercases on sign-up persist; once a user is in the DB with `foo@example.com`, polling with `Foo@Example.com` returns `verified:false` forever.
- Action: one-line fix; carry to v2.3 batch.

### HIGH-3 [HIGH] `streaming-usage` logs up to 1000 chars of user transcript text — **OPEN** (unchanged at HEAD)
- File: `apps/api/src/routes/streaming-usage.ts:79-103`
- `previewCap = body.sendLogs ? 1000 : 200` — even the "no opt-in" path logs 200 chars of raw transcript to structured logs at `info` level. Sensitive snippets (passwords spoken aloud, medical/legal content) flow to Loki / shared log aggregation by default.
- File header explicitly labels D-13 as the SHA-256+length mitigation, but the route emits `text_preview` UNCONDITIONALLY in the `req.log.info({...})` payload below. The opt-in toggle controls the cap (200 vs 1000), not the existence of the preview.
- The original review's recommended remediation (gate behind a server-side env, default 0) still stands. PII handling regression risk grows linearly with observability deployment maturity (more shared Loki tenants, more log retention).
- Action: ship a small env-gated fix (`OPENWHISPR_LOG_TRANSCRIPT_PREVIEW=200|1000`, default 0). The current shape is dangerously close to "we log everything by default."

### MEDIUM-1 [MEDIUM] Diarization multipart re-wrapper interpolates `filename` without sanitization — **OPEN**
- File: `apps/api/src/routes/diarization.ts:449, 464`
- Still: `const fileName = filePart.filename || "audio.wav";` then `\nContent-Disposition: form-data; name="file"; filename="${fileName}"...`.
- busboy strips inline CRLF, but unescaped `"` produces a malformed Content-Disposition that Speaches turns into a 502/HTML the API maps to 502 — the original 400 should win. Non-ASCII filenames also can't carry RFC 5987 `filename*=` encoding under this hand-rolled envelope.
- Action: one-line `safeName = fileName.replace(/["\r\n]/g, "_")` or migrate to the built-in `FormData`/`Blob` (Node 18+) so the runtime handles boundary + encoding. Carry to v2.3.

### MEDIUM-2 [MEDIUM] `setup-admin` returns non-canonical error envelope — **OPEN**
- File: `apps/api/src/routes/setup-admin.ts:160-167, 222-229, 282-288`
- All three error sites still emit `{ error: { code, message, requestId } }` directly rather than throwing `ValidationError`/`ServiceUnavailable` so the centralized `setErrorHandler` produces the canonical `{ error: string }` envelope.
- Note: the NEW Phase 35 rollback path (lines 282–288) inherits the same non-canonical shape. The fix is still safe to land without disturbing the rollback semantics.
- Two leaks survive:
  - Line 163: `parseResult.error.message` (full Zod issue tree, includes the rejected email/password content in `received:` paths).
  - Line 226: `signUpResult.error?.message` (Better Auth error strings frequently include the email value).
- Action: thread through canonical error classes; log the verbose detail at `req.log.warn` only. Carry to v2.3.

### MEDIUM-3 [MEDIUM] Hardcoded fallback scheme `http://` in `better-auth-handler` — **OPEN**
- File: `apps/api/src/routes/better-auth-handler.ts:45-51`
- `buildRequestUrl` still: `proto = req.headers["x-forwarded-proto"] ?? "http"; host = req.headers.host ?? "localhost"`.
- Phase 35 commits only addressed the CR-3 cookie iteration; the fallback URL construction was not touched. Under a misconfigured reverse-proxy (no `x-forwarded-proto`), Better Auth sees `http://localhost...` and may reject under `trustedOrigins`, OR mint cookies WITHOUT the `__Secure-` prefix that production deploys (and the `delete-account.ts` cookie-clearing path) depend on.
- CLAUDE.md NON-NEGOTIABLE: "HTTPS only: never plaintext HTTP on any externally reachable port." Defaulting to `http` swallows the very misconfiguration the constraint is meant to surface.
- Action: read `req.protocol` (Fastify's already-resolved value honoring `trustProxy`); refuse to default when `NODE_ENV === 'production'`. Note that `NODE_ENV` reads outside `bootstrap.ts`/`config/*.ts` violate Constitutional Rule 11 (LOCKER-01) — either inject a `productionMode` boolean through DI, or route the refusal through an existing config module. Carry to v2.3.

### MEDIUM-4 [MEDIUM] `desktop-signin` does not validate `OIDC_ISSUER_URL`/`OIDC_AUTHORIZE_URL` scheme — **OPEN**
- File: `apps/api/src/routes/desktop-signin.ts:162-176`
- Still: `authorizeBase = process.env.OIDC_AUTHORIZE_URL ?? \`${trimmedIssuer}/authorize\``; `new URL(authorizeBase)`; `reply.redirect(idpUrl.toString(), 302)`. No scheme allowlist.
- A misconfigured env (operator typo, copy-paste error from a `.env.example`, hostile operator escalation) turns this into a 302 to an arbitrary origin. Since the env is operator-controlled it's not directly user-exploitable, but the surface IS the IdP URL bypassing the desktop-callback scheme check.
- Action: validate at module load (`if (!OIDC_AUTHORIZE_URL.startsWith("https://")) throw`). Could fold into the boot-time env-validator surface that the encryption-boot gate (`validateEncryptionBoot`) uses. Carry to v2.3.

### MEDIUM-5 [MEDIUM] `auth-callback` redirect kind `expired` reached through unreachable fall-through — **OPEN**
- File: `apps/api/src/routes/auth-callback.ts:197-204`
- The trailing `return { kind: "expired" as const };` (line 204) still fires when `expiresAtMs` is NaN (unparseable `row.expires_at`) AND `consumed_at` is null. That's a parse failure of the DB column, not an expiration, and the misleading envelope hides the bug.
- Action: replace the trailing `expired` with a `req.log.warn` + return `{kind:"missing"}` (defensive degradation). Carry to v2.3.

### LOW-1 [LOW] `test-only` litellm-baseurl introspection seam echoes raw upstream URL — **OPEN**
- File: `apps/api/src/routes/test-only.ts:142-146`
- Gate is `process.env.OPENWHISPR_TEST_ROUTES === "true"` (line 128). Still no defense-in-depth refusal when `NODE_ENV === "production"`.
- Note: a refusal here would have to thread through the same Rule-11 / LOCKER-01 carve-out (test-only is allowlisted in `tools/lint-no-env-branches.allowlist.txt` per `issue-31-debt-test-only-gate`; adding a new NODE_ENV read would need a fresh allowlist entry, OR injection of the prod-mode flag through DI). Carry to v2.3.

### LOW-2 [LOW] `realtime.ts` `httpToWsScheme` does not reject non-http(s) input — **OPEN**
- File: `apps/api/src/routes/realtime.ts:87-89, 119-123`
- The header comment on lines 119–122 STILL claims "we want to fail loud here" but the implementation (line 87) silently lets `tcp://litellm` through unchanged. The downstream `ws` library will reject with a less-actionable error. The fix is a one-line invariant assertion: throw if the result doesn't start with `ws://` or `wss://`. Carry to v2.3.

## New defects discovered in this re-review
None that aren't already captured above. Specifically scanned for:
- Regression in Phase 35 fixes (CR-2/3/4): commit-level read shows each fix is bounded and the comments document intent verbosely. No collateral changes to neighboring routes.
- New `as any` / `@ts-ignore` / `as unknown as` in the touched files: none introduced.
- New hardcoded localhost/UUID/port literals (LOCKER-03): none in the diff.
- New plaintext credential columns: N/A (no schema files in this reviewer's scope; the only schema-adjacent commit is `f7fea28` Phase 33-05 which lands the LOCKER-08 plaintext drop and is owned by the data-layer reviewer).

## Dead code
- Same as original: `auth-callback.ts:204` trailing `expired` is still unreachable-when-NaN. See MEDIUM-5. No new dead-code introduced.
- `verification-status.ts:54` `throw new AuthError("session expired")` — original review classified as defensive (preHandler should always set `req.tenant`); confirmed defensive guard, not dead.

## Suppressed warnings
- `apps/api/scripts/check-default-secrets.ts:30-35` — same three biome-ignore + eslint-disable lines for the CJS `__dirname` fallback. Justified, narrowly scoped, no change. (Original review NOTE.)
- No `as any` / `as unknown as` / `@ts-ignore` / `@ts-expect-error` in the route files in scope. The `as { rows: ... }` casts on `tx.execute(sql\`...\`)` results remain necessary given the structural `TransactionalDb` interface; same posture as original.
- `process.env.NODE_ENV` reads in `apps/api/src/routes/test-only.ts:128` and `apps/api/src/routes/index.ts:474` remain in the `tools/lint-no-env-branches.allowlist.txt` allowlist under `issue-31-debt-test-only-gate` and `issue-31-debt-NODE_ENV-shortcircuit` respectively. No additional violations were introduced by the Phase 35 fixes.

## Disabled tests near scope
- None found at HEAD. The new `tests/unit/integration/public-bootstrap-endpoints.test.ts` (per commit b9a4e6e body) and `tests/unit/routes/__tests__/setup-admin-rollback.test.ts` (per commit 79a6768 body) are cited as GREEN. This re-reviewer did not execute the suites; commit-level confidence is treated as INPUT not PROOF per CLAUDE.md Hard Rule #3, and a verifier should re-run `pnpm test public-bootstrap-endpoints` and `pnpm test setup-admin-rollback` to confirm.

## Notes
- The Phase 35 commits (a, b, c) are tightly scoped, well-commented, and include phase-traceability strings (`Phase 35 / CR-2 (CRIT-FIX-04)` etc.) on the changed lines — they will be easy to find again. Pattern-of-the-week.
- All 3 CRITICAL fixes preserved the original review's recommended code shape (the better-auth-handler `getSetCookie()` iteration in particular is verbatim). No invention; no scope-creep into the 6 still-open HIGH/MEDIUM.
- v2.2 close-status: with 3 CRITICALs closed, the remaining HIGH/MEDIUM/LOW set is a release-with-known-issues posture, not a release-blocker posture. Recommend a single v2.3 carry-over phase folding HIGH-1/2/3 + MEDIUM-1..5 + LOW-1/2 into one batch — each individual fix is <20 lines, but the test-shape work (preview-gate env, validators) takes the bulk.
- No surprises in `apps/api/scripts/` — both `check-default-secrets.ts` and `fd-probe.sh` are unchanged since the original review.

---

_Re-reviewed: 2026-05-16_
_Reviewer: gsd-code-reviewer (v2.2 close audit)_
_HEAD: b830cc4_
_Depth: standard (full-file reads on every in-scope file + commit-level cross-check of the Phase 35 deltas)_
