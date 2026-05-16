# Test-Quality Audit — openwhispr-server (HEAD `3df1060`, audit date 2026-05-17)

Adversarial review of `apps/**/tests`, `packages/**/tests`, `tests/**`. Mandate: catalog tests that **PASS but assert nothing meaningful**, or assert the wrong thing, or were written to be green rather than to catch regressions. Two confirmed escapes triggered this audit:

1. **Migration 0017 setup_state GRANT** — route test used owner-pool (BYPASSRLS); the permission boundary was invisible to the suite.
2. **`yaml` dynamic-require in api ESM bundle** — no test ever imports the production `dist/index.*` artifact, so the build-time codegen / runtime-require split was never exercised.

The findings below trace the same failure shape across the tree. Severity:

- **HIGH** = hides a real production regression class (would let an analogous bug ship green).
- **MEDIUM** = false-confidence test (assertion is real but too loose, or the wiring is mocked enough that drift would not flag).
- **LOW** = stylistic / convention drift; no realistic regression hidden.

---

## HIGH — hides a real production regression class

### H-01. `setup_state` / capabilities route tests run as `openwhispr_owner` (BYPASSRLS), not as `openwhispr_app`. This is the exact pattern that masked the 0017 GRANT bug.

- `apps/api/src/routes/__tests__/setup.ts:130` — the shared harness for the setup-state, capabilities, and setup-admin route suites:
  ```ts
  const ownerPool = new Pool({ connectionString: ownerUri });
  const db = drizzle(ownerPool);
  ```
  Comment at line 76–82 acknowledges the gap explicitly:
  > "Routes that require RLS gating (notes, audit_log writes) would additionally open an app-role pool; the capability routes do **NOT**, so we keep the harness lean."
- Every test in `apps/api/tests/unit/routes/__tests__/setup-state.test.ts`, `…/capabilities.test.ts`, `…/setup-admin.test.ts`, `…/setup-admin-rollback.test.ts` consequently runs handlers under a role that **bypasses RLS and holds blanket GRANTs**. The permission boundary the production handler sees in compose (pgbouncer → `openwhispr_app`) is invisible. Direct cause of the post-merge hot-fix shipped in commit `3df1060`.
- The harness even has the path of least resistance present: `openwhispr_app` is created on line 102 with login privileges — switching `db` to an app-pool would have caught the bug in the same test invocation.

### H-02. Production ESM bundle of `apps/api` is never imported by any test. The `yaml` dynamic-require crash (hot-fix `d3418d0`) was guaranteed to escape.

- `find apps/api/tests packages/data/tests -name "*bundle*"` → empty.
- `grep -rn "dist/\|tsup.*build" apps/api/tests packages/data/tests` returns only a single source-code comment, no actual import of the built artifact.
- Every route test imports TypeScript sources directly (`../../../src/routes/...`). The tsup/esm output path with its CommonJS interop / dynamic-`require` shims is never loaded under `node --experimental-vm-modules` (or any module loader) inside a test, so any "library X swapped from static to dynamic require in production bundling" regression ships green.
- Suggested coverage class: a smoke test that does `await import('../../dist/index.mjs')` (or equivalent) inside each long-running app's CI, guarded on `pnpm --filter @openwhispr/api build` having run.

### H-03. `audit.test.ts:437-451` — `try { await recordAudit(...) } catch {}` swallows ANY error, including assertion failures fired from inside the production code path.

- `apps/api/tests/unit/lib/audit.test.ts:437-451`:
  ```ts
  it("throws BEFORE the DB INSERT (no row written on Cyrillic hit)", async () => {
    const before = await countRows("admin.tenant_suspended");
    try {
      await withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "admin.tenant_suspended", { … });
      });
    } catch {
      // expected
    }
    const after = await countRows("admin.tenant_suspended");
    expect(after).toBe(before);
  });
  ```
- The intent ("throw BEFORE the INSERT") is never asserted — if `recordAudit` silently swallowed the Cyrillic input, the test would still pass on the row-count delta of 0 (the INSERT was simply never attempted, *or* the row was inserted and then rolled back, *or* the function silently no-op'd). The catch must capture the error and assert `err instanceof AuditCyrillicError`.

### H-04. `transcribe.test.ts` / `reason.test.ts` use hand-rolled fake DB that intercepts `drizzle.transaction.execute` — direct violation of CLAUDE.md "no mocks of internal logic" rule.

- `apps/api/tests/unit/routes/transcribe.test.ts:43-78` and `apps/api/tests/unit/routes/reason.test.ts:44-79` define `makeFakeDb()` that re-implements `tx.execute` to record SQL-template fragments and always returns `{ rows: [] }`.
- The same harness file `apps/api/src/routes/__tests__/setup.ts:7-9` openly states the rule the transcribe/reason tests violate:
  > "the previous fake-db pattern (`makeFakeDb` intercepting drizzle's `transaction.execute`) violated this rule because drizzle's tx/execute IS internal logic — the process boundary is the libpq driver below it."
- Consequences:
  - The `usage_ledger ON CONFLICT` clause is asserted by **string-grep on a reconstructed SQL fragment**, not by actually inserting twice into Postgres and observing one row.
  - The "RLS-enforced via app.tenant_id GUC inside `withTenant`" guarantee is reduced to "the test sees a `set_config` substring in the captured SQL" — the GUC was never actually bound; no policy was actually consulted.
  - If `withTenant` silently stopped calling `set_config` (e.g. due to a future refactor that pushed it to a connection-pool middleware), the assertion `recorded.find((r) => /set_config/i.test(r.sql))` would still match a no-op SQL fragment depending on how the recorder reconstructs the template — and even if it didn't match, the test "passes" assertively but the production code path stops gating tenants without a louder signal.
- Same anti-pattern reproduced verbatim in:
  - `apps/api/tests/unit/routes/check-user.test.ts:99-203` (`makeFakeDb(() => …)`)
  - `apps/api/tests/unit/routes/delete-account.test.ts` (`recorded.length).toBe(0)` assertions, lines 138/155/184 — see H-05)
  - `apps/api/tests/unit/routes/desktop-signin.test.ts`
  - `apps/api/tests/unit/routes/__tests__/note-recording-config.test.ts:30-72`
  - `apps/api/tests/unit/routes/__tests__/stt-config.test.ts:34-72`
  - `apps/api/tests/unit/routes/__tests__/streaming-usage.test.ts`
  - `apps/api/tests/unit/routes/__tests__/registration.test.ts`
  - `apps/api/tests/unit/routes/__tests__/ledger-idempotency.property.test.ts`
  - `apps/api/tests/unit/routes/test-only.test.ts`
  - `apps/api/tests/unit/routes/verification-status.test.ts`

The "integration" cousins under `…/__tests__/*.integration.test.ts` (e.g. `web-search.integration.test.ts`, `usage.integration.test.ts`, notes / folders / conversations CRUD) DO use the real testcontainer harness — so these are knowingly two-tier suites. The risk is the same: every route whose only test is the fake-DB variant has zero real-Postgres coverage.

### H-05. `delete-account.test.ts` "no DB writes" assertion (`recorded.length).toBe(0`) only proves the fake recorder is empty — the production handler could still ALTER global state (cookies cleared, audit-log INSERT enqueued through a different path) and the test would not notice.

- `apps/api/tests/unit/routes/delete-account.test.ts:138,155,184`:
  ```ts
  expect(recorded.length).toBe(0);
  ```
  is asserted on the **fake recorder array**, not on the real DB. Combined with H-04 this means a future regression that wires deletion through (say) a queue write or a Redis SET would slip silently because neither call goes through the captured `execute()`.
- Pair this with the cascade-order assertion at line 116-119 (`expect(delUsersIdx).toBeGreaterThan(insertAuditIdx)`) — this is **string-grep-on-template** ordering, not transactional ordering. A handler reordered to `INSERT audit_log` AFTER `DELETE users` would still pass if the grep order in `recorded` happens to match.

### H-06. Realtime contract suite's "non-401" assertion (`packages/contract-tests/tests/unit/realtime.test.ts:106`).

- File comment (lines 15-17): "the handshake either succeeds (101) or closes with a defined upstream code — but it MUST NOT return 401. That single assertion proves auth + proxy chain are wired end-to-end."
- Code (line 106): `expect(result.status).not.toBe(401);`
- Failure modes that pass:
  - Upstream returning **500 / 502 / 503** because LiteLLM is misconfigured.
  - WSS upgrade producing a malformed close frame (test caught it as `status !== 401`).
  - The proxy plugin throwing and Fastify returning the default 500 page.
- Replace with: `expect([101, 200, 426, 502]).toContain(result.status)` or whatever the spec'd close codes are. The current matcher is too permissive to be evidence.

### H-07. Better-Auth × envelope-encryption "wiring smoke" passes both on success AND on a 23502 NOT NULL error.

- `apps/api/tests/unit/__tests__/better-auth-encryption.integration.test.ts:199-220`:
  ```ts
  try {
    await auth.api.signUpEmail({ … });
    expect(true).toBe(true);
  } catch (err) {
    const msg = (err as Error).message;
    expect(msg).not.toMatch(/lens:/);
    expect(msg).not.toMatch(/wrapAdapter/);
    expect(msg).toMatch(/Failed to create user|tenant_id|23502/i);
  }
  ```
- This is a Phase-32-deferred test that is documented as such — but the on-success branch (`expect(true).toBe(true)`) is a no-op that hides any regression that flips the route to a different error class **after** Phase 33-05 lands and the test stops hitting the catch. The test was promoted to "wiring smoke" status without locking in *which* of the two states is current.
- Same anti-pattern: `audit.test.ts:434` (`expect(true).toBe(true)` after "No throw => success"), `setup-admin-rollback.test.ts:261` (`expect(true).toBe(true)` for a logger-side-effect assertion).

### H-08. `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` is the boot test — and it mocks 13 production modules including `auth.js`, `routes/index.js`, `lib/mint-bearer.js`, `lib/token-rotation.js`, `error-handler.js`, `routes/health.js`, `routes/probes.js`, `lib/dep-check.js`, `plugins/served-by.js`, `plugins/rate-limit.js`, `plugins/zod-type-provider.js`, `plugins/request-log.js`, `middleware/dual-auth.js`, plus `@openwhispr/data/client` and `fastify` itself.

- Lines 71-146. The test that nominally covers "the entrypoint wires the DB through correctly" mocks every dependency the entrypoint actually orchestrates. The remaining assertion (lines 189-197): `expect(captured.buildAuthArg?.db).toBeDefined()` + `expect((captured.buildAuthArg?.db as { pool?: unknown })?.pool).toBeUndefined()` — i.e. "the entrypoint passed *something* to buildAuth and that something didn't have a `.pool` property."
- This is the kind of unit-test that passes when the wire-up is broken, because the only contract under test is a vi.mock spy capture. Any future regression where buildAuth is invoked with `null`, `undefined`, or a wrong shape that happens to lack `.pool` (e.g. raw connection string) would slip through.

---

## MEDIUM — false-confidence

### M-01. `length > 0` as the **only** content assertion in 30+ contract / coverage tests.

Representative examples:
- `packages/contract-tests/tests/unit/transcribe.test.ts:43` — `expect(parsed.text.length).toBeGreaterThan(0)` (any non-empty whisper response passes).
- `packages/contract-tests/tests/unit/streaming-token.test.ts:59` — same on `parsed.token.length`.
- `packages/contract-tests/tests/unit/deepgram-streaming-token.test.ts:49` — `parsed.token.length`.
- `packages/contract-tests/tests/unit/agent-stream.test.ts:89,108` — `lines.length).toBeGreaterThan(0)` for NDJSON stream.
- `packages/contract-tests/tests/unit/diarization.test.ts:47,100` — `parsed.segments.length` (no shape / monotonicity assertion on the segments themselves).
- `apps/api/tests/unit/routes/agent/stream.test.ts:238,600,605` — `lines.length > 0`, `created.length > 0`, `listenerCount("close") > 0`.
- `apps/api/tests/unit/error-handler.test.ts:151` — `body.error.length).toBeGreaterThan(0)` (matches any error message including stack traces).
- `apps/api/tests/unit/__tests__/error-handler-better-auth-apierror.test.ts:66` — same matcher; defeats the entire point of testing the envelope shape.
- `apps/api/tests/unit/__tests__/auth-send-reset-password.test.ts:165,283` — `request_id.length > 0`, `subject.length > 0`.
- `apps/web/tests/unit/lib/__tests__/zod-i18n.test.ts:41,71,81` — `issues[0]?.message.length > 0` (passes for the default English message even if the i18n hook didn't fire).
- `apps/web/tests/unit/locales/__tests__/coverage.test.ts:103,121` — locale-key non-empty check (does not verify the value is the i18n string vs. the key fallback).
- `apps/worker/tests/unit/i18n/__tests__/template-renderer.test.ts:97,98,115,116` — `subject.length`, `text.length` only.
- `packages/litellm-client/tests/unit/model-aliases.test.ts:196` — `aliases.length > 0` (any non-empty alias map satisfies; a regression that drops 95% of aliases passes).
- `packages/contract-tests/tests/unit/note-recording-config.test.ts:27,29,32,35` — `maxDurationSeconds > 0`, `sampleRateHz > 0`, `allowedFormats.length > 0`, `fmt.length > 0` (no bound checking, no enum check).

Bug-class hidden: a regression that returns a single-character or single-element response (e.g. truncated JSON, off-by-one slicing) ships green.

### M-02. `toBeDefined()` / `toBeUndefined()` on values whose types are non-nullable.

Representative examples (full grep returned 60+ hits; selected by severity):
- `apps/api/tests/unit/plugins/rate-limit.test.ts:403,414,425,443,492,663,837` — `expect(r.headers["x-ratelimit-limit"]).toBeDefined()` etc. The headers are always strings post-plugin; the question is "what is the value?" — never asserted.
- `apps/api/tests/unit/plugins/served-by.test.ts:29-30` — `expect(ra.headers["x-served-by"]).toBeDefined()` × 2 (does not check the header *value*).
- `apps/api/tests/unit/routes/realtime.test.ts:283,377,387` — `expect(upstream.capture.url).toBeDefined()`, `expect(capturedPreHandler).toBeDefined()`, `expect(fakeReq.raw.url).toBeDefined()` after a route-rewrite that should set the URL to a specific value.
- `apps/api/tests/unit/lib/audit.test.ts:165` — `expect(auditPayloadSchemas[action]).toBeDefined()` (schema registry coverage — any non-undefined value passes, including the wrong schema).
- `apps/api/tests/unit/__tests__/auth-schema-mapping.test.ts:53,89,99` — `captured.schema`, `advanced`, `cfg.plugins` all `toBeDefined()` only.
- `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts:189-197` — see H-08.
- `apps/api/tests/unit/__tests__/auth-send-verification-email.test.ts:143-158` — eight consecutive `toBeUndefined()` assertions on fallback-logger methods (just verifies they return `undefined`; the calls' actual side-effects are never sampled).

### M-03. `toBeTruthy()` / `toBeFalsy()` on values whose only non-passing state is `undefined`.

- `apps/api/tests/unit/routes/test-only.test.ts:183,311,312,338` — `expect(update).toBeTruthy()`, `expect(res.headers["set-auth-token"]).toBeTruthy()`. The header value is the rotated token shape; checking truthiness reduces the assertion to "header is present and non-empty".
- `apps/api/tests/unit/lib/web-search/__tests__/yandex.test.ts:297` — `expect(capturedBody).toBeTruthy()` after the route is supposed to forward a structured body. Replace with deep equality.
- `apps/api/tests/unit/i18n/__tests__/i18n-completeness.test.ts:122,128,154,155,167,171` — every locale value is checked only by `.toBeTruthy()`. An i18n regression where `en.errors.<code>` is the empty string passes (truthy because the string-coerced fallback may still be set elsewhere) — and more concerning, a regression where `en.errors.<code>` is the **key string itself** (i18next fallback when key not found) also passes.

### M-04. Conditional-skip suites that are silently NO-OP when env not set, with no green-light counter-test.

- All `describe.skipIf(!REACHABLE)` contract suites: `packages/contract-tests/tests/unit/{realtime,conventions,cookie-host,reason,diarization,litellm-base-url-override,web-search,openai-realtime-token,streaming-token,oauth-redirect,deepgram-streaming-token,missing-key-503,check-user,negative-matrix,transcriptions,token-rotation,delete-account}.test.ts`.
- `describe.skipIf(process.env.E2E !== "1")` in `tests/e2e/*.test.ts` — 10 files (encryption-at-rest, probes, reconciliation, etc.).
- `describe.skipIf(!REACHABLE || process.env.RUN_E2E !== "true")` in `packages/contract-tests/tests/unit/diarization.test.ts:84` — the **real pyannote.ai** test is double-gated. In normal CI, both gates are off → suite reports "passed" with zero `it()` actually run, and there's no `it()` outside the conditional that asserts the gate is observed.
- `apps/api/tests/unit/__tests__/email-mailpit.test.ts:63` — `describe.skipIf(!REACHABLE)`.
- `apps/api/tests/support/__tests__/shared-pg.test.ts:17,26,45` — `describe.skipIf(dockerSkipped)` × 3.
- `apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts:63` — `describe.skipIf(SKIP)`.

vitest's default behaviour reports `0/N skipped` blocks as the suite passing. The CJM/feedback memo "smoke before full e2e" notes the same risk. Recommend: each skip-gated suite gains one `it("declares gate state", () => { expect(REACHABLE).toBeDefined() })` outside the conditional so green CI without the gate set surfaces visibly.

### M-05. `vi.stubGlobal("fetch", …)` in mint-bearer + oauth tests bypasses every guard `ssrf-dispatcher` adds.

- `apps/api/tests/unit/lib/mint-bearer.test.ts:94,136,165,191,223,256,273,297,315` — 9 distinct stubGlobal calls, each replaces fetch wholesale.
- `apps/api/tests/unit/lib/mint-bearer-discovery.test.ts:115,150,179,203` — 4 more.
- `apps/api/tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts:154` — 1 more.
- `apps/api/tests/unit/__tests__/seed-signup-non-2xx-loud.test.ts:70,78` — 2 more.

DISCIPLINE rule allows network mocks at the process boundary — that is fine — but the SSRF dispatcher (`apps/api/src/lib/ssrf-dispatcher.ts`) is the **production guard layer above raw fetch**. Stubbing `globalThis.fetch` skips the dispatcher's redact / outbound-host check; tests asserting "the request was sent to URL X with headers Y" then prove **only** the in-process compose of caller → fetch, not caller → dispatcher → fetch. If a future refactor accidentally bypasses the dispatcher, these tests stay green.

### M-06. `expect(recorded.length).toBeGreaterThanOrEqual(2)` (check-user, line 110) "first execute: set_config; second: SELECT".

- Comment promises "set_config then SELECT" order; the assertion proves only "at least 2 things ran." A regression that runs the SELECT *before* set_config — exactly the kind of bug that fails RLS gating — passes. Compare with `delete-account.test.ts:117-119` which actually asserts ordering (`expect(delSessionsIdx).toBeGreaterThan(setConfigIdx)`) — but on the fake recorder, see H-04.

### M-07. `dep-check.test.ts:115,187` — `expect(r.latency_ms).toBeGreaterThanOrEqual(0)`.

- `latency_ms` is a non-negative number by type. The assertion is mathematically vacuous unless the implementation explicitly returned a negative value (impossible without an arithmetic error in the production code). Combined with the 5-second wall-clock `setTimeout` at line 256, this file would not flag a regression where latency tracking is silently disabled (`latency_ms = 0` always satisfies `>= 0`).

### M-08. Wall-clock sleep + no retry counter in rate-limit-isolation.

- `apps/api/tests/unit/routes/tokens/__tests__/rate-limit-isolation.integration.test.ts:361` — `await new Promise<void>((r) => setTimeout(r, 2500))` then asserts "30 fresh requests succeed."
- `apps/api/tests/unit/lib/dep-check.test.ts:256` — `await new Promise((r) => setTimeout(r, 5_200))`.
- `apps/api/tests/unit/__tests__/litellm-spike-request-id.test.ts:80` — `setTimeout(3000)`.

These tests will flake on a loaded CI runner with no retry / extended-window strategy. The comment at rate-limit-isolation.test.ts line 365 acknowledges Valkey TTL is wall-clock-bound — fine — but the test should poll for the TTL boundary with a deadline budget, not sleep-then-shoot.

### M-09. `expect(true).toBe(true)` sentinel without coverage exclusion.

- `apps/web/tests/unit/lib/__tests__/coverage-sentinel.test.ts:14` — purpose stated as "keeps the test runner alive until real specs ship." If real specs have shipped, the sentinel still passes — and the file pollutes the test count.
- `tests/e2e/encryption-at-rest.test.ts:173` — "pointer-only assertion" describing where the real test lives. A pointer is not a test; it's a documentation comment.
- `tests/self-tests/testcontainers-cleanup.test.ts:98,111` — `expect(true).toBe(true)` inside try-success branches. If the test logic underneath silently degrades (e.g. cleanup verification throws and the catch swallows), the suite reports pass.

### M-10. `expect([...]).toContain(result.status)` with overly broad acceptance.

- `packages/contract-tests/tests/unit/oauth-redirect.test.ts:81` — `expect([301, 302, 303, 307, 308]).toContain(final.status)`. The OAuth flow returns one specific code under spec — accepting all five rewrites a contract that BACKEND_SPEC almost certainly nails to one (302 or 303). If the server starts returning 308 (permanent redirect) by mistake, the test stays green and clients break on cached redirects.

### M-11. `transcribe.test.ts:392-394` — `parsed.duration | language | segments` all asserted `.toBeUndefined()` after a "stripped fields" test, but `parsed` itself uses zod's `.parse()` which already strips unknown fields. The test verifies zod, not the route.

- `expect(parsed.duration).toBeUndefined()` etc. only proves the response schema's `.strict()` worked. The actual question — did the **route** strip them before zod, or did it forward them and zod cleaned up? — is not differentiated. A regression where the route leaks PII via a non-stripped extra field passes because the contract-tests schema is applied here too.

---

## LOW — stylistic / convention drift

### L-01. `describe.skip` without rationale.

- `packages/data/tests/unit/__tests__/backfill.test.ts:89` — has a rationale block (lines 76-88) and is acceptable. No other unconditional skips in the tree.

### L-02. `console.warn` "migrations not present yet" branches in 5 data tests.

- `packages/data/tests/unit/__tests__/{migration-0006-backfill,settings-rls,rls-property,worker-rls-property,pgbouncer-interleave}.test.ts`. These return early (test passes) when migrations are missing — surfaces only as a stderr line. Should `throw` or use `describe.skipIf` with a visible `console.warn → it.skipIf` conversion so vitest reports `0/N skipped`.

### L-03. Sentinel test files (`coverage-sentinel.test.ts`).

See M-09. LOW because the file is explicitly excluded from coverage and clearly documented.

### L-04. `not.toThrow()` count is high (35+ matches) but each instance is a legitimate "construction doesn't throw" assertion — no false-confidence pattern beyond what M-02 already covers.

### L-05. `expect(idx).toBeGreaterThan(0)` in `redact-url-bootstrap-usage.test.ts:34,44,52`.

- The point of the test is "redact-url is imported BEFORE X." `idx > 0` proves it was imported and references found, but not the ordering claim. Should be `expect(redactIdx).toBeLessThan(otherIdx)`.

### L-06. CJM Playwright `.waitFor()` with no explicit timeout falls back to the project default (likely 5s).

- `apps/web/tests/e2e/u1-sign-in.spec.ts:68`, `u2-sign-up.spec.ts:65`, etc. Stylistic; Playwright's default is sane but explicit timeouts reduce flake.

### L-07. `tests/self-tests/traefik-https-only.test.ts:46` — `await new Promise(resolve => setTimeout(resolve, 2000))` with no retry. Same shape as M-08 but in a self-test rather than a route test, so impact is lower.

---

## Patterns to retire (cross-cutting recommendations — NOT fixes)

1. **All route tests must use the real-Postgres harness** (`bootMigratedPostgres` from `packages/data/src/__tests__/helpers.ts` or the equivalent route-package shim) AND open an `openwhispr_app` pool — never `openwhispr_owner` — to drive the handler. The `setup.ts` harness already creates `openwhispr_app`; just wire it through. The 0017 GRANT bug class repeats anywhere a route is tested against owner-pool.
2. **Add a `pnpm --filter @openwhispr/api postbuild-smoke` step** that `await import`s the produced `dist/index.*` artifact. The yaml-require bug class repeats anywhere bundling drift is invisible to TypeScript-source-only tests.
3. **Ban `recorded.find(/sql-substring/)`-style assertions** in route tests. Either run against real Postgres and observe the row/policy/GUC, or be honest that the test is a string-grep sanity check (not a behaviour test) and don't ship coverage credit for it.
4. **`expect(x).length > 0` and `expect(x).toBeDefined()` should be banned wherever `x`'s type already encodes the property.** A test must add information beyond what the type system already proves.
5. **`try { … } catch {}` in test code = always wrong.** Either `await expect(…).rejects.toBe(...)` or `try { … expect.fail() } catch (err) { expect(err)... }`. The audit.test.ts:439 pattern hides assertion failures.
6. **`describe.skipIf` blocks must be paired with a "gate-visibility" assertion** outside the conditional, so a green CI without the gate is not silent. Pattern: `it("gate", () => expect({ E2E: process.env.E2E, REACHABLE }).toMatchObject({...}))`.
7. **`vi.stubGlobal("fetch", ...)` is the wrong boundary.** Stub at `ssrf-dispatcher`'s injected `fetch` function parameter (or `undici`'s MockAgent on the dispatcher's own agent) so the production guard chain still runs.

---

## Out of scope / not reviewed

- Property-based suites (`rls-property.test.ts`, `worker-rls-property.test.ts`, `ledger-idempotency.property.test.ts`) — fast-check seeds; assumed sound until proven otherwise.
- Stryker / mutation tests under `tests/self-tests/` — these are policy-checks on infra files (`grafana-dashboards-validate.test.ts`, `stryker-break-threshold.test.ts`, `traefik-https-only.test.ts`); they assert structural shape and are out of audit signal (1-10).
- Playwright e2e under `apps/web/tests/e2e/` — depth required exceeds 2000-line budget; surface skim only (L-06).

---

_Audit completed 2026-05-17 against HEAD `3df1060`. Catalog only; no fixes applied._
