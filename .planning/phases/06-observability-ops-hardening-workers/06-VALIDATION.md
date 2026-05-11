---
phase: 6
slug: observability-ops-hardening-workers
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Constitutional: strict TDD (RED → GREEN → REFACTOR), ≥90% on lines/branches/functions/statements,
> real services via testcontainers, mandatory e2e against live docker-compose, no mocks of internal logic.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (workspace runner across `apps/api`, `apps/worker`, `packages/data`) + Playwright/testcontainers for e2e |
| **Config file** | `vitest.config.ts` (per-package), root `vitest.workspace.ts`, `tests/e2e/playwright.config.ts` |
| **Quick run command** | `pnpm -F @openwhispr/api test --run` (or scoped: `pnpm -F @openwhispr/worker test --run`) |
| **Full suite command** | `pnpm -r test --run --coverage` |
| **E2E command** | `E2E=1 make e2e-test` (boots real docker-compose stack via testcontainers) |
| **Coverage gate** | `pnpm -r test --coverage` must report ≥90% on lines/branches/functions/statements for all Phase 6 new/modified files |
| **Estimated runtime** | unit ~25s · integration ~90s (testcontainer warm) · e2e ~5–8 min |

---

## Sampling Rate

- **After every task commit:** Run the package-scoped quick command for the touched workspace.
- **After every plan wave:** Run full `pnpm -r test --run --coverage`.
- **Before `/gsd-verify-work`:** Full suite + `E2E=1 make e2e-test` must be green and coverage ≥90/90/90/90.
- **Max feedback latency:** 30s (unit), 90s (integration), 8min (e2e gate).

---

## Per-Task Verification Map

> Detailed task→test mapping is materialized by the planner in `*-PLAN.md` files (each task carries `<automated>` and `<acceptance_criteria>`). High-level requirement→test-file mapping below.

| Requirement | Test Type | Test Files (Wave 0 stubs MUST exist before any GREEN code) |
|---|---|---|
| OBS-01 (OTel auto-instrumentation) | integration + e2e | `apps/api/src/otel-bootstrap.test.ts`, `tests/e2e/otel-trace-propagation.test.ts` |
| OBS-02 (pino log correlation + scrubbing) | unit + integration | `apps/api/src/plugins/request-log.test.ts`, `tests/integration/log-scrub-sentinel.test.ts`, `tests/e2e/log-scrub-sentinel.test.ts` |
| OBS-03 (audit_log 18-action + partitioning) | integration + e2e | `packages/data/src/__tests__/audit-log-actions.test.ts`, `packages/data/src/__tests__/audit-log-partitioning.test.ts`, `tests/e2e/audit-log-write.test.ts` |
| OBS-04 (LiteLLM spend reconciliation) | integration + e2e | `apps/worker/src/jobs/reconciliation-daily-check.test.ts`, `apps/worker/src/jobs/reconciliation-discrepancy.test.ts`, `tests/e2e/reconciliation-drift.test.ts` |
| OBS-05 (/livez /readyz /startupz) | unit + integration + e2e | `apps/api/src/routes/probes.test.ts`, `apps/api/src/lib/dep-check.test.ts`, `tests/e2e/probes-dependency.test.ts` |
| DATA-04 (audit table extends) | integration | `packages/data/migrations/*-pg-partman-audit.test.ts`, `tools/lint-rls.test.ts` (verifies partitioned-child RLS) |
| SCALE-01 (horizontal scale) | e2e | `tests/e2e/horizontal-scale.test.ts` (docker compose --scale api=2 via testcontainers DockerComposeEnvironment) |
| SCALE-03 (worker tenant context) | unit + integration + property | `apps/worker/src/lib/with-tenant-context.test.ts`, `apps/worker/src/lib/with-system-context.test.ts`, `apps/worker/src/db/app-pool.test.ts`, `packages/data/src/__tests__/worker-rls-property.test.ts`, `tools/lint-tenant-context.test.ts` |
| SCALE-04 (rate limit + SSRF) | unit + integration + e2e | `apps/api/src/plugins/rate-limit.test.ts`, `apps/api/src/lib/ssrf-dispatcher.test.ts`, `tests/integration/ssrf-cidr-matrix.test.ts`, `tests/e2e/ssrf-block.test.ts`, `tests/e2e/rate-limit-layered.test.ts` |

Per-task mapping (`{phase}-{plan}-{task}` → `<automated>` command) is enforced inside each PLAN.md by the planner; the executor cannot mark a task done without the automated check passing.

---

## Wave 0 Requirements

Wave 0 (RED) MUST create all of the following test files as compiling stubs before any production code lands:

- [ ] `apps/api/src/otel-bootstrap.test.ts` — OTel SDK init order, instrumentation list, no `/metrics` endpoint
- [ ] `apps/api/src/plugins/request-log.test.ts` — pino redact paths, English-only keys, trace_id injection
- [ ] `apps/api/src/routes/probes.test.ts` — /livez (no deps), /readyz (deps), /startupz (boot), /api/health alias
- [ ] `apps/api/src/lib/dep-check.test.ts` — 5s TTL cache, single re-check on expiry, dep-down → 503
- [ ] `apps/api/src/lib/ssrf-dispatcher.test.ts` — CIDR block-list (incl. 169.254.169.254), allow-list match, single-resolve, IPv6 unwrap
- [ ] `apps/api/src/plugins/rate-limit.test.ts` — layered keying, per-route matrix, X-RateLimit-* headers, 429 envelope
- [ ] `apps/api/src/plugins/served-by.test.ts` — `x-served-by` onSend hook
- [ ] `apps/worker/src/lib/with-tenant-context.test.ts` — Zod parse, SET LOCAL inside txn, MDC, OTel span, rollback on throw
- [ ] `apps/worker/src/lib/with-system-context.test.ts` — no GUC set, postgres_owner pool, MDC `mode:'system'`
- [ ] `apps/worker/src/db/app-pool.test.ts` — runtime guard throws TenantContextMissingError when GUC absent
- [ ] `apps/worker/src/jobs/email-delivery.test.ts` — tenant-scoped, Zod schema, no PII in logs
- [ ] `apps/worker/src/jobs/usage-rollup-daily.test.ts` — System dispatcher → Tenant child fan-out
- [ ] `apps/worker/src/jobs/virtual-key-rotation.test.ts` — scheduled + manual triggers, audit_log entry
- [ ] `apps/worker/src/jobs/reconciliation-daily-check.test.ts` — per-tenant drift gauges, threshold trigger
- [ ] `apps/worker/src/jobs/reconciliation-discrepancy.test.ts` — backfill call into ingest-litellm-spend, idempotent
- [ ] `apps/worker/src/jobs/partman-maintenance.test.ts` — calls partman.run_maintenance_proc, idempotent
- [ ] `apps/worker/src/jobs/audit-archive.test.ts` — partition detach + export via configured exporter
- [ ] `packages/data/src/__tests__/audit-log-actions.test.ts` — CHECK constraint covers 18 actions, rejects others
- [ ] `packages/data/src/__tests__/audit-log-partitioning.test.ts` — monthly children inherit RLS, insert routes correctly
- [ ] `packages/data/src/__tests__/worker-rls-property.test.ts` — concurrent tenant-A/tenant-B jobs see only own rows
- [ ] `tools/lint-tenant-context.test.ts` — TS-AST linter fails when job handler lacks withTenantContext/withSystemContext
- [ ] `tools/lint-rls.test.ts` — extended: partitioned-table children inherit RLS
- [ ] `tests/e2e/horizontal-scale.test.ts` — DockerComposeEnvironment.withScale("api",2), Traefik round-robin, session continuity
- [ ] `tests/e2e/ssrf-block.test.ts` — outbound to 169.254.169.254 returns 502 + audit row
- [ ] `tests/e2e/audit-log-write.test.ts` — auth signin emits canonical row with required payload keys
- [ ] `tests/e2e/reconciliation-drift.test.ts` — inject drift > threshold → alert fires + backfill enqueued
- [ ] `tests/e2e/log-scrub-sentinel.test.ts` — sentinel token never appears in captured stdout
- [ ] `tests/e2e/probes-dependency.test.ts` — pause Postgres → /readyz 503; resume → 200
- [ ] `tests/e2e/rate-limit-layered.test.ts` — exceed user-tier → 429; exceed IP-tier from many sessions → 429
- [ ] `tests/e2e/otel-trace-propagation.test.ts` — Tempo receives spans correlated with pino log trace_id
- [ ] Drizzle migration test harness: `packages/data/migrations/*-pg-partman-audit.test.ts` — forward + rollback both pass

*All Wave 0 stubs must compile and FAIL with a clear "not yet implemented" assertion. Implementation is GREEN-phase only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grafana dashboards render correctly | OBS-01 | UI visual confirmation | Boot `make compose-up`, open `http://localhost:3000`, log in admin/admin, verify each of RED+saturation, per-tenant usage, LiteLLM spend, reconciliation drift dashboards loads with data after k6 smoke. Automated: dashboard JSON shape + `grafana.com/api/dashboards` HTTP probe. |
| Loki derived-field log↔trace link clickable | OBS-02 | UI affordance | In Grafana Explore, pick a log line, confirm `trace_id` is a clickable link that lands on the matching Tempo trace. Automated half: dashboard provisioning JSON validated in CI. |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (31 stub files listed above)
- [ ] No watch-mode flags (CI: `--run`, never `--watch`)
- [ ] Feedback latency < 30s for unit, < 90s for integration, < 8min e2e
- [ ] Coverage ≥ 90% on lines/branches/functions/statements for every Phase 6 new/modified file
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 3 verifier confirms

**Approval:** pending
