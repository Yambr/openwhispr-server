---
phase: 06-observability-ops-hardening-workers
plan: 12a
type: execute
wave: 3
depends_on: [04, 05, 08]
files_modified:
  - tests/e2e/probes-dependency.test.ts
  - tests/e2e/audit-log-write.test.ts
  - Makefile
autonomous: true
requirements: [OBS-05, DATA-04]
threat_model_refs: [T-readiness-cascade, T-audit-loss]
must_haves:
  truths:
    - "probes-dependency.test.ts: docker pause postgres → /livez stays 200; /readyz returns 503 within 6s; resume → 200 within 8s"
    - "audit-log-write.test.ts: auth.signin emits canonical row with all D-A7 required keys; partition routing correct (tableoid::regclass resolves to audit_log_YYYY_MM)"
    - "Makefile gains e2e-test-phase6 sub-target invoking 06-12a tests"
    - "Both tests boot a real DockerComposeEnvironment (testcontainers); both teardown with removeVolumes:true"
  artifacts:
    - path: "Makefile"
      provides: "make e2e-test-phase6 (initial 06-12a subset; 06-12d extends)"
  key_links:
    - from: "OBS-05 readiness contract"
      to: "probes-dependency.test.ts assertion"
      via: "Plan 04 implementation"
      pattern: ".*\\.test\\.ts"
    - from: "DATA-04 audit emission"
      to: "audit-log-write.test.ts assertion"
      via: "Plan 05 implementation"
      pattern: ".*\\.test\\.ts"
parent_plan: 12
split_rationale: "Plan 12 split into 12a/b/c/d to fit honest-execution budget. 12a covers the lowest-blast-radius pair (probes + audit) plus initial Makefile scaffolding."
---

<objective>
Flip 2 of 8 e2e RED stubs to GREEN against the real docker-compose stack:
- tests/e2e/probes-dependency.test.ts (OBS-05, T-readiness-cascade)
- tests/e2e/audit-log-write.test.ts (DATA-04)

Also add the initial `make e2e-test-phase6` Makefile target that the remaining 06-12b/c/d sub-plans will extend.

Purpose: lowest-risk slice of the Wave 3 verification gate — these two tests are the most self-contained (no LGTM-stack queries, no Traefik scaling, no rate-limit timing races). Getting them green proves the testcontainers DockerComposeEnvironment harness works for Phase 6 before we throw harder tests at it.

Output: 2 GREEN e2e tests + Makefile sub-target + 06-12a-SUMMARY.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
@.planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md
@.planning/phases/06-observability-ops-hardening-workers/06-VALIDATION.md
@.planning/phases/06-observability-ops-hardening-workers/06-04-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-05-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-08-SUMMARY.md
@CLAUDE.md
@tests/e2e/probes-dependency.test.ts
@tests/e2e/audit-log-write.test.ts
@Makefile
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: probes-dependency e2e + Makefile scaffolding</name>
  <files>
    tests/e2e/probes-dependency.test.ts,
    Makefile
  </files>
  <read_first>
    .planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md §7 (DockerComposeEnvironment + Wait strategies),
    apps/api/src/routes/probes.ts (Plan 04 — three routes /livez /readyz /startupz),
    apps/api/src/lib/dep-check.ts (Plan 04 — 5s LRU cache + promise dedup)
  </read_first>
  <behavior>
    Flip tests/e2e/probes-dependency.test.ts from RED throw-stub to GREEN. Use testcontainers `DockerComposeEnvironment` pointed at the project root compose file with the default profile. Boot fully, then:
    1. Assert GET /livez 200; /readyz 200; /startupz 200 (baseline).
    2. `await environment.getContainer('postgres').pause()` (testcontainers API).
    3. Within 6 seconds (poll every 500ms): assert /livez still returns 200 (it MUST NOT call dep-check), AND /readyz returns 503 with body shape `{status:"down", deps:{pg:"down", redis:"ok", litellm:"ok"|"down"}}` (litellm may be "down" depending on profile — accept both).
    4. `await environment.getContainer('postgres').unpause()`.
    5. Within 8 seconds (poll every 500ms): /readyz returns 200 with `deps.pg === "ok"`.

    Add to Makefile a new target near existing e2e targets:
    ```
    e2e-test-phase6: ## Phase 6 e2e suite (06-12a subset; extended by 06-12d)
    \tE2E=1 pnpm vitest run tests/e2e/probes-dependency.test.ts tests/e2e/audit-log-write.test.ts
    ```
    Do NOT modify the global `e2e-test` target yet — 06-12d will fold this in once all 8 tests land.
  </behavior>
  <action>
    Boot via `new DockerComposeEnvironment(repoRoot, 'docker-compose.yml').withProfiles('default').withWaitStrategy('api', Wait.forHttp('/livez', 3000)).up()` with a 240s beforeAll timeout.

    The poll helper should wait between attempts and surface the last response body in the error message for triage. Retry-once on first failure with extended 30s timeout per RESEARCH.md Risk table.

    afterAll: `await environment.down({ timeout: 30_000, removeVolumes: true })`.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/probes-dependency.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - tests/e2e/probes-dependency.test.ts has no `throw new Error('not yet implemented')`
    - Test contains `DockerComposeEnvironment`, `getContainer('postgres').pause`, `/livez`, `/readyz`
    - `E2E=1 pnpm vitest run tests/e2e/probes-dependency.test.ts` exits 0 (allow up to 5 min)
    - Makefile contains `e2e-test-phase6:` target
  </acceptance_criteria>
  <done>
    1 of 2 e2e tests GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: audit-log-write e2e</name>
  <files>
    tests/e2e/audit-log-write.test.ts
  </files>
  <read_first>
    apps/api/src/lib/audit.ts (Plan 05 — recordAudit shape, D-A7 required keys),
    apps/api/src/routes/delete-account.ts (Plan 05 — currently wired account.delete emitter),
    apps/api/src/routes/v1/keys/create.ts (Plan 05 — key.issued emitter),
    packages/data/migrations/0014_audit_log_partition.sql (Plan 02 — partition shape)
  </read_first>
  <behavior>
    Flip tests/e2e/audit-log-write.test.ts to GREEN. Plan 12's original spec asserts `auth.signin` is emitted on sign-in, BUT 06-05-SUMMARY documents that auth.signin is DEFERRED until the Better-Auth-hooks plan. Pivot the test to one of the 3 actions Plan 05 actually wired:
    - account.delete (DELETE /api/auth/delete-account), OR
    - key.issued (POST /api/v1/keys/create), OR
    - key.revoked (POST /api/v1/keys/:id/revoke)

    Choose `key.issued` — it's a straight POST with a clean response, doesn't terminate the session, and exercises both the tenant-scoped audit row AND the partition routing.

    Test flow:
    1. Boot DockerComposeEnvironment (default profile, 240s timeout).
    2. Sign in via Better Auth (POST /api/auth/sign-in/email) with the existing fixture user; capture the bearer cookie / token.
    3. POST /api/v1/keys/create with a small payload (`{name: "phase6-e2e-${Date.now()}"}`).
    4. Wait 1s for the audit write to commit.
    5. Open a direct pg connection via the owner pool (read DATABASE_URL_OWNER from the api container env or the testcontainer postgres host:port + creds) and run:
       ```sql
       SELECT
         action, tenant_id, target_id, payload, request_id, ip,
         (tableoid::regclass)::text AS partition_name
       FROM audit_log
       WHERE action='key.issued' AND tenant_id=$fixtureTenantId
       ORDER BY created_at DESC LIMIT 1;
       ```
    6. Assert: row exists; `payload` is JSONB with the redacted shape (NO clear-text PAK token, key_id present); `request_id` matches Fastify's reqId format (or is a UUID — either is acceptable per Plan 05 deviation D-05-4); `partition_name` matches `audit_log_p${YYYY}_${MM}` (or whatever 06-02-SUMMARY's pg_partman naming actually produces — read 0014_audit_log_partition.sql to confirm the exact child name template).
  </behavior>
  <action>
    Use the same DockerComposeEnvironment harness as Task 1 (extract to a shared helper if not already present in `tests/e2e/helpers/`).

    Direct pg connection: testcontainers' compose env exposes container host+port via `environment.getContainer('postgres').getMappedPort(5432)`. Connect with `pg` (already in workspace deps); use the owner role from the project's env defaults. Read 06-02 + 06-04 SUMMARYs to confirm the role name.

    Tear down with `removeVolumes:true`.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/audit-log-write.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - tests/e2e/audit-log-write.test.ts has no `throw new Error('not yet implemented')`
    - Test contains `DockerComposeEnvironment`, `/api/v1/keys/create`, `audit_log`, `tableoid::regclass`, `key.issued`
    - `E2E=1 pnpm vitest run tests/e2e/audit-log-write.test.ts` exits 0 (allow up to 5 min)
  </acceptance_criteria>
  <done>
    2 of 2 e2e tests in this sub-plan GREEN.
  </done>
</task>

</tasks>

<verification>
- `E2E=1 make e2e-test-phase6` exits 0 with 2 tests green (after this plan)
- `make e2e-test` global gate UNCHANGED by this plan (06-12d folds in later)
- No regression on prior phase e2e tests
</verification>

<success_criteria>
2 of 8 Phase 6 e2e tests GREEN. Lowest-blast-radius pair landed. Testcontainers DockerComposeEnvironment harness proven for Phase 6.
</success_criteria>

<output>
Create `.planning/phases/06-observability-ops-hardening-workers/06-12a-SUMMARY.md` with: test pass evidence (stdout snippet), DockerComposeEnvironment boot time, any compose/profile/wait-strategy deviations, blockers + retries observed.
</output>
