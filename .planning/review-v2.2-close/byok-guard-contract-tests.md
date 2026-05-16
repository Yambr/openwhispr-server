# Re-Review (v2.2 close): byok-guard + contract-tests

Branch: main @ b830cc4
Scope: `packages/byok-guard/src/**` + `packages/contract-tests/src/**`
Prior review: `.planning/review/byok-guard-contract-tests.md` (HEAD @ 1832f28; HIGH=3 MEDIUM=5 LOW=4)
Phase deltas: Phase 40 (sub-fixes 40.a, 40.b, 40.c) + Phase 41.g Task 2 (`packages/observability/tests/unit/redact-providers-parity.test.ts`, out-of-scope here but the parity discipline is the model)

## Summary
- Files: 9 (byok-guard: 2; contract-tests: 7) — unchanged scope
- Findings (this pass): CRITICAL=0 HIGH=0 MEDIUM=2 LOW=3
- Disposition: **publish-ready for v2.2 milestone close**. All three HIGH findings from the prior review are closed in production code (commits `8ae973e`, `06806f8`, `9073b8c`) with new tests pinning each fix. Remaining items are tracked carry-over of pre-existing MEDIUM/LOW dead-code + helper-hygiene gaps; none of them block release.

## Closure-delta vs prior review

### HIGH

**H-01 (package-boundary inversion) — CLOSED**
Commit `8ae973e feat(40a): move route schemas from contract-tests to wire-schemas`.
Verified:
- `packages/wire-schemas/src/{check-user,verification-status,delete-account,diarization,reason}.ts` now own the schemas formerly in `contract-tests/src/schemas.ts`.
- `packages/contract-tests/src/schemas.ts:31-40` re-exports them via `export { … } from "@openwhispr/wire-schemas"` — test consumers keep their import paths, production handlers no longer transitively pull a test-helper package.
- `apps/**` no longer imports from `@openwhispr/contract-tests` (verified by `grep -rn "from \"@openwhispr/contract-tests\"" apps/` → no matches).
Note (carry-forward, not blocking): the file header on `schemas.ts:2` still says "Single zod source of truth for Phase 2 wire shapes" — narratively wrong now that wire-schemas owns the contract; see M-01 below.

**H-02 (`redactUrl` only masks `URL.password`) — CLOSED**
Commit `06806f8 feat(40b): redactUrl masks query secrets userinfo bearer paths`.
Verified at `packages/byok-guard/src/redact-url.ts:71-104`:
- `URL.username` AND `URL.password` are masked (`redact-url.ts:74-79`).
- Query-string credential params (`isCredentialParam`, lines 33-48) cover: `key`, `code`, `secret`, `signature`, `password`, `token`, `*_token`, `access_token`, `refresh_token`, `api_key | apikey | api-key | *_api_key`, AWS SigV4 (`x-amz-signature | x-amz-credential | x-amz-security-token`). All case-insensitive (`.toLowerCase()` at line 34).
- Bearer-shape sweep on `u.pathname` (lines 51-56, 95-99) covers `sk-ant-…`, `sk-…`, `AIza…`, `AKIA…`. `sk-ant-` regex declared before `sk-` so longest-prefix wins (the comment on line 93 captures the ordering rationale; verified — `BEARER_SHAPES` array iteration is insertion-ordered).
- Header comment is now consistent with behavior — `redact-url.ts:9` declares this file the source of truth post-Phase-40; the vendored `apps/api/src/lib/redact-url.ts` is the divergent copy now (see M-02).
- Test coverage: `redact-url-completeness.test.ts` (50 cases pinned across query/userinfo/path/SigV4/invariants) + `redact-url-parity.test.ts` walks `git grep 'process.env.*_API_KEY'` and asserts each discovered env's lower-cased query-param form is masked. Adding a new `process.env.FOO_API_KEY` reference anywhere in `apps/**/src` or `packages/**/src` without teaching `redactUrl` to mask `?foo_api_key=…` fails the parity test — drift-as-failure as the prior review asked for.

**H-03 (`fetchAndParse` silent-skip branch) — CLOSED**
Commit `9073b8c feat(40c): fetchAndParse enforces envelope on non-2xx responses`.
Verified at `packages/contract-tests/src/helpers/http.ts:25-68`:
- `text` is parsed once; `parsedOk` distinguishes "parsed to a JSON value" from "parse failed".
- On `!res.ok`, the guard at line 42 (`if (!parsedOk || typeof parsed !== "object" || parsed === null)`) throws `MalformedUpstreamEnvelopeError` for empty bodies, raw strings, and non-object JSON (e.g. `null`, `true`, arrays — all rejected). The three originally-silent cases (text/plain, empty, invalid JSON) now throw.
- The typed error class at `packages/contract-tests/src/errors.ts:18-57` follows LOCKER-05 discipline: `bodyText` is a `#private` field truncated to 200 chars at construction, accessed only via `getBodyText()`, and `toJSON()` strips the body — so structured-clone / `JSON.stringify(error)` log paths cannot leak the body text.
- `MalformedUpstreamEnvelopeError` is re-exported from `packages/contract-tests/src/index.ts:8` so consumers can `expect(...).rejects.toBeInstanceOf(...)` without reaching into a private subpath.

### MEDIUM — disposition

- **M-01 (schemas.ts duplication risk)** — **REDUCED, carry-forward.** With H-01 closed the file now re-exports rather than duplicates; duplication risk is gone for the 7 schemas moved (`Check{User…}, Delete…, Diariz…, Reason…, Verif…`). However `HealthResponse`, `TranscribeRequestFields`, `TranscribeResponse`, `TextDeltaChunk`, `ToolCallChunk`, `ToolResultChunk`, `FinishChunk`, `StreamChunk`, `StreamingTokenResponse`, `DeepgramStreamingTokenResponse`, `UsageResponse`, `StreamingUsageResponse`, `OpenAIRealtimeTokenResponse`, `ErrorEnvelope` still live in `contract-tests/src/schemas.ts` only. If any of these are referenced from production routes today, the H-01 boundary inversion repeats for them. Spot-check needed (out of scope here — flagged for v2.3 hygiene). The header comment at line 2 ("Single zod source of truth") is now inaccurate.
- **M-02 (`harnessLoaded()` dead-code)** — **CARRY-FORWARD.** Still only consumed by `tests/unit/loads.test.ts`. Unchanged from the prior review.
- **M-03 (`STREAMING_HELPERS_PLACEHOLDER`)** — **CARRY-FORWARD.** Still a Phase-2 stub with no real importers (Phase 4 work didn't replace it). Unchanged.
- **M-04 (`BACKEND_URL_EXPLICIT` only kept alive by its own coverage test)** — **CARRY-FORWARD.** Still only referenced from `env.ts` itself + the dynamic re-import coverage test. Unchanged.
- **M-05 (`buildHint`'s `redactedEcho` branch)** — **CARRY-FORWARD.** `index.ts:125-131` still has only one of five rows passing `redactedEcho` (storage row, line 158). Behavior is correct; the surface is partially-dead but not buggy.

### LOW — disposition

- **L-01 (`signInFixture` row-count assertion)** — CARRY-FORWARD; unchanged at `helpers/sign-in-fixture.ts:144-149`.
- **L-02 (`cookie-jar.ts` fallback)** — CARRY-FORWARD; unchanged at `helpers/cookie-jar.ts:33-39`.
- **L-03 (`audioMultipartBody` filename interpolation)** — CARRY-FORWARD; unchanged at `helpers/multipart.ts:31`.
- **L-04 (`Math.random()`-seeded XFF counter)** — CARRY-FORWARD; unchanged at `helpers/sign-in-fixture.ts:43`.

## New findings (this re-review)

### MEDIUM

**M-NEW-01 — Two `redactUrl` copies; the vendored `apps/api/src/lib/redact-url.ts` is now divergent (and weaker)**
File: `apps/api/src/lib/redact-url.ts:32-42` vs `packages/byok-guard/src/redact-url.ts:71-104`.
The byok-guard header (line 9) explicitly declares itself the SOURCE OF TRUTH post-Phase-40, but the `apps/api/src/lib` copy was NOT updated: it still only masks `URL.password` and ignores query-string credentials, userinfo username, and bearer-shaped path segments. Concrete leak path: `apps/api/src/index.ts` bootstrap catch arms log `redactUrl(VALKEY_URL)` / `redactUrl(LITELLM_BASE_URL)` — if either env carries a presigned URL or an `?api_key=` query string (plausible for the LiteLLM Bedrock-proxy override form in `docs/litellm-target-spec.md`), the query string is logged verbatim to stderr → Loki → Grafana. Fix options: (a) delete the vendored copy, repoint `apps/api/src/index.ts` to import from `@openwhispr/byok-guard` (reverses the workspace-boundary justification but is now safe since byok-guard is already a dependency of apps/api), or (b) port the Phase-40 logic across verbatim and add a divergence-fails-CI test mirroring `redact-url-parity.test.ts` across BOTH copies. The prior review (note bullet 2) flagged this exact divergence risk as a hypothetical; Phase 40 has now realized it.

**M-NEW-02 — `cookie-jar.ts` swallows `setCookie` errors silently AND the `getSetCookie()` fallback path is unreachable on Node 24**
File: `packages/contract-tests/src/helpers/cookie-jar.ts:33-46`.
Two related hygiene issues:
1. `try { await jar.setCookie(sc, url, { ignoreError: true }) } catch { /* swallow */ }` — the outer try/catch + `ignoreError:true` combination silently drops every parse error. If a server emits a malformed `Set-Cookie` (missing `=`, bad Domain attribute, etc.), the contract test will run as if no session was established and fail downstream with an opaque 401 instead of "server emitted invalid Set-Cookie at line N". Fix: emit a `console.warn` on the swallowed error (test-time only, no observability surface to leak into).
2. Same finding as the prior L-02 but elevated to MEDIUM because the `getSetCookie` feature-detect is dead code under Node 24 LTS (mandated by the stack pick at `CLAUDE.md`): undici always exposes `getSetCookie`. The fallback at lines 37-39 (`res.headers.get("set-cookie")`) is genuinely incorrect for multi-cookie responses (WHATWG fetch joins on `, ` which tough-cookie cannot parse) — dead branch that would be a real bug if it ever ran.

### LOW

**L-NEW-01 — `MalformedUpstreamEnvelopeError.getBodyText()` is public surface but only the error class uses it**
File: `packages/contract-tests/src/errors.ts:44-46`.
Inspection target only; no production caller. Acceptable, but consider documenting intent or marking the method `/** @internal */` so consumers don't grow log statements that exfiltrate the truncated body. The LOCKER-05 toJSON discipline is correct — the risk is a future test author writing `console.log(err.getBodyText())` and shipping a secret to a CI log.

**L-NEW-02 — `redact-url-parity.test.ts` uses `execSync('git grep …')` with a string command line**
File: `packages/byok-guard/tests/unit/__tests__/redact-url-parity.test.ts:30-34`.
The command is a static literal with no interpolation, so there is no injection surface today, but per LOCKER-06 (defence-in-depth shell-credential-interpolation lint) the canonical form is `execFileSync('git', ['grep', '-hoE', …], { shell: false })`. Test-only, low priority — argv-array form keeps tests aligned with the production-code invariant and removes the "is this command shell-quoted correctly?" review burden.

**L-NEW-03 — `redact-url-parity.test.ts` silently swallows `git grep` failures and depends on a sanity assertion to fail-loud**
File: `packages/byok-guard/tests/unit/__tests__/redact-url-parity.test.ts:35-37`.
The `catch { out = "" }` masks any error from `git grep` (non-zero exit when no matches found is the documented behavior of `git grep`; OK), BUT also masks a missing `git` binary, a non-git CWD, or a permissions failure. The sanity test at line 49 (`expect(envVars.length).toBeGreaterThan(0)`) catches the empty-result case, so the suite does fail closed if grep silently breaks — but the error message ("expected 0 to be greater than 0") is unhelpful. Either log the swallowed error to stderr OR check `error.status !== 1` (exit 1 = no-match, expected) and rethrow otherwise.

## Dead code (current)

- `packages/contract-tests/src/index.ts:10` — `harnessLoaded()` (carry-forward M-02).
- `packages/contract-tests/src/helpers/streaming.ts:7` — `STREAMING_HELPERS_PLACEHOLDER` (carry-forward M-03).
- `packages/contract-tests/src/env.ts:27` — `BACKEND_URL_EXPLICIT` (carry-forward M-04).
- `packages/contract-tests/src/helpers/cookie-jar.ts:37-39` — `getSetCookie` fallback path unreachable on Node 24 (M-NEW-02).
- `packages/byok-guard/src/index.ts:127` — partially-dead `redactedEcho` branch (carry-forward M-05).

No TODO/FIXME/HACK/XXX/TEMP/WORKAROUND comment markers found in either package's `src/`.

## Suppressed warnings / hardcodes

None added since the prior review. Spot-checked:
- No new `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `as any`, `as unknown as`.
- `cookie-jar.ts:34-36` retains the same two narrowing casts; defensible (Headers feature-detect), not suppressions.
- No hardcoded production credential shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`) in scope. `redact-url-completeness.test.ts` uses obviously-synthetic placeholders (`sk-fakefakefakefakefakefake`, `AKIATESTFAKEFAKE…`, `AIzaSyCCCC…`) — acceptable test fixtures.
- Fixture password `test-PW-12345!` (`sign-in-fixture.ts:18`) unchanged; still tied to `packages/data/src/seed/conformance.ts`.
- No hardcoded real URLs; `http://api.localhost` defaults in `env.ts` are documented Traefik defaults.

## Contract-tests does not pull secrets into production surface

Verified explicitly (the prompt's headline concern):
- `apps/**/src/**` has zero `from "@openwhispr/contract-tests"` imports.
- `packages/contract-tests/package.json` is not listed in any production `apps/{api,worker}/package.json` `dependencies` block (only `devDependencies` / workspace-test orchestration).
- The schemas production routes consume now resolve through `@openwhispr/wire-schemas` directly (`packages/wire-schemas/src/{check-user,reason,diarization,verification-status,delete-account,…}.ts`). `contract-tests/src/schemas.ts` is now a TEST-SIDE re-export shim — production runtime never loads it.
- Test-only deps (`tough-cookie`, `pg` for sign-in fixture, `zod` at boundary) remain isolated to `packages/contract-tests` and its consumers in `tests/`. No transitive prod pull-in path detected.

## Parity-test discipline (Phase 41.g Task 2 observation, in-scope as a model)

The prompt asks about parity-test enforcement. The byok-guard side has it (`redact-url-parity.test.ts` walking the codebase for `process.env.*_API_KEY` references and asserting each masks). The observability-side twin (`packages/observability/tests/unit/redact-providers-parity.test.ts`, Phase 41.g Task 2, `be0f5b6`) is out of this review's file scope but established the same drift-as-failure pattern at the observability redactor's provider list. Both parity tests share the same architecture (grep the prod source, derive expected redactor inputs, fail when redactor doesn't cover discovered drift). The byok-guard parity test would benefit from L-NEW-02 + L-NEW-03 hygiene; both gaps are below the BLOCKER threshold.

## Severity calibration

- **No CRITICAL.** All three prior HIGH findings closed with passing tests; no new vulnerability introduced.
- **No HIGH this pass.** The closest candidate is M-NEW-01 (vendored `apps/api/src/lib/redact-url.ts` divergence). I held it at MEDIUM because: (a) the leak path requires an operator to put a credential-bearing query string in `VALKEY_URL` / `LITELLM_BASE_URL`, which is unusual (these URLs canonically carry credentials in `userinfo`, which the old helper DOES mask); (b) no parity test failure is firing today because that file is outside the parity test's grep scope by design (the parity test guards the byok-guard copy specifically). If the hunt-list rubric strictly enforces "any documented source-of-truth divergence between two copies of a redactor = HIGH", reclassify M-NEW-01 upward.
- **MEDIUM and LOW are non-blocking** for v2.2 milestone close. They are recommended for the next hygiene phase, not for milestone gating.

## Recommendation

**Ship.** Phase 40 cleanly closed the three prior HIGH findings with appropriate test coverage. The remaining MEDIUM/LOW items are pre-existing hygiene gaps (M-02/M-03/M-04/M-05 carry-forwards) plus two new MEDIUMs (vendored-redactor divergence M-NEW-01; cookie-jar swallow M-NEW-02) — none of them block v2.2. Address M-NEW-01 + the dead-code sweep (M-02/M-03/M-04) in the next residual-high pass.
