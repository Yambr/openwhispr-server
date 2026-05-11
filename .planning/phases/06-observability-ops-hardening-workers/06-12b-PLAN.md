---
phase: 06-observability-ops-hardening-workers
plan: 12b
type: execute
wave: 3
depends_on: [04, 06, 09, 12a]
files_modified:
  - tests/e2e/horizontal-scale.test.ts
  - tests/e2e/ssrf-block.test.ts
  - tests/e2e/rate-limit-layered.test.ts
  - apps/api/src/routes/__test/fetch.ts
  - apps/api/src/routes/__test/fetch.test.ts
  - apps/api/src/index.ts
autonomous: true
requirements: [SCALE-01, SCALE-04]
threat_model_refs: [T-ssrf, T-rate-limit-bypass]
must_haves:
  truths:
    - "horizontal-scale.test.ts: scale api=2; 20 hits; ≥1 per replica via x-served-by; all 200; same session.id (SCALE-01)"
    - "ssrf-block.test.ts: outbound to 169.254.169.254 → 502 + audit_log row action='security.ssrf_blocked'"
    - "rate-limit-layered.test.ts: per-user 20/min/transcribe + 60/min/IP/reason + verification-status carve-out preserved + audit row 'security.rate_limit_exceeded'"
    - "Debug-only POST /__test/fetch?url=... gated by NODE_ENV='test' returns 404 otherwise"
    - "All 3 tests use real DockerComposeEnvironment, teardown with removeVolumes:true"
  artifacts:
    - path: "apps/api/src/routes/__test/fetch.ts"
      provides: "NODE_ENV=test-only outbound-fetch helper for SSRF e2e (404 in non-test)"
  key_links:
    - from: "SCALE-01 horizontal scale"
      to: "horizontal-scale.test.ts"
      via: "Plan 04 x-served-by + Traefik docker-provider"
      pattern: ".*\\.test\\.ts"
    - from: "T-ssrf mitigation"
      to: "ssrf-block.test.ts"
      via: "Plan 06 ssrf-dispatcher.ts + Plan 05 recordAudit"
      pattern: ".*\\.test\\.ts"
    - from: "SCALE-04 rate-limit"
      to: "rate-limit-layered.test.ts"
      via: "Plan 09 rate-limit.ts + matrix"
      pattern: ".*\\.test\\.ts"
parent_plan: 12
split_rationale: "12b owns scale + security trio. Depends on 12a only so that 12a-validated compose harness is in shared helpers/."
---

<objective>
Flip 3 of 8 e2e RED stubs to GREEN against the real docker-compose stack:
- tests/e2e/horizontal-scale.test.ts (SCALE-01)
- tests/e2e/ssrf-block.test.ts (SCALE-04, T-ssrf)
- tests/e2e/rate-limit-layered.test.ts (SCALE-04, T-rate-limit-bypass)

Also land the NODE_ENV='test'-gated debug route `POST /__test/fetch?url=...` that the SSRF e2e provokes.

Purpose: prove SCALE-01 (horizontal scale via x-served-by distribution) and the layered SSRF + rate-limit defenses fire against real services. These three share the "drive a route, observe an audit row" verification pattern.

Output: 3 GREEN e2e tests + debug-only fetch route + 06-12b-SUMMARY.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
@.planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md
@.planning/phases/06-observability-ops-hardening-workers/06-04-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-06-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-09-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-12a-SUMMARY.md
@CLAUDE.md
@tests/e2e/horizontal-scale.test.ts
@tests/e2e/ssrf-block.test.ts
@tests/e2e/rate-limit-layered.test.ts
@apps/api/src/index.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: horizontal-scale e2e</name>
  <files>
    tests/e2e/horizontal-scale.test.ts
  </files>
  <read_first>
    apps/api/src/plugins/served-by.ts (Plan 04),
    compose/traefik/* (current static config — confirm docker-provider mode for round-robin)
  </read_first>
  <behavior>
    1. `new DockerComposeEnvironment(repoRoot, 'docker-compose.yml').withProfiles('default').withScale('api', 2).withWaitStrategy('api', Wait.forHttp('/livez', 3000)).up()` (240s beforeAll).
    2. If Traefik file-provider mode pins a single backend, the test must switch the test-only profile to Traefik docker-provider, OR add a second `servers:` entry in the file provider. Inspect compose/traefik/ to choose. Prefer docker-provider for honest scale.
    3. Sign in via Better Auth; capture bearer cookie.
    4. Hit GET /api/me (or /api/usage) 20 times serially through the Traefik base URL.
    5. Collect `x-served-by` header from each response.
    6. Assert: 20 × status 200; ≥1 distinct hostname per replica (at least 2 distinct values across 20 responses); all responses carry same session.id (verify by parsing JSON body).
    7. Tear down with removeVolumes:true.
  </behavior>
  <action>
    If withScale('api', 2) + Traefik file-provider doesn't round-robin in this codebase, lift the test profile to use Traefik's docker-provider (label-based). Document the chosen path in SUMMARY.

    Retry-once on first failure with 30s extra timeout per RESEARCH.md Risk table.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/horizontal-scale.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Test contains `withScale`, `x-served-by`, asserts ≥2 distinct replica hostnames
    - Exits 0 (allow up to 6 min including compose boot)
  </acceptance_criteria>
  <done>
    1 of 3 tests GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: debug-only /__test/fetch route + ssrf-block e2e</name>
  <files>
    apps/api/src/routes/__test/fetch.ts,
    apps/api/src/routes/__test/fetch.test.ts,
    apps/api/src/index.ts,
    tests/e2e/ssrf-block.test.ts
  </files>
  <read_first>
    apps/api/src/lib/ssrf-dispatcher.ts (Plan 06 — SSRFBlockedError → 502),
    apps/api/src/error-handler.ts (Plan 06 — 502 mapping),
    apps/api/src/lib/audit.ts (Plan 05 — recordAudit; verify the SSRF dispatcher emits 'security.ssrf_blocked' OR add the emission if missing)
  </read_first>
  <behavior>
    Debug route (apps/api/src/routes/__test/fetch.ts):
    - Path: POST /__test/fetch
    - First-line guard: `if (process.env.NODE_ENV !== 'test') return reply.code(404).send({error:'not_found'})`
    - Body schema: `{url: string}` validated via zod
    - Action: performs `await fetch(body.url)` via `globalThis.fetch` (which routes through the SSRF dispatcher installed at bootstrap)
    - Returns: on success `{status: response.status}`; on SSRFBlockedError lets the error handler return 502 as usual.

    Register in apps/api/src/index.ts (or wherever routes are wired) gated by NODE_ENV=test.

    Unit test (apps/api/src/routes/__test/fetch.test.ts):
    - With NODE_ENV='test' + SSRF dispatcher installed pointing at a fake allow-all, POST /__test/fetch?url=https://example.com/ → 200.
    - With NODE_ENV='production' → 404.
    - With url that resolves to 127.0.0.1 (loopback blocked) → 502 with SSRFBlockedError envelope.

    E2E test (tests/e2e/ssrf-block.test.ts):
    1. Boot compose default with `NODE_ENV=test` on api service.
    2. Optionally spin a tiny extra container that redirects to 169.254.169.254 (nginx with `return 302`) — or just POST /__test/fetch directly with url=`http://169.254.169.254/latest/meta-data/`. Prefer direct.
    3. POST /__test/fetch with that url.
    4. Assert response 502 + body shape from project error envelope.
    5. Verify audit_log row via owner pg: `SELECT action, payload FROM audit_log WHERE action='security.ssrf_blocked' ORDER BY created_at DESC LIMIT 1`. Assert `payload.target_url_host = '169.254.169.254'` and `payload.rule = 'link_local_v4'` (or whatever Plan 06's CIDR matrix labels it).

    If Plan 06 SSRF dispatcher does NOT yet emit the audit row (read 06-06-SUMMARY first to confirm), wire the emission in the same atomic commit as this test — TDD: test catches the gap, fix lands together. Use `recordAudit({ action: 'security.ssrf_blocked', target_id: null, payload: {target_url_host, rule, request_id}, ctx })` from the dispatcher's `onBlock` hook.
  </behavior>
  <action>
    Read 06-06-SUMMARY's "audit-hook resilience" note — the dispatcher already has an `onBlock` hook accepting a context object. Wire `recordAudit` through it.

    NODE_ENV gate is the same idiom used elsewhere in the codebase; check apps/api for prior __test routes (Phase 5 may have set a pattern).
  </action>
  <verify>
    <automated>NODE_ENV=test pnpm vitest run apps/api/src/routes/__test/fetch.test.ts &amp;&amp; E2E=1 pnpm vitest run tests/e2e/ssrf-block.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - apps/api/src/routes/__test/fetch.ts exists with NODE_ENV gate
    - apps/api/src/routes/__test/fetch.test.ts has 3+ unit tests covering allow/deny/404
    - tests/e2e/ssrf-block.test.ts contains `169.254.169.254`, `security.ssrf_blocked`, `audit_log`
    - Both test commands exit 0
  </acceptance_criteria>
  <done>
    2 of 3 tests GREEN; debug route landed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: rate-limit-layered e2e</name>
  <files>
    tests/e2e/rate-limit-layered.test.ts
  </files>
  <read_first>
    apps/api/src/plugins/rate-limit.ts (Plan 09 — 3 layers),
    apps/api/src/config/rate-limits.ts (Plan 09 — rpm matrix),
    apps/api/src/lib/audit.ts (Plan 05 — security.rate_limit_exceeded emission via onRateLimitExceeded wired in Plan 09)
  </read_first>
  <behavior>
    1. Boot compose default with mock-litellm profile (so /api/transcribe doesn't 503 missing-key).
    2. Sign in user-A from synthetic source IP via `X-Forwarded-For` (matches signInFixture pattern from prior phases — see Phase 02.18/19 SUMMARYs for the trustedIPs config).
    3. POST 21 requests to /api/transcribe within 60s, all carrying user-A bearer.
    4. Assert: requests 1-20 return 200/201/4xx (NOT 429); request 21 returns 429 with body shape `{error: 'Too many requests'}` AND standard headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (note: per Plan 09's RFC-draft header naming — NOT `X-` prefix).
    5. IP-tier: sign in 30 fresh users from same X-Forwarded-For IP-B; each posts /api/reason once; after the 60th cumulative reason request the IP-tier 429 fires.
    6. Verification-status carve-out: GET /api/auth/verification-status?email=fixture@example.com 30 times in 60s; all NOT 429 (200 or 4xx ok); 31st returns 429.
    7. After step 4, query audit_log: assert row `action='security.rate_limit_exceeded'` with `payload.layer ∈ {'user','ip','tenant'}` and `payload.route` matching the throttled route.

    Tear down with removeVolumes:true.
  </behavior>
  <action>
    Use `Promise.all` for the 21-burst — but capture all 21 responses to assert which one specifically 429s (race-safe via response sort by `RateLimit-Remaining` descending).

    The audit emission for rate-limit-exceeded was wired by Plan 09 via `onRateLimitExceeded` hook — confirm in 06-09-SUMMARY; if it asserts the emission, this test just verifies the row.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/rate-limit-layered.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Test contains `RateLimit-Remaining`, `429`, `security.rate_limit_exceeded`, `verification-status`
    - Test asserts at least 3 distinct rate-limit scenarios (user, IP, carve-out)
    - Exits 0 (allow up to 8 min — this test has timing waits)
  </acceptance_criteria>
  <done>
    3 of 3 tests GREEN.
  </done>
</task>

</tasks>

<verification>
- All 3 e2e tests GREEN
- `/__test/fetch` route 404s in non-test NODE_ENV
- No regression on prior phase tests (run a smoke selection)
</verification>

<success_criteria>
3 more of 8 Phase 6 e2e tests GREEN. SCALE-01 + SCALE-04 + T-ssrf observably proven against live stack.
</success_criteria>

<output>
Create `.planning/phases/06-observability-ops-hardening-workers/06-12b-SUMMARY.md` with: test pass evidence, Traefik provider mode chosen for scale test, any audit-emission gap closed for SSRF, blockers + retries.
</output>
