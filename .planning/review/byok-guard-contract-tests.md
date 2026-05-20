# Adversarial review — `packages/byok-guard/src/**` + `packages/contract-tests/src/**`

Branch `main` @ HEAD `6e43588` — pre-publication review.

## Summary

`byok-guard` is small and well-disciplined: the loud-fail boot guard correctly throws `BYOKGuardError` instead of `process.exit(1)` (process-boundary discipline), uses synchronous Pino destination to flush before throw, and centralises `redactUrl`. The redactor is reasonably solid (URL.username/password, query-cred params, AWS SigV4, JWT three-part, bearer-shape sweep on path + fragment).

The notable defects cluster on **api-key-shape coverage gaps in `redact-url.ts`** and on **the contract-tests package shipping test fixtures, test files, and a hardcoded password constant from its public `main` entry**. The latter is a LOCKER-03 / "test branches in production export" hazard once the artifact is published.

No catastrophic-backtracking regex was found. No suppressions (`as any`, `@ts-ignore`) anywhere in scope. No `TODO/FIXME/HACK` in scope. Guard utilities do not log secrets themselves — only the boot logger emits, and it emits a record built from a `redactUrl()` echo.

---

## Findings

### CRITICAL

#### CR-01 — `redactUrl` BEARER_SHAPES misses GitHub PATs, Tavily, Yandex, and AWS STS session-key prefixes
**File:** `packages/byok-guard/src/redact-url.ts:61-70`

The brief enumerates the shapes the redactor must cover; the implementation covers a subset:

| Shape | Status |
|---|---|
| `sk-…` (OpenAI) | covered |
| `sk-ant-…` (Anthropic) | covered |
| `sk-or-v1-…` (OpenRouter) | covered as a side-effect of `sk-` rule (verified) |
| `AIza…` (Google) | covered |
| `AKIA…` (AWS access key, permanent) | covered |
| `ASIA…` (AWS STS session keys, used by every presigned S3 URL with temp creds) | **missing** |
| `ghp_…` (GitHub PAT) | **missing** |
| `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` (GitHub OAuth/user/server/refresh) | **missing** |
| `tvly-…` (Tavily web-search; MEMORY.md confirms shipped in this repo) | **missing** |
| Yandex API key (`AQVN…` / `y0_…` shapes; MEMORY.md confirms shipped) | **missing** |
| JWT three-part `eyJ…` | covered |

The redactor IS the single source of truth (verified — no duplicate regex elsewhere; `apps/api/src/index.ts:115` imports from `@openwhispr/byok-guard`). A URL like `https://x/v1/secrets/ghp_AAAAA…/rotate` has `ghp_` embedded in a path segment, and `isCredentialParam` is name-based on query params only, so the path segment slips through unredacted. Same hazard for `tvly-…`, Yandex shapes, and `ASIA…` in S3 presigned-URL path style.

**Effect:** boot-time hint AND runtime structured-log fields (Pino `child` bindings echoing redacted URLs) can leak GitHub PATs, Tavily keys, Yandex keys, and AWS STS session tokens at info/fatal level. Defeats the redactor's stated purpose.

#### CR-02 — `sk-` length threshold `{20,}` permits short-key leak; partial-shape escapes
**File:** `packages/byok-guard/src/redact-url.ts:62-63`

`sk-[A-Za-z0-9_-]{20,}` requires ≥ 20 chars of body. OpenAI test/sandbox keys have been observed at ~16 chars; an OpenAI org may issue short-prefixed proxy keys (`sk-proxy-abc123…`). A 19-char-body `sk-…` survives the sweep verbatim. While production OpenAI keys are 51 chars, any third-party gateway issuing `sk-…`-shaped sandbox keys (LiteLLM virtual keys, for instance — `sk-1234567890` shape is common in operator docs) falls below the threshold. Recommend `{8,}` or pinning to the exact known issuer lengths.

---

### HIGH

#### HI-01 — `FIXTURE_PASSWORD = "test-PW-12345!"` is exported from the published package
**File:** `packages/contract-tests/src/helpers/sign-in-fixture.ts:18`

`package.json` declares `"main": "./src/index.ts"` and `"exports"."."` resolves there. `src/index.ts` does not re-export `FIXTURE_PASSWORD`, **but** the package has no `files:` allowlist, so `npm pack` would tar the entire `src/` tree, including `helpers/sign-in-fixture.ts` with the literal `"test-PW-12345!"`. Per the review brief: "Hardcoded test tokens / test e-mails in EXPORTED helpers = HIGH (LOCKER-03 violation in published surface)".

Additionally, `signInFixture({verified: false})` imports `pg`, opens an owner pool against `DATABASE_URL_OWNER`, and runs `UPDATE users SET email_verified = true ... ; ... SET email_verified = false` inside a `try/finally`. This is a **test-time privilege-escalation path shipped in the published artifact**. The DATABASE_URL_OWNER guard is correct, but the code path itself sits in the production tarball — any consumer with `DATABASE_URL_OWNER` set (a misconfigured CI runner, an operator typo) silently gains the ability to flip `email_verified` on arbitrary rows.

**Recommend:** move helpers + `*-shape.test.ts` files out of `src/` (e.g. into a sibling `harness/` directory), add a `files:` allowlist, and tighten `exports` to expose only the schema/error surface needed by external consumers.

#### HI-02 — `.test.ts` files live inside `src/` and ship in the published tarball
**File:** `packages/contract-tests/src/folders-shape.test.ts`, `notes-shape.test.ts`, `transcriptions-shape.test.ts`

`tsconfig.json` `"include": ["src/**/*.ts"]` compiles these into `dist/` whenever `tsc --build` runs. No `files:` allowlist in `package.json`, so `npm pack` tars them. Three vitest suites would ship in the artifact, bloating the tarball and shipping internal route enumerations (`PHASE_5_ROUTES` constants and assertions). Move to `tests/` or add a `files:` allowlist.

#### HI-03 — `contract-tests/src/schemas.ts` defines wire schemas that are NOT in `@openwhispr/wire-schemas` — silent drift surface
**File:** `packages/contract-tests/src/schemas.ts:50-262`

Verified `wire-schemas/src/index.ts` barrel: it re-exports `agent, api-keys, check-user, conversations, delete-account, diarization, folders, notes, openai-realtime-token, reason, settings, streaming-usage, test-only-seed-tenant, transcriptions, verification-status, web-search`. The contract-tests package, however, **owns its own private copies** of:

- `HealthResponse` (`schemas.ts:50-53`)
- `TranscribeRequestFields`, `TranscribeResponse` (`schemas.ts:67-89`) — note: `wire-schemas` has no `transcribe.ts`, so this may be unique-to-contract-tests legitimately, but then the **production route validator** drifts from the contract-test validator with no diff alarm.
- `TextDeltaChunk`, `ToolCallChunk`, `ToolResultChunk`, `FinishChunk`, `StreamChunk` (`schemas.ts:109-188`)
- `StreamingTokenResponse`, `DeepgramStreamingTokenResponse` (`schemas.ts:199-215`)
- `UsageResponse`, `StreamingUsageResponse` (`schemas.ts:232-242`)
- `OpenAIRealtimeTokenResponse` (`schemas.ts:258-262`) — note: `wire-schemas` HAS `openai-realtime-token.ts`. Compare and confirm parity, or remove the local copy and import from `wire-schemas`.

`ErrorEnvelope` (`schemas.ts:24`) is also locally defined. Production routes may use a different envelope schema and the contract suite would NOT catch drift.

**Recommend:** for each locally-defined schema, either (a) confirm there is no `wire-schemas` counterpart and document why the contract package owns it, or (b) replace with a `wire-schemas` import.

#### HI-04 — `negative-matrix.ts` route inventory is a static literal; stale entries silently pass; `TolerantEnvelope` weakens the contract
**File:** `packages/contract-tests/src/negative-matrix.ts:21-29, 55-141`

Two issues:

1. `PHASE_5_ROUTES` and `PHASE_2_4_BASELINE_ROUTES` are hand-curated lists. The file comment references a sanity test (`negative-matrix-enumeration.test.ts`) that allegedly enforces parity with the live `buildAllRoutes` output, but the test is out of scope to this review and the inventory itself is part of the public published surface. Routes added/removed in `apps/api` without updating these arrays produce **silent matrix gaps** — removed routes still 404 with the canonical envelope (the matrix still passes) and added routes are not probed.

2. `TolerantEnvelope` (`negative-matrix.ts:21-29`) accepts BOTH `{error: string}` AND `{error: {message, code?}}`. BACKEND_SPEC's default envelope is the string form; the structured form is reserved for one future site. By accepting both as equivalent, the matrix cannot detect a route mistakenly emitting structured-error where it should emit string-error. This weakens the negative-matrix contract.

#### HI-05 — `audioMultipartBody` reads from repo-root `tests/fixtures/audio/` that does not exist in the published tarball
**File:** `packages/contract-tests/src/helpers/multipart.ts:28-29`

`resolve(__dirname, "../../../../tests/fixtures/audio", filename)` walks four levels up from `packages/contract-tests/src/helpers/`, landing at the repo root's `tests/` directory. This works in-repo but **a published `@openwhispr/contract-tests` tarball does not bundle `tests/fixtures/audio/sample-1s.wav`**. Any external consumer who imports this helper crashes with `ENOENT` at the first call. Either bundle a sample fixture inside the package (e.g. `packages/contract-tests/fixtures/sample-1s.wav`) or move the helper out of `src/`.

---

### MEDIUM

#### ME-01 — Dead export: `harnessLoaded()`
**File:** `packages/contract-tests/src/index.ts:10-12`

Used only by `packages/contract-tests/tests/unit/loads.test.ts` (its own load-canary). Comment claims "Phase 0 harness shell"; phases 2-56 have shipped. Stale scaffolding. Recommend deletion or fold into a module-meta export.

#### ME-02 — Dead export: `STREAMING_HELPERS_PLACEHOLDER`
**File:** `packages/contract-tests/src/helpers/streaming.ts:7`

Cold-path placeholder. Comment says "Phase 4: implement once /api/agent/stream lands"; that route landed and this helper was never touched. Zero importers anywhere in repo. Delete or implement.

#### ME-03 — Exported types `BYOKFatalRecord` / `BYOKOverlay` / `BYOKErrorCode` / `AssertBYOKConfigOpts` have no external value-importers
**File:** `packages/byok-guard/src/index.ts:122,124,131,139`

Only `BYOKGuardError`, `assertBYOKConfig`, `redactUrl`, `createBootLogger` are imported elsewhere. Public types widen the API-compat surface for a small library. Recommend marking internal (don't re-export from index) unless an external consumer needs them.

#### ME-04 — `MalformedUpstreamEnvelopeError.getBodyText()` re-exposes truncated body via public accessor
**File:** `packages/contract-tests/src/errors.ts:44-46`

Body IS truncated at construction (good — matches LOCKER-05 intent). The class also overrides `toJSON()` to omit `bodyText` (good). But the public `getBodyText()` accessor bypasses that defence at any call-site that forwards into a logger. Worker-thread error serialization, pino `serializers.err`, and Sentry `extra` will not see it. Recommend gating this method via a build-time flag or documenting the call-site policy ("never log the result").

#### ME-05 — `redactUrl` returns the literal `"<unparseable-url>"` on `new URL()` throw
**File:** `packages/byok-guard/src/redact-url.ts:153-155`

Not a leak, but a debuggability gap: an operator sees `<unparseable-url>` with zero context. Recommend echoing a safe shape hint like `<unparseable-url:scheme=s3 len=42>` after a shape-sniff that does not echo credentials.

#### ME-06 — `pgbouncerRow` forces `DATABASE_URL` always-required, even when unrelated callers exercise the guard
**File:** `packages/byok-guard/src/index.ts:259-269`

Intentional per matrix comment ("required for all profiles"), but documented here to discourage a future "fix". Apps/api tests that invoke `assertBYOKConfig({})` must set `DATABASE_URL` even if their assertion targets the storage/observability/ingress rows.

---

### LOW

#### LO-01 — Inner `const raw` shadows outer `raw` parameter inside fragment branch
**File:** `packages/byok-guard/src/redact-url.ts:139`

`export function redactUrl(raw: string)` → `const raw = u.hash.slice(1);` inside `if (u.hash)`. Benign (outer no longer needed) but reads as a bug. Rename inner to `frag` / `hashBody`.

#### LO-02 — `BEARER_SHAPES` declared as mutable `RegExp[]`
**File:** `packages/byok-guard/src/redact-url.ts:61`

`const BEARER_SHAPES: RegExp[] = [...]` — contents are mutable. Use `readonly RegExp[]` or `as const` for defence-in-depth against module-scope mutation.

#### LO-03 — `audioMultipartBody` boundary uses `Math.random()` (non-cryptographic)
**File:** `packages/contract-tests/src/helpers/multipart.ts:26`

Fine for multipart boundary collision-avoidance. No action.

#### LO-04 — `cookie-jar.ts` ignores `tough-cookie` set-cookie errors via empty catch
**File:** `packages/contract-tests/src/helpers/cookie-jar.ts:43-45`

Comment justifies it, but empty-catch reads as a smell. At minimum `void e;` or `/* swallow */`. Cosmetic.

#### LO-05 — `xffCounter` rollover comment is correct but verbose
**File:** `packages/contract-tests/src/helpers/sign-in-fixture.ts:43`

No action.

#### LO-06 — JWT regex requires non-empty third segment, excluding unsigned JWTs
**File:** `packages/byok-guard/src/redact-url.ts:69`

Acknowledged in comment. Unsigned JWTs in URLs are vanishingly rare. No action.

#### LO-07 — `redactUrl` `searchParams.set` collapses repeated params to a single value
**File:** `packages/byok-guard/src/redact-url.ts:117`

Acknowledged in comment ("acceptable for log redaction"). No action — flagged so future contributors don't try to round-trip the URL through a signing pipeline.

---

## Dead code / cold-path placeholders

| Symbol | File:line | Action |
|---|---|---|
| `harnessLoaded()` | `contract-tests/src/index.ts:10` | Phase-0 scaffold, only used by self-test. Delete. |
| `STREAMING_HELPERS_PLACEHOLDER` | `contract-tests/src/helpers/streaming.ts:7` | Phase-4 placeholder never implemented. Delete or implement. |
| `BYOKFatalRecord`, `BYOKOverlay`, `BYOKErrorCode`, `AssertBYOKConfigOpts` | `byok-guard/src/index.ts:122-147` | No external value-importers. Mark internal or narrow surface. |
| `MalformedUpstreamEnvelopeError.toJSON()` | `contract-tests/src/errors.ts:49` | Live LOCKER-05 defence. Keep. |
| `AUTH_URL` mirror default | `contract-tests/src/env.ts:19` | Live, working as documented. Keep. |

---

## Suppressed warnings / linter bypasses

None found in scope.
- No `as any`, no `as unknown as`, no `@ts-ignore`, no `@ts-nocheck`, no `@ts-expect-error`.
- No `eslint-disable`.
- No `git commit --no-verify` artefacts.
- No `pnpm --no-frozen-lockfile` traces.

---

## Single source of truth (regex centralisation) — verdict

`byok-guard/src/redact-url.ts` IS the only place defining URL-bearer-shape redaction regexes. Verified via grep across `apps/api/src`, `apps/worker/src`, `packages/*/src` (excluding `dist/`, test fixtures, and the documentary `<REDACTED-…>` strings in `apps/api/src/routes/tokens/__fixtures__/`). The orthogonal concern of pino `redactPaths` field-name lists lives in `@openwhispr/observability` (`REDACT_PATHS`) and is correctly separate — those are pino-path strings, not regexes. **No cross-file dual-flag needed.**

---

## CLAUDE.md hard-rule 1 audit

In-scope code does not touch production SQL/migrations/route handlers. The `sign-in-fixture.ts` `UPDATE users SET email_verified=…` flip is the closest analog — it mutates test-fixture user rows in the contract-test DB, not production code or migrations, and the flip is reverted in `finally`. The rule is not violated, but this helper is itself a HIGH publish-surface concern per HI-01.

---

## Severity roll-up

- CRITICAL: 2 (CR-01 missing api-key shapes for GitHub/Tavily/Yandex/ASIA; CR-02 sk- length-threshold leak)
- HIGH: 5 (HI-01 hardcoded password + privileged DB flip in published surface; HI-02 .test.ts in src/; HI-03 wire-schemas drift surface; HI-04 stale route inventory + tolerant envelope; HI-05 fixture path foot-gun)
- MEDIUM: 6
- LOW: 7

**Recommended publish-blockers:** CR-01, HI-01, HI-02. Others can ship with follow-up issues filed.
