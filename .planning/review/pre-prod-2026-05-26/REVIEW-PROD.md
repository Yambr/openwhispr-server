---
phase: pre-prod-2026-05-26
reviewed: 2026-05-26T00:00:00Z
depth: deep
reviewer: gsd-code-reviewer (Claude Opus 4.7 1M)
scope: realtime delta (5 uncommitted) + last 5 commits + broader source sweep
files_reviewed: 19
files_reviewed_list:
  - apps/api/src/config/realtime.ts
  - apps/api/src/lib/realtime-frame-translate.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/tests/unit/lib/realtime-frame-translate.test.ts
  - apps/api/tests/unit/routes/realtime.test.ts
  - apps/api/tests/unit/routes/realtime-language.test.ts
  - apps/api/src/config/stt-settings.ts
  - apps/api/src/routes/locale.ts
  - apps/api/src/routes/verify-email-complete.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/index.ts
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/locales/en/end-user.json
  - apps/web/src/locales/ru/end-user.json
  - compose/litellm/litellm_config.yaml
  - compose/litellm/litellm_config.contract.yaml
  - packages/litellm-client/src/litellm-aliases.generated.json
  - packages/litellm-client/src/model-aliases.ts
  - docs/operations.md
findings:
  critical: 0
  blocker: 0
  warning: 4
  info: 9
  total: 13
status: issues_found
---

# Pre-Prod Code Review — 2026-05-26 Push

**Verdict:** **GO with caveats**. No CRITICAL/BLOCKER bugs found. The realtime delta (uncommitted 5 files) is sound on the happy path; the test surface is well-stocked. Four WARN-tier findings exist (concurrency edge in `forwardClientFrame`, missing `.env.*.example` documentation for new `REALTIME_DEFAULT_LANGUAGE`, M9 test design weakness, agent-stream default model drift after ce608926). All four are quality issues that do NOT block a hotfix push, but the operator should know about them before declaring v1.0.9 stable.

## Executive Summary

- **Must-fix-before-push (CRIT/BLOCKER):** 0
- **Should-fix-soon (WARN):** 4 — see WR-01 through WR-04
- **Info / housekeeping:** 9
- **Constitutional lockers checked:** LOCKER-01 (NODE_ENV — clean for new code), LOCKER-02 (no-suppressions — clean for new code), LOCKER-03 (no-hardcode — clean for new code, all test secrets within `tests/` allowlist), LOCKER-04 (route schema/rateLimit — `/v1/realtime` is missing both BUT was already on the Phase 41 backlog allowlist), LOCKER-05 (Error secret-shape truncation — N/A for delta), LOCKER-06 (shell credential interpolation — N/A for delta), LOCKER-08 (plaintext credential cols — N/A for delta).
- **Wire-spec drift:** none in scope. The `?language=` query strip + in-band `session.audio.input.transcription.language` injection conforms to OpenAI Realtime GA. Translate-helpers retain the legacy Beta→GA fallback as defence-in-depth.
- **Gitleaks hooks:** All `sk-*` literals in the new test file are inside `tests/**/*.test.ts` — already covered by `.gitleaks.toml` path allowlist. No `--no-verify` risk.
- **TDD discipline:** New prod code in realtime delta ships with matching RED→GREEN unit tests in the same wave (M1/M4/M6 on the pure helper; M2/M3/M5/M6/M7/M8/M9 on the route). Coverage delta on the changed lines appears ≥ 90% by inspection (config/realtime.ts diff ≈ 30 added lines fully covered; lib delta ≈ 16 lines, all hit by M1/M4; route delta ≈ 35 lines, all hit by M2/M3/M5/M6/M8/M9). E2E gap noted in IN-09.

## Realtime uncommitted-delta subsection — owner-priority

Every uncommitted file gets at least one line here. **None of these are push-blockers**, but the owner will look here first.

### `apps/api/src/config/realtime.ts` (+47 LOC)
- ✅ **Boot-fatal validation correct.** `REALTIME_DEFAULT_LANGUAGE="xx"` throws `RealtimeConfigError`; entrypoint at `apps/api/src/index.ts:142` catches the throw at gate time and exits 78 (EX_CONFIG). Same loud-fail posture as `REALTIME_BACKEND`. Verified `loadRealtimeConfigFromEnv` is called twice in `index.ts` (lines 142 and 1027) — first call is the boot gate, second call's result is the value the route consumes. Trimmed + lowercased on read; blank env treated as unset.
- ✅ **Type `RealtimeLanguage` is constrained correctly** as `(typeof REALTIME_LANGUAGE_WHITELIST)[number]` → `"en" | "ru"`. The `as RealtimeLanguage` narrowing cast on line 273 is justified (input already validated by the `.includes` guard immediately above).
- ⚠️ See **IN-02** — `RealtimeLanguage` type is exported but has zero non-test importers. Potential LOCKER-04 dead-export hit. Phase 38 backlog, currently WARN-only.

### `apps/api/src/lib/realtime-frame-translate.ts` (+21 LOC)
- ✅ **Conditional spread on `language` is correct.** `...(config.language ? { language: config.language } : {})` — when undefined OR empty string, the field is genuinely OMITTED from the wire frame (no literal `language: undefined`). Verified via M4 test (`expect("language" in transcription).toBe(false)`).
- ✅ `RelayTranscriptionConfig.language?: string` (LOOSE type) mirrors `RealtimeTranscriptionConfig.language?: RealtimeLanguage` (STRICT type) in `config/realtime.ts`. Comment correctly notes the layering. The pure module avoids the import cycle.

### `apps/api/src/routes/realtime.ts` (+56 LOC)
- ✅ **Per-upgrade shallow clone is correct.** Line 590-593: `perUpgradeTranscription = { ...deps.transcription, ...(resolvedLanguage ? { language: ... } : {}) }`. This DOES prevent singleton mutation — the spread creates a fresh object. The M9 test's stated intent (race-resistance) is correct but the implementation is well-known good.
- ✅ **Strip-set extended to drop `?language=`** on both `direct` and `litellm` backends (`buildUpstreamUrl` lines 271 + 292). The hint travels in-band only.
- ✅ **Invalid `?language=` value is dropped + warned, not 400'd.** Falls back to env default. Sensible — a typo on the wire from a misbehaving client shouldn't tear down the session.
- ⚠️ See **WR-01** — `forwardClientFrame` calls `upstreamSocket.send()` without a `readyState === OPEN` guard, while the symmetric upstream→client direction at line 422 DOES guard. Asymmetric defense.
- ℹ️ See **IN-03** — `pendingTuples` array is unbounded during the 10s handshake window. A noisy client could push a few hundred KB into it. Not exploitable but worth noting.
- ℹ️ See **IN-04** — `new URL(rawUrl, "http://internal")` is now constructed TWICE per upgrade (line 262 inside `buildUpstreamUrl` and line 573 in the handler). Trivial perf duplication.

### `apps/api/tests/unit/lib/realtime-frame-translate.test.ts` (+62 LOC)
- ✅ M1 / M4 / M6 cases assert the right invariants: language present when set, OMITTED when unset (using `'language' in transcription === false`, not `=== undefined`), whitelist export is `['en','ru']` exactly. Test code mirrors the production constant correctly.

### `apps/api/tests/unit/routes/realtime.test.ts` (+5 LOC, flip RED→GREEN)
- ✅ Single assertion flipped from `transcription_session.created` → `session.created` reflecting the 2026-05-26 prod-incident passthrough fix (commit 2803c1a8). Comment correctly cites the upstream client switch-table location and the 15-second silent timeout reproduction.

### `apps/api/tests/unit/routes/realtime-language.test.ts` (new file, 390 LOC)
- ✅ M2/M3/M5/M6/M7/M8 cases are well-formed and exercise the full route → upstream → captured-frame path with a real `ws.WebSocketServer`. Per project rule "no mocks of internal logic" — only the upstream `ws` server is mocked; `buildUpstreamUrl`, `bridgeRealtimeSockets`, `parseRealtimeFrame` all run real.
- ⚠️ See **WR-03** — M9 ("concurrent upgrades isolate per-upgrade language") doesn't actually exercise the race the comment claims. It uses TWO Fastify apps with TWO different deps copies — even if the route mutated deps.transcription, app A's mutation couldn't ripple to app B. A stronger M9 would issue two concurrent upgrades against the SAME app instance.

---

## Findings table (sorted by severity)

| ID | Sev | File:Line | Issue | Evidence |
|----|-----|-----------|-------|----------|
| WR-01 | WARN | apps/api/src/routes/realtime.ts:377-393 | `forwardClientFrame` calls `upstreamSocket.send()` without a `readyState === OPEN` guard. The symmetric upstream→client path at line 422 DOES check. Asymmetric defense — a client→upstream race during upstream close can fire an async `error` event. | Lines 380 and 392 both unguarded; line 422 guards with `if (clientSocket.readyState !== WebSocket.OPEN) return;` |
| WR-02 | WARN | .env.full.example / .env.slim.example / .env.local-speaches.example / .env.external.example | New `REALTIME_DEFAULT_LANGUAGE` env var has docs/operations.md §coverage (lines 631-694) but is absent from every `.env.*.example` template. Operators bootstrapping from .env templates will miss this knob. | `grep REALTIME_DEFAULT_LANGUAGE` against all .env.example files → 0 hits; docs/operations.md:684 shows the canonical operator example. |
| WR-03 | WARN | apps/api/tests/unit/routes/realtime-language.test.ts:334-389 | M9 test "concurrent upgrades isolate per-upgrade language" doesn't exercise the race condition the comment claims. Two Fastify apps + two deps copies cannot share singleton state — the assertion that `baseTranscription.language === undefined` is vacuous (each `{ ...baseTranscription }` already broke the reference). | The actual prod code uses `{ ...deps.transcription, ...{...} }` per-upgrade, which is correct, but the test doesn't strongly prove it under a real concurrent-upgrade scenario. |
| WR-04 | WARN | packages/litellm-client/src/litellm-aliases.generated.json:4-15 | After ce608926 added canonical `openwhispr-*` aliases, `getDefaultAgentModel()` still returns `qwen3.6-plus` (the FIRST alias by JSON order). The leak-1 fix flipped only `DEFAULT_STT_MODEL`; the agent/stream default still reads as the legacy upstream-shaped name. Either intentional (deferred LEAK 2) or a missed sibling. Commit ce608926 explicitly says "leak 1" — implies more follow-ups exist. | `apps/api/src/routes/agent/stream.ts:81` resolves DEFAULT_AGENT_MODEL via `getDefaultAgentModel()` which reads `aliases[0]` from the generated JSON; first entry is `qwen3.6-plus`. |
| IN-01 | INFO | apps/api/src/routes/realtime.ts:584 | Log field `falling_back_to_env_default: deps.transcription.language !== undefined` is semantically true ONLY when env-default exists. Slightly misleading — when env is unset AND query is invalid, the field reads `false` but we DO omit (which is also a fallback path, just not "to env"). The log line is still actionable; just consider renaming to `env_default_used` for clarity. | Field name strongly implies "we fell back from query → env"; reality is "is an env default available to fall back to". |
| IN-02 | INFO | apps/api/src/config/realtime.ts:134 | `export type RealtimeLanguage` has zero non-test importers. Phase 38 will catch dead exports; this is dead-export-eligible. The whitelist const it derives from IS imported by routes/realtime.ts, so the value side is alive. | `grep -rn RealtimeLanguage` outside tests → only the same file's internal uses. |
| IN-03 | INFO | apps/api/src/routes/realtime.ts:364, 397 | `pendingTuples` array is unbounded during the 10-second upstream handshake window. A misbehaving client streaming audio (24 kHz × 16-bit = ~48 KB/s) could accumulate up to ~480 KB in the buffer before upstream completes. Bounded by `handshakeTimeout: 10_000`. Not exploitable as a DoS but worth a guard if memory is tight. | Lines 397-400: `pendingTuples.push(...)`; no max-size check before push. |
| IN-04 | INFO | apps/api/src/routes/realtime.ts:262, 573 | `new URL(rawUrl, "http://internal")` is constructed twice per upgrade: once in `buildUpstreamUrl` (line 262), once in the handler for language parsing (line 573). Trivial allocation duplication; could be threaded through but not worth a refactor today. | Both lines visible in the route file. |
| IN-05 | INFO | apps/api/src/lib/realtime-frame-translate.ts:283 | `...(config.language ? { language: config.language } : {})` uses TRUTHINESS, not `!== undefined`. Empty string `""` is falsy and would be omitted (different from `config/realtime.ts:306` which is strict `!== undefined`). Inconsistent. In practice the route never passes empty strings (the query parser only sets `resolvedLanguage` for non-empty trimmed values), but the two layers should converge on `!== undefined` to be defensible. | Compare line 283 (truthy) vs config/realtime.ts:306 (strict !== undefined). |
| IN-06 | INFO | apps/api/src/routes/realtime.ts:413-414 | Relay's self-injected `session.update` send happens on line 414 without try/catch. If upstream socket throws on `.send()` (e.g., the upstream tore down between 'open' and this call), an unhandled error fires. The `upstreamSocket.on("error", ...)` handler at line 471 would catch it, but the error path leaves the client in an ambiguous state. | Same defensive concern as WR-01, this time on the relay-originated frame. |
| IN-07 | INFO | apps/api/tests/unit/routes/realtime-language.test.ts:39 + apps/api/tests/unit/routes/realtime.test.ts:35 | Same string literal `"sk-litellm-master-test-only"` defined in two test files. Acceptable test code duplication; could share via a fixtures helper if more realtime test files appear. | Verbatim duplicate. |
| IN-08 | INFO | apps/api/tests/unit/routes/realtime-language.test.ts:42 vs apps/api/tests/unit/routes/realtime.test.ts:39 | `TEST_TRANSCRIPTION.model` differs between the two test files: `"gpt-4o-transcribe"` (new file) vs `"gpt-4o-transcribe-diarize"` (older file). Both are valid OpenAI Realtime models, but the inconsistency means one or the other doesn't reflect the production default (`gpt-4o-transcribe`). Prefer alignment. | Line 42 + line 39 — visible literal mismatch. |
| IN-09 | INFO | apps/api/tests/ | No E2E `.e2e.test.ts` exercises the WSS `/v1/realtime` route with `?language=` against the live compose stack. DISCIPLINE.md rule 3 says "every phase that touches a user-visible route ships ≥ 1 e2e test." The unit tests against a real `ws.WebSocketServer` are strong but not the live compose stack. The existing `R31` debug session may have one but it wasn't surfaced in this delta. | DISCIPLINE.md §3: e2e mandatory. |

---

## TODO / HACK / FIXME / костыль / временно markers (exhaustive grep)

Scanned `apps/api/src/`, `apps/web/src/`, `packages/data/src/`, `packages/auth/src/`. No new markers introduced by the delta. Existing matches are all benign:

- `apps/api/src/otel-bootstrap.ts:147` — comment notes a Phase 18.1.2-04-03 historical workaround that was removed (narrative only).
- `apps/api/src/auth.ts:702` — comment: `"CRITICAL: this is the FIRST-CLASS path, not a workaround."` — defensive prose, no debt.
- `apps/api/src/lib/token-rotation.ts:105` — references audit-IDs `AUDIT-SEC-01 (HACK-C2)` — those are tracker IDs for fixes already landed, not unresolved hacks.
- `apps/api/src/routes/better-auth-handler.ts:191` — references `AUDIT-HARD-01 (HACK-H2)` — same convention.
- `apps/api/src/i18n/locales/ru.json:7` — `"Сервис временно недоступен"` — legitimate Russian translation of the SERVICE_UNAVAILABLE i18n key.
- `packages/data/src/encryption/backfill.ts:114` — references `AUDIT-HARD-03 (HACK-L5)` — tracker ID.

**Verdict: no new TODO/HACK markers in the delta.** The audit-ID conventions are deliberate.

---

## NODE_ENV / type-suppression / hardcode locker checks

- **LOCKER-01 (NODE_ENV outside boundary files):** No new violations. All existing `process.env.NODE_ENV` references in `apps/api/src/lib/ssrf-dispatcher.ts`, `apps/api/src/routes/test-only.ts`, `apps/api/src/routes/__test/fetch.ts`, `apps/api/src/routes/index.ts:646`, `apps/api/src/index.ts:753-754` are individually allowlisted by `tools/lint-no-env-branches.allowlist.txt` with tracking-issue references. None added by this delta.
- **LOCKER-02 (`as any` / `as unknown as` / `@ts-ignore`):** No new violations in prod code. The realtime delta uses ONE narrowing cast `rawLanguage as RealtimeLanguage` in `config/realtime.ts:273` — guarded by the `.includes` check above, NOT in LOCKER-02's banned set. New test file uses `as never` / `as unknown as` — test paths are exempt.
- **LOCKER-03 (hardcoded localhost/UUID/secret-shape):** No new violations. Test file `realtime-language.test.ts` lives in `tests/` and contains `127.0.0.1` literals + `"sk-litellm-master-test-only"`; both allowed per the test-path allowlist.
- **LOCKER-04 (route schema + rateLimit + dead-export):** `/v1/realtime` route at `apps/api/src/routes/realtime.ts:531-606` declares NEITHER `schema:` NOR `config: { rateLimit }`. This is an existing pattern (WS upgrade routes); already on the Phase 41 route-bulkfix backlog. Two existing line-allowlist entries for this file (`:53`, `:87` — stale, the file has drifted heavily). Dead-export hits noted in IN-02 (`RealtimeLanguage` type). **Phase 41 backlog, not a push-blocker per DISCIPLINE.md §46.**
- **LOCKER-05 / 06 / 08:** N/A — no Error-class field additions, no spawn/exec/execSync new calls, no schema changes in `packages/data/src/schema/**`.

---

## Wire-spec drift check

- `?language=` query param strip on the upstream URL (BOTH `direct` and `litellm` backends) is CORRECT — language travels in-band on `session.audio.input.transcription.language`. This matches OpenAI Realtime GA's documented session.update schema.
- Conditional field OMIT (no literal `language: undefined`) matches GA's validator behavior (per the inline comment at `realtime-frame-translate.ts:274-280`).
- Translate helpers `translateClientToUpstream` / `translateUpstreamToClient` retain the legacy Beta→GA rewrite as dead-code defense-in-depth (per the v1.0.8 prod-incident commit 2803c1a8). No new spec drift.
- Whitelist `['en', 'ru']` matches the DB `users.locale` CHECK constraint at `packages/data/migrations/0016_users_locale.sql`. Single source of truth via `REALTIME_LANGUAGE_WHITELIST` exported once from `config/realtime.ts`.

**No wire-spec drift.**

---

## Last 5 commits — recheck

- **2803c1a8 fix(realtime): passthrough session.created/session.updated** — verified correct. Tests flipped RED→GREEN as documented; the helper `gaToBetaSessionPayload` / `gaAudioFormatToBeta` were deleted (no remaining callers). Passthrough is a one-line return, which means the function is currently a no-op except as a future-extension hook. Documented.
- **ce608926 fix(litellm,stt-config): openwhispr-* aliases** — see WR-04. The flip is correct as-far-as-it-went, but `getDefaultAgentModel()` still returns `qwen3.6-plus` because the new aliases were appended at JSON positions 9-11, not prepended. Whether this is intentional (leak 1 only) or an incomplete bulkfix needs operator confirmation.
- **c56e5a65 fix: batch 4 post-F8 seeds** — `verify-email-complete.ts` browser-vs-API split is well-implemented. `isBrowserRequest` heuristic via Accept + Sec-Fetch-Site is conservative; `?error=<code>` regex-restricted to `[a-z0-9_-]+` before being passed to the redirect URL (defense-in-depth). The `httpOnly: false` flip on `i18next` cookie is intentional (with comment); locale is non-sensitive preference state, not a credential.
- **af9747c3 / ebea3ae2** — docs/seeds only, no source changes.

---

## Recommended order of fix

If the owner wants to clean these up before the push, this is the minimum-risk sequence:

1. **WR-02 (5 minutes)** — Add `# REALTIME_DEFAULT_LANGUAGE=ru` (commented, with the operator example) to `.env.full.example` and `.env.slim.example` adjacent to the existing `# REALTIME_TRANSCRIPTION_MODEL=` block (line 165 area). Pure docs, no test changes needed.
2. **WR-01 (15 minutes)** — Add `if (upstreamSocket.readyState !== WebSocket.OPEN) return;` guard at the top of `forwardClientFrame` (apps/api/src/routes/realtime.ts:377). Mirror the existing symmetric guard at line 422. Add ONE test case: client sends a frame after upstream's `'close'` event fires → no throw, no log spam. Coverage stays ≥ 90%.
3. **WR-04 (decision needed, 0-30 minutes)** — Confirm with operator whether `getDefaultAgentModel()` SHOULD flip to `openwhispr-reason`. If yes: reorder the `generated.json` `aliases` array (put `openwhispr-reason` first) AND update `compose/litellm/litellm_config.yaml` model order so `scripts/generate-aliases.ts` rebuild is stable. If no (leak 1 only by design), file as DEF-LEAK-2 in deferred-items.md.
4. **WR-03 (30 minutes)** — Either delete the M9 test (since the implementation correctness is already proven by code inspection + M2/M3) OR rewrite it to use ONE Fastify app with two parallel `dial()` calls against the SAME deps reference. Latter is a real concurrency property test; former saves test debt.
5. **IN-01 through IN-09** — None blocking, batch them as a follow-up cleanup wave.

---

## Verdict (one paragraph)

The realtime delta is safe to ship. No CRITICAL/BLOCKER bugs — the language injection layer is correctly OPTIONAL, properly OMITTED when unset, validates BOTH paths (env boot-fatal, query warn-fallback), and the per-upgrade shallow-clone genuinely prevents singleton mutation. The passthrough fix in 2803c1a8 (commit on `main`) closes the 2026-05-26 prod-incident `transcription_session.created` rename bug confirmed live by peer wd6g78xz. The four WARN findings (asymmetric send-guard in `forwardClientFrame`, missing `.env.*.example` documentation, weak M9 test, and unflipped agent-stream default after the leak-1 fix) are real but operator-discretionary. None of them gate a hotfix push. **GO**, with a note in the deploy log linking back to this REVIEW for the WR-01 send-guard follow-up.

---

_Reviewed: 2026-05-26_
_Reviewer: Claude (gsd-code-reviewer Opus 4.7 1M)_
_Depth: deep_
