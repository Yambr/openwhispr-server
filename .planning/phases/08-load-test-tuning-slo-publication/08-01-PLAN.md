---
phase: 08-load-test-tuning-slo-publication
plan: 01
type: tdd
wave: 0
depends_on: []
files_modified:
  - apps/api/src/plugins/rate-limit.ts
  - apps/api/src/plugins/rate-limit.test.ts
  - apps/api/src/auth.ts
  - apps/api/src/auth.test.ts
  - .env.example
autonomous: true
requirements:
  - SCALE-06
  - TEST-LOAD-01
must_haves:
  truths:
    - "Setting OPENWHISPR_DISABLE_RATE_LIMIT=1 disables both Fastify @fastify/rate-limit and Better Auth rate limiter, returning 200 for traffic that would otherwise 429."
    - "With OPENWHISPR_DISABLE_RATE_LIMIT unset OR =0, both limiters still fire (default-secure behavior)."
    - "The api boot logs a clear WARN banner when the switch is on (operator safety, anti-prod-leak)."
    - "Unit tests cover both flag states (on / off / unset) for BOTH limiters."
  artifacts:
    - path: "apps/api/src/plugins/rate-limit.ts"
      provides: "Conditional skip of Fastify rate-limit registration when OPENWHISPR_DISABLE_RATE_LIMIT=1"
      contains: "OPENWHISPR_DISABLE_RATE_LIMIT"
    - path: "apps/api/src/auth.ts"
      provides: "Conditional disable of Better Auth rate-limit block when OPENWHISPR_DISABLE_RATE_LIMIT=1"
      contains: "OPENWHISPR_DISABLE_RATE_LIMIT"
    - path: "apps/api/src/plugins/rate-limit.test.ts"
      provides: "Unit tests for env-switch behavior of the Fastify limiter"
    - path: "apps/api/src/auth.test.ts"
      provides: "Unit tests for env-switch behavior of the Better Auth limiter"
    - path: ".env.example"
      provides: ".env.example documents OPENWHISPR_DISABLE_RATE_LIMIT as LOAD-TEST-ONLY"
      contains: "OPENWHISPR_DISABLE_RATE_LIMIT"
  key_links:
    - from: "apps/api/src/plugins/rate-limit.ts"
      to: "process.env.OPENWHISPR_DISABLE_RATE_LIMIT"
      via: "env read at plugin registration time"
      pattern: "process\\.env\\.OPENWHISPR_DISABLE_RATE_LIMIT"
    - from: "apps/api/src/auth.ts"
      to: "Better Auth rateLimit config block"
      via: "conditional disabled: true when env=1"
      pattern: "OPENWHISPR_DISABLE_RATE_LIMIT"
---

<objective>
Add `OPENWHISPR_DISABLE_RATE_LIMIT=1` env switch to BOTH the Fastify `@fastify/rate-limit` plugin AND the Better Auth in-built rate-limiter. CONTEXT.md (lines 75, 95) and Phase 07.1 docs reference this switch as if it exists, but `grep -rn OPENWHISPR_DISABLE_RATE_LIMIT apps/` returns zero matches (RESEARCH.md §Pitfall 5, Assumption A5). This is the Wave 0 prerequisite the entire load test depends on — without it, 1000 VUs from one Mac IP are throttled within the first second.

Purpose: Enable synthetic load traffic to bypass rate limits in load-test compose profiles only. Default profile MUST remain rate-limited. Per D-TDD-1, tests RED before GREEN.

Output: Two implementation files + two test files + .env.example entry, all in one atomic RED→GREEN pair per CLAUDE.md TDD discipline.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@apps/api/src/plugins/rate-limit.ts
@apps/api/src/auth.ts

<interfaces>
<!-- The two limiter surfaces this plan modifies. -->
<!-- Fastify rate-limit plugin: registered via app.register(rateLimit, opts) — gate the entire register() call on the env switch. -->
<!-- Better Auth: top-level config has `rateLimit: { enabled, window, max, storage }` — set `enabled: false` when env=1. -->

Pattern for the env read (use once at module load, not per-request):

```typescript
const RATE_LIMIT_DISABLED =
  process.env.OPENWHISPR_DISABLE_RATE_LIMIT === "1" ||
  process.env.OPENWHISPR_DISABLE_RATE_LIMIT === "true";
```

Boot-time WARN banner (required for safety, no prod leak):

```typescript
if (RATE_LIMIT_DISABLED) {
  app.log.warn(
    { env: "OPENWHISPR_DISABLE_RATE_LIMIT" },
    "[security] Rate limit DISABLED via OPENWHISPR_DISABLE_RATE_LIMIT — load-test only, MUST NOT be set in production",
  );
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fastify rate-limit plugin env switch (RED → GREEN)</name>
  <files>apps/api/src/plugins/rate-limit.ts, apps/api/src/plugins/rate-limit.test.ts</files>
  <behavior>
    - Test 1 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT unset, the plugin registers @fastify/rate-limit and 11 requests in 1 second to a test route return at least one 429.
    - Test 2 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT=1, the plugin skips registration and 100 requests in 1 second all return 200.
    - Test 3 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT=0, behavior matches "unset" (default-secure).
    - Test 4 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT=true (string), behavior matches =1 (accept common truthy form).
    - Test 5 (RED): When the switch is on, the Fastify logger receives a WARN containing "Rate limit DISABLED" at least once.
  </behavior>
  <action>
    Step 1 (RED): Write all 5 tests in `apps/api/src/plugins/rate-limit.test.ts`. Use Fastify's `app.inject()` for the 11-request burst (no real network). Use a `vi.spyOn(app.log, 'warn')` for the banner assertion. Read existing test patterns in `apps/api/src/plugins/*.test.ts` for fixture style (use the same `buildTestApp()` helper if it exists, otherwise inline a minimal Fastify factory). Run `pnpm --filter @openwhispr/api test rate-limit.test.ts` — MUST fail. Commit: `test(08-01): RED — OPENWHISPR_DISABLE_RATE_LIMIT switch for Fastify limiter`.

    Step 2 (GREEN): Read the current `apps/api/src/plugins/rate-limit.ts`. Gate the `app.register(rateLimit, ...)` call on `RATE_LIMIT_DISABLED` (env read at plugin entry, not per-request). Emit the WARN banner when disabled. Per D-TDD-2, ensure ≥90/90/90/90 coverage on the diff (branch coverage on the new `if (RATE_LIMIT_DISABLED)` path). Run tests — MUST pass. Commit: `feat(08-01): GREEN — OPENWHISPR_DISABLE_RATE_LIMIT disables Fastify @fastify/rate-limit (load-test only)`.

    CRITICAL: Do NOT introduce a `--legacy` flag or comment-out the limiter. Per CLAUDE.md "no workarounds — enterprise-grade only", this is a properly tested feature, not a backdoor.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test rate-limit.test.ts</automated>
  </verify>
  <done>All 5 tests pass; coverage ≥90/90/90/90 on the diff; WARN banner observed in test output when switch is on.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Better Auth rate-limit env switch (RED → GREEN)</name>
  <files>apps/api/src/auth.ts, apps/api/src/auth.test.ts, .env.example</files>
  <behavior>
    - Test 1 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT unset, Better Auth config emits `rateLimit.enabled !== false` (limiter active).
    - Test 2 (RED): With OPENWHISPR_DISABLE_RATE_LIMIT=1, Better Auth config emits `rateLimit.enabled === false` OR omits the rateLimit block entirely (limiter inactive).
    - Test 3 (RED): When the switch is on, a boot-time WARN banner identifies the Better Auth surface specifically (separate from the Fastify banner, OR a single shared banner mentioning BOTH subsystems is acceptable).
    - Test 4 (RED): `.env.example` contains a `OPENWHISPR_DISABLE_RATE_LIMIT` line annotated as "LOAD-TEST ONLY — MUST NOT be set in production".
  </behavior>
  <action>
    Step 1 (RED): Write tests in `apps/api/src/auth.test.ts`. For tests 1-3, import the Better Auth instance factory (NOT the singleton) and assert on the resolved config object. For test 4, use Node `fs.readFileSync('.env.example', 'utf8')` and regex-match the documented line + the LOAD-TEST-ONLY annotation. Run tests — MUST fail. Commit: `test(08-01): RED — OPENWHISPR_DISABLE_RATE_LIMIT switch for Better Auth limiter`.

    Step 2 (GREEN):
    - In `apps/api/src/auth.ts` around lines 261-266 (rateLimit block per RESEARCH.md §Pitfall 5): gate the rateLimit config on `RATE_LIMIT_DISABLED`. Either set `enabled: false` or omit the block entirely depending on Better Auth's config shape (consult the in-repo type or `node_modules/better-auth` types to choose). Add the WARN banner at boot.
    - In `.env.example`: add the documented line. Recommended exact text:
      ```
      # LOAD-TEST ONLY — disables BOTH Fastify @fastify/rate-limit AND Better Auth rate-limit.
      # MUST NOT be set in production. Used by docker-compose `load-test-mock` / `load-test-realistic` profiles only.
      # OPENWHISPR_DISABLE_RATE_LIMIT=1
      ```
    - Run tests — MUST pass. Commit: `feat(08-01): GREEN — OPENWHISPR_DISABLE_RATE_LIMIT disables Better Auth limiter + .env.example entry`.

    NOTE: If a single shared `RATE_LIMIT_DISABLED` constant is exported from `apps/api/src/lib/env.ts` (or similar) and consumed by both plugins, that is preferred over two duplicate `process.env` reads. Check for an existing env-parsing helper first.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test auth.test.ts</automated>
  </verify>
  <done>All tests pass; coverage ≥90/90/90/90 on the diff; .env.example contains the documented switch with LOAD-TEST-ONLY annotation; boot WARN banner verified in test output.</done>
</task>

</tasks>

<verification>
- Full apps/api test suite green: `pnpm --filter @openwhispr/api test`
- Coverage ≥90/90/90/90 on the diff: `pnpm --filter @openwhispr/api test:coverage` and inspect the rate-limit.ts + auth.ts deltas
- Grep proves the switch exists: `grep -rn OPENWHISPR_DISABLE_RATE_LIMIT apps/api/src/ .env.example` returns ≥4 matches
- Grep proves no production .env template enables it: `grep OPENWHISPR_DISABLE_RATE_LIMIT=1 .env .env.production 2>/dev/null` returns nothing
</verification>

<success_criteria>
- Two atomic RED→GREEN commit pairs land (4 commits total)
- Both limiter subsystems honor the same env switch
- Default-secure: unset OR =0 keeps limiters active
- Boot WARN banner makes accidental production leak loud
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-01-SUMMARY.md` per template.
</output>
