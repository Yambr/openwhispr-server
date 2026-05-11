---
phase: 06-observability-ops-hardening-workers
plan: 12c
type: execute
wave: 3
depends_on: [03, 08, 10, 11, 12a]
files_modified:
  - tests/e2e/reconciliation-drift.test.ts
  - tests/e2e/log-scrub-sentinel.test.ts
  - tests/e2e/otel-trace-propagation.test.ts
autonomous: true
requirements: [OBS-01, OBS-03, OBS-04]
threat_model_refs: [T-bearer-leak, T-audit-loss]
must_haves:
  truths:
    - "reconciliation-drift.test.ts: seed mismatch → reconciliation-daily-check runs → Mimir drift_pct > 0.5 → discrepancy enqueued → backfill closes drift to 0 (OBS-04)"
    - "log-scrub-sentinel.test.ts: SENTINEL-AUTH-* in Authorization header → api+worker container stdout DOES NOT contain SENTINEL (OBS-03)"
    - "otel-trace-propagation.test.ts: request emits log → Tempo /api/traces/{trace_id} returns ≥1 span service.name=openwhispr-api → Loki query for trace_id returns ≥1 log line (OBS-01)"
    - "All 3 tests use real DockerComposeEnvironment incl LGTM stack (tempo+loki+mimir); removeVolumes:true teardown"
  artifacts: []
  key_links:
    - from: "OBS-01 trace+log correlation"
      to: "otel-trace-propagation.test.ts"
      via: "Plan 03 OTel SDK + Plan 11 derivedFields"
      pattern: ".*\\.test\\.ts"
    - from: "OBS-03 log scrubbing"
      to: "log-scrub-sentinel.test.ts"
      via: "Plan 10 shared makePino"
      pattern: ".*\\.test\\.ts"
    - from: "OBS-04 reconciliation"
      to: "reconciliation-drift.test.ts"
      via: "Plan 08 reconciliation-daily-check + reconciliation-discrepancy workers + Plan 11 Mimir dashboard"
      pattern: ".*\\.test\\.ts"
parent_plan: 12
split_rationale: "12c owns the LGTM-stack-heavy trio. These three require Tempo/Loki/Mimir queries and BullMQ job orchestration from outside the worker — the slowest tests and the most distinct from 12a/12b's drive-route-then-assert pattern."
---

<objective>
Flip 3 of 8 e2e RED stubs to GREEN against the real docker-compose stack with full LGTM stack running:
- tests/e2e/reconciliation-drift.test.ts (OBS-04)
- tests/e2e/log-scrub-sentinel.test.ts (OBS-03)
- tests/e2e/otel-trace-propagation.test.ts (OBS-01)

Purpose: prove observability + reconciliation end-to-end. These tests exercise the Tempo/Loki/Mimir HTTP APIs directly to confirm spans, logs, and metrics propagate through the OTel pipeline.

Output: 3 GREEN e2e tests + 06-12c-SUMMARY.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
@.planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md
@.planning/phases/06-observability-ops-hardening-workers/06-03-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-08-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-10-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-11-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-12a-SUMMARY.md
@CLAUDE.md
@tests/e2e/reconciliation-drift.test.ts
@tests/e2e/log-scrub-sentinel.test.ts
@tests/e2e/otel-trace-propagation.test.ts
@tests/integration/log-scrub-sentinel.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: reconciliation-drift e2e</name>
  <files>
    tests/e2e/reconciliation-drift.test.ts
  </files>
  <read_first>
    apps/worker/src/jobs/reconciliation-daily-check.ts (Plan 08),
    apps/worker/src/jobs/reconciliation-discrepancy.ts (Plan 08),
    .planning/phases/06-observability-ops-hardening-workers/06-08-SUMMARY.md (job semantics, idempotency, watermark),
    .planning/phases/06-observability-ops-hardening-workers/06-11-SUMMARY.md (Mimir alert rule for drift)
  </read_first>
  <behavior>
    1. Boot DockerComposeEnvironment with mock-litellm profile (hermetic) + LGTM stack (tempo+loki+mimir).
    2. Seed: N rows in usage_ledger for tenant-A; N+10 rows in mock LiteLLM_SpendLogs for same tenant-A (induces drift > 0.5%).
    3. Trigger reconciliation-daily-check job. Two ways acceptable:
       - (a) Direct BullMQ enqueue from outside the worker: connect to Valkey, instantiate the Queue with same name, call `queue.add('reconciliation-daily-check', {})`.
       - (b) Add a test-only POST /__test/trigger-job?name=... endpoint guarded by NODE_ENV=test (or extend 06-12b's /__test/fetch with a sibling /__test/enqueue).
       Prefer (a) — keeps test isolated from API changes.
    4. Poll BullMQ job status until completed (max 30s).
    5. Query Mimir HTTP API at port 9009: `GET /prometheus/api/v1/query?query=litellm_reconciliation_drift_pct{tenant_id="<tenant-A>"}`. Assert value > 0.5.
    6. Assert reconciliation-discrepancy job was enqueued (BullMQ introspection: list jobs in that queue, find one for tenant-A).
    7. Poll until discrepancy backfill completes.
    8. Query usage_ledger via owner pg: assert tenant-A now has N+10 rows (idempotent backfill).
    9. Re-trigger reconciliation-daily-check; poll completion; re-query Mimir: drift_pct now ≤ 0.001 (effectively 0).

    Tear down with removeVolumes:true.
  </behavior>
  <action>
    The exact metric name `litellm_reconciliation_drift_pct` must match what Plan 08 emits + Plan 11's dashboard expects. Read 06-08-SUMMARY and 06-11-SUMMARY's openwhispr-reconciliation-drift dashboard JSON to confirm the canonical name. If they disagree, file a Rule-3 fix in this plan (test fails first, then align the producer + dashboard consumer).

    Mimir port from compose: read compose/mimir/ and the docker-compose.yml.

    Allow up to 90s wall time for the two queue cycles + Mimir scrape.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/reconciliation-drift.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Test contains `litellm_reconciliation_drift_pct`, `reconciliation-daily-check`, `reconciliation-discrepancy`, `usage_ledger`
    - Two reconciliation passes asserted (first drifts, second clean)
    - Exits 0 (allow up to 10 min — slowest test)
  </acceptance_criteria>
  <done>
    1 of 3 tests GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: log-scrub-sentinel e2e</name>
  <files>
    tests/e2e/log-scrub-sentinel.test.ts
  </files>
  <read_first>
    packages/observability/src/redact.ts (Plan 10 — canonical key list),
    tests/integration/log-scrub-sentinel.test.ts (Plan 10 — integration version this e2e mirrors at compose level)
  </read_first>
  <behavior>
    1. Boot compose default + worker. (LGTM optional for this test — pure container-log inspection.)
    2. testStart = Date.now().
    3. Sign in to capture real session.
    4. Send POST /api/transcribe with `Authorization: Bearer SENTINEL-AUTH-${testStart}` (deliberately invalid bearer — intent is to provoke request logging that would have leaked clear-text token if redact was misconfigured).
    5. Wait 2s for pino to flush.
    6. Capture api container logs: `await environment.getContainer('api').logs({ since: new Date(testStart) })` (testcontainers API — read 06-12a-SUMMARY for the exact helper signature).
    7. Assert: full log buffer does NOT contain the substring `SENTINEL-AUTH-${testStart}`.
    8. Repeat with worker: enqueue a debug job via Valkey carrying `{virtual_key: 'SENTINEL-VK-${testStart}'}` (the job will reject at Zod parse since virtual_key isn't an accepted job payload key OR will fail tenant-context guard — either way the sentinel must NOT leak to worker stdout).
    9. Capture worker container logs; assert SENTINEL-VK-${testStart} absent.

    Tear down with removeVolumes:true.
  </behavior>
  <action>
    The integration test in tests/integration/log-scrub-sentinel.test.ts (from Plan 10) already proves this works at the unit/integration tier. The e2e adds the boot-the-stack-and-tail-real-container-logs layer.

    Allow up to 6 min wall time.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/log-scrub-sentinel.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Test contains `SENTINEL-AUTH-`, `SENTINEL-VK-`, `getContainer`, `logs`
    - Asserts substring ABSENCE in both api and worker stdout
    - Exits 0
  </acceptance_criteria>
  <done>
    2 of 3 tests GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: otel-trace-propagation e2e</name>
  <files>
    tests/e2e/otel-trace-propagation.test.ts
  </files>
  <read_first>
    apps/api/src/otel-bootstrap.ts (Plan 03 — exporters + service.name),
    compose/grafana/provisioning/datasources/loki.yaml (Plan 03 + Plan 11 — derivedFields TraceID → tempo)
  </read_first>
  <behavior>
    1. Boot DockerComposeEnvironment with default profile + LGTM stack.
    2. Send a request to any authenticated route (sign-in first → GET /api/me).
    3. Capture trace_id from the response. Two options:
       - (a) If api emits W3C `traceresponse` header on response — read it directly.
       - (b) If not, extract from the pino log line emitted for that request via api container stdout.
       Prefer (a) if available.
    4. Wait 5-30s polling for Tempo ingestion: `GET http://tempo:3200/api/traces/{trace_id}` (mapped port). Assert ≥1 span exists with `service.name = 'openwhispr-api'` (or the project's actual service name from otel-bootstrap.ts).
    5. Query Loki: `GET http://loki:3100/loki/api/v1/query_range?query={service="api"} |~ "trace_id=${trace_id}"` (LogQL). Assert ≥1 log line returned — proves derivedFields TraceID extraction wired correctly end-to-end.

    Tear down with removeVolumes:true.
  </behavior>
  <action>
    Tempo ingestion is asynchronous — poll up to 30s.

    Loki query syntax: read compose/loki/ + 06-03-SUMMARY's derivedFields config to confirm exact regex/label scheme.

    If service.name in otel-bootstrap.ts is different from "openwhispr-api", use what's actually there.
  </action>
  <verify>
    <automated>E2E=1 pnpm vitest run tests/e2e/otel-trace-propagation.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Test contains `tempo`, `loki`, `trace_id`, asserts span + log correlation
    - Exits 0 (allow up to 8 min — Tempo ingest delay)
  </acceptance_criteria>
  <done>
    3 of 3 tests GREEN.
  </done>
</task>

</tasks>

<verification>
- All 3 e2e tests GREEN
- No regression on prior phase tests
</verification>

<success_criteria>
3 more of 8 Phase 6 e2e tests GREEN. OBS-01 + OBS-03 + OBS-04 observably proven through Tempo/Loki/Mimir HTTP APIs.
</success_criteria>

<output>
Create `.planning/phases/06-observability-ops-hardening-workers/06-12c-SUMMARY.md` with: test pass evidence, Tempo/Loki/Mimir ports + query examples, BullMQ enqueue-from-outside-worker pattern documented, blockers + retries.
</output>
