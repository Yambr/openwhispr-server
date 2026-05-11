---
phase: 06-observability-ops-hardening-workers
plan: 11
subsystem: observability-dashboards
tags: [grafana, dashboards, mimir, loki, tempo, postgres, alerting, reconciliation, wave-2]
requirements: [OBS-01, OBS-02, OBS-04]
dependency-graph:
  requires:
    - "06-03 (Loki derivedFields trace_id -> Tempo + OTel SDK bootstrap)"
    - "06-08 (reconciliation-daily-check BullMQ job + litellm_reconciliation_drift_{pct,usd_cents} Mimir gauges)"
    - "06.1 (Tempo + Mimir + Loki + Grafana compose services with filesystem backends)"
  provides:
    - "4 default Grafana dashboards auto-provisioned on first docker compose up"
    - "Grafana unified-alerting rules for reconciliation drift (D-R3 thresholds + env overrides)"
    - "Read-only Postgres datasource (postgres-readonly UID) for usage_ledger queries"
    - "Self-test asserts dashboard JSON + datasource UID + alert rule integrity at every CI run"
    - "Operator observability guide (docs/observability.md, 401 lines) covering all D-T/D-P/D-A/D-R/D-RL/D-S anchors"
  affects:
    - "Operators get observability surface visible on first install; no manual dashboard import"
    - "Phase 6 reconciliation flow now observable end-to-end (D-R2 gauges -> dashboard -> alert)"
tech-stack:
  added: []
  patterns:
    - "Grafana provisioning (dashboards.yaml + datasources/*.yaml + alerting/*.yaml) auto-load on Grafana startup"
    - "Self-test scrapes datasource UIDs from YAML at test time so JSON-side UID references cannot go stale"
    - "ASCII-only docs (em-dash/section/arrow flattening) so the lint-english scanner cannot trip"
key-files:
  created:
    - compose/grafana/provisioning/dashboards/red-saturation.json
    - compose/grafana/provisioning/dashboards/per-tenant-usage.json
    - compose/grafana/provisioning/dashboards/litellm-spend.json
    - compose/grafana/provisioning/dashboards/reconciliation-drift.json
    - compose/grafana/provisioning/dashboards/dashboards.yaml
    - compose/grafana/provisioning/datasources/postgres.yaml
    - compose/grafana/provisioning/alerting/reconciliation-alerts.yaml
    - tests/self-tests/grafana-dashboards-validate.test.ts
    - docs/observability.md
  modified: []
decisions:
  - "Postgres datasource bootstrap (grafana_reader role) documented in the YAML header rather than auto-created via a 0016 migration; the role is operator-scoped and crosses the apps/data boundary in a way that warranted explicit operator review (DEFERRED, see Known Stubs)."
  - "ASCII-only docs achieved via Perl flatten pass (em-dash -> --, section -> 'section ', arrows -> ->); the lint-english tool's regex catches only Cyrillic, but the plan's acceptance criterion required no non-ASCII bytes per DOCS-09."
metrics:
  duration: ~25min
  completed: "2026-05-11"
---

# Phase 6 Plan 11: Observability Dashboards + Reconciliation Alerts + Operator Guide

Ships the four default Grafana dashboards (RED + saturation, per-tenant usage, LiteLLM spend, reconciliation drift), two unified-alerting rules for D-R3 reconciliation drift thresholds, the read-only Postgres datasource, the dashboard-validation self-test, and a 401-line operator observability guide. Closes OBS-01 (correlation IDs visible end-to-end via Loki <-> Tempo links Plan 03 already wired), OBS-02 (default dashboards shipped in-tree), OBS-04 (reconciliation drift dashboard + alert).

## Tasks Completed

### Task 1 -- 4 dashboards + alert YAML + Postgres datasource + validator self-test (TDD)

**RED** (commit `cda474e`): created `tests/self-tests/grafana-dashboards-validate.test.ts` asserting (a) 4 required dashboard files present, (b) each has `title`/`schemaVersion`/`panels`/`openwhispr-`-prefixed `uid`, (c) every non-row/text panel resolves its `datasource.uid` to a UID actually declared in the `compose/grafana/provisioning/datasources/*.yaml` files (regex-scraped at test time so the linkage cannot rot), (d) every such panel carries a non-empty PromQL `expr`, Postgres `rawSql`, or Loki `query`, (e) `reconciliation-drift.json` references both D-R2 gauge names, (f) the alert YAML declares the two D-R3 rule UIDs, (g) `loki.yaml` retains Plan 03's derivedFields, (h) `dashboards.yaml` provider manifest exists and points at the dashboards directory. 17 of 18 tests fail at RED; the lone passing test (loki derivedFields) is the Plan 03 carry-over that this plan must not regress.

**GREEN** (commit `0205dce`, see Deviations -- subject is mis-labelled `feat(06-10)` due to parallel-agent commit race): created the four dashboards plus the provisioning manifests:

- **`red-saturation.json`** -- 9 panels: req/s by route (`sum by (http_route) (rate(http_server_duration_count[5m]))`), 5xx rate by route, p50/p95/p99 latency via `histogram_quantile(...)`, BullMQ queue saturation (`bullmq_queue_active + _wait + _delayed`), BullMQ job duration p95, 429/sec total, x-served-by replica cardinality. All Mimir/Prometheus.
- **`per-tenant-usage.json`** -- 5 panels: top-20 spend table, hourly transcribe/reason/streaming minutes per tenant, active-tenant count. All Postgres (`postgres-readonly` datasource).
- **`litellm-spend.json`** -- 5 panels: 24h + 7d total stat, hourly spend timeseries, spend by model, spend by tenant + model. All Postgres.
- **`reconciliation-drift.json`** -- 4 panels charting both Mimir gauges `litellm_reconciliation_drift_pct{tenant_id}` and `litellm_reconciliation_drift_usd_cents{tenant_id}` (from Plan 06-08 D-R2) with threshold colour bands at the D-R3 defaults (0.5 %, 1 cent). Plus two `max(...)` stat panels.
- **`dashboards.yaml`** -- file provider, folder `OpenWhispr`, `disableDeletion: true`, scan interval 30 s.
- **`datasources/postgres.yaml`** -- new postgres-readonly datasource over PgBouncer:6432 as the `grafana_reader` role. Password from `GRAFANA_POSTGRES_READER_PASSWORD` env. **Operator must create the role before the spend / per-tenant-usage dashboards work** -- documented in the YAML header (see Known Stubs).
- **`alerting/reconciliation-alerts.yaml`** -- unified-alerting group `reconciliation`, folder `OpenWhispr`, interval 1 h. Two rules `reconciliation_drift_pct_high` (`max(litellm_reconciliation_drift_pct) > 0.5` for 1 h) and `reconciliation_drift_usd_high` (`max(litellm_reconciliation_drift_usd_cents) > 1` for 1 h). Each uses a `__expr__` threshold node referring to the Mimir query refId `A`. Labels include `severity: warning, owner: openwhispr, subsystem: reconciliation`; annotations point at `/docs/observability.md#litellm-reconciliation` as the runbook URL.

Self-test after GREEN: 18/18 passing. All 4 dashboards parse via `node -e "JSON.parse(...)"`. Datasource UID linkage verified (`loki`, `tempo`, `mimir`, `postgres-readonly` all declared in `datasources/*.yaml`; the test's UID-scrape function found them all).

### Task 2 -- docs/observability.md (commit `66866fe`)

Wrote the 401-line operator guide with the 9 sections required by the plan: stack overview, probes (D-P1/P2), the 4 dashboards, log correlation, reconciliation, audit log (D-A1..A7), rate limits (D-RL1..RL3), SSRF defense (D-S1..S6), troubleshooting. 25 D-* anchors referenced inline back to `06-CONTEXT.md`. ASCII-only -- the file initially contained em-dashes, section symbols, and the `<->` arrow which violated DOCS-09's no-non-ASCII rule; a Perl flatten pass replaced them with `--`, `section `, `<->` (ASCII). `pnpm exec tsx tools/lint-english.ts docs/observability.md` exits 0.

## Verification

### Automated

- `pnpm vitest run tests/self-tests/grafana-dashboards-validate.test.ts` -> **18 / 18 tests pass**.
- `for f in compose/grafana/provisioning/dashboards/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))"; done` -> all 4 dashboards parse without error.
- `pnpm exec tsx tools/lint-english.ts docs/observability.md` -> exits 0 (no Cyrillic).
- `wc -l docs/observability.md` -> **401** (>= 200 required).
- `grep -c "D-" docs/observability.md` -> 25 D-* anchors (>= 5 required).
- `grep -P '[^\x00-\x7F]' docs/observability.md` -> empty (no non-ASCII bytes).
- `grep -l 'litellm_reconciliation_drift_pct' compose/grafana/provisioning/dashboards/reconciliation-drift.json` matches.
- `grep -l 'litellm_reconciliation_drift_usd_cents' compose/grafana/provisioning/dashboards/reconciliation-drift.json` matches.
- `grep -l 'reconciliation_drift_pct_high\|reconciliation_drift_usd_high' compose/grafana/provisioning/alerting/reconciliation-alerts.yaml` matches both.

### Coverage

The Task 1 deliverable is a self-test file plus declarative JSON/YAML provisioning artifacts. The test file `tests/self-tests/grafana-dashboards-validate.test.ts` lives under `tests/` which `vitest.config.ts` excludes from coverage by design (self-tests are validators, not coverage targets). The dashboard JSON, dashboards.yaml, postgres.yaml, and reconciliation-alerts.yaml files are not TypeScript and cannot be covered. No new production TS code was authored in this plan, so the 90/90/90/90 floor applies vacuously -- the self-test executes every code path of its own validator inline and all 18 assertions pass.

### Manual

A live `docker compose up grafana` (deferred to Plan 06-12 e2e) is the planned visual smoke test. Static dashboard syntax is validated by this plan's self-test; live rendering is the Plan 06-12 deliverable.

## LiteLLM-stays-on-its-own-side

This plan's reconciliation dashboard and alerts treat LiteLLM as the opaque sidecar per the locked steering. The Mimir gauges the dashboard charts are emitted by **our** `reconciliation-daily-check` BullMQ job (Plan 06-08), which reads LiteLLM's `LiteLLM_SpendLogs` table via the existing co-tenant Postgres connection. No LiteLLM-side instrumentation, no W3C traceparent across the boundary, no patches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 -- Blocking issue] Parallel-agent commit race absorbed dashboard files into a `feat(06-10)` commit**

- **Found during:** Task 1 GREEN commit attempt.
- **Issue:** A parallel agent working on Plan 06-10 (`@openwhispr/observability` shared redact package) had its own staged work running through the lefthook pre-commit. When I ran `git commit` against my staged 06-11 dashboard files, the running parallel commit included my staged files in commit `0205dce` whose subject reads `feat(06-10): shared @openwhispr/observability redact config`. The dashboard files **are** present in `0205dce`'s diff (see `git show 0205dce --stat`); they were not lost.
- **Fix:** Verified on-disk presence of all 7 Task 1 artifacts and re-ran the validator self-test (18/18 pass). The 06-11 dashboard files now live in commit `0205dce` even though the subject names a different plan. Rather than rewrite published history with a force-push (which the user has not authorised), this SUMMARY records the placement explicitly so audit trails remain coherent.
- **Files affected:** all 7 Task 1 artifacts.
- **Commit:** `0205dce` (subject `feat(06-10)` -- contains Plan 06-11 Task 1 GREEN artifacts).

**2. [Rule 2 -- Missing critical functionality] ASCII flatten of docs/observability.md**

- **Found during:** Task 2 acceptance check (`grep -P '[^\x00-\x7F]' docs/observability.md`).
- **Issue:** The plan's acceptance criterion required `grep -P '[^\x00-\x7F]' docs/observability.md` to return empty. The initial draft used em-dashes (`--` -> em-dash), the section symbol, and an Unicode arrow in the Loki <-> Tempo heading. None are Cyrillic so `tools/lint-english.ts` accepted them, but the plan's acceptance criterion is stricter (no non-ASCII bytes at all -- DOCS-09 read literally).
- **Fix:** `perl -i -pe 's/—/--/g; s/§/section /g; s/↔/<->/g; s/→/->/g; s/×/x/g'` flatten pass.
- **Files modified:** `docs/observability.md`.
- **Commit:** `66866fe`.

### Architectural Decisions Not in Plan

**Postgres `grafana_reader` role bootstrap deferred to operator.** The plan's `<action>` block notes "if creating the read-only role requires a migration, add a 0012 migration in a small follow-up -- flag in SUMMARY". The role crosses the apps/data boundary (operator-tier, READ on every table in `public`, no RLS) in a way that the existing migration tooling (which models app roles + RLS policies for the app tier) does not cover cleanly. The role + GRANTs are documented in the header of `compose/grafana/provisioning/datasources/postgres.yaml` for the operator to apply manually. A follow-up migration to automate the bootstrap is tracked in Known Stubs.

## Known Stubs

1. **`grafana_reader` Postgres role -- operator-bootstrapped, no migration yet.** The two Postgres-datasource dashboards (`per-tenant-usage`, `litellm-spend`) will return "permission denied" until the operator runs the `CREATE ROLE grafana_reader; GRANT ...` block from the `postgres.yaml` header. Not a blocker for the OBS-04 reconciliation surface (Mimir-only). Tracked as a follow-up: introduce migration `0016_grafana_reader_role.sql` plus a `.env.example` entry for `GRAFANA_POSTGRES_READER_PASSWORD`.

2. **Mimir alert rule rendering not visually verified.** Grafana unified-alerting YAML accepts the shape used here, but a live `docker compose up grafana` smoke test against the YAML is the Plan 06-12 deliverable. The self-test confirms the two rule UIDs and the metric names; it does not exercise Grafana's YAML parser.

3. **Dashboard PromQL syntactic validation not run against `promtool`.** The plan suggested an optional `tools/validate-dashboards.ts` that uses `@grafana/promql` or shells out to `promtool` to syntactically validate every panel query. This would require pulling `promtool` into the dev-tools chain (no Node parser exists for PromQL with comparable fidelity). Deferred: the queries used here are textbook PromQL/SQL patterns from the Grafana documentation -- syntactically validated by inspection. Plan 06-12 e2e will exercise them against a live Mimir/Postgres.

## Threat Flags

None. This plan adds only declarative provisioning + operator docs. No new network endpoints, no auth paths, no schema changes. The `grafana_reader` role surface is enumerated in the threat register as `T-06-20` (info-disclosure, disposition `accept` -- "operators have full read access by design").

## Atomic Commits

| Hash | Subject | Notes |
|------|---------|-------|
| `cda474e` | test(06-11): add failing self-test for 4 Grafana dashboards + alert + datasources | RED (17 failing) |
| `0205dce` | feat(06-10): shared @openwhispr/observability redact config | **Contains 06-11 Task 1 GREEN artifacts** (see Deviation 1); subject mislabelled by parallel-agent commit race |
| `66866fe` | docs(06-11): add operator observability guide | Task 2 |

## Self-Check: PASSED

- [x] `compose/grafana/provisioning/dashboards/red-saturation.json` exists.
- [x] `compose/grafana/provisioning/dashboards/per-tenant-usage.json` exists.
- [x] `compose/grafana/provisioning/dashboards/litellm-spend.json` exists.
- [x] `compose/grafana/provisioning/dashboards/reconciliation-drift.json` exists.
- [x] `compose/grafana/provisioning/dashboards/dashboards.yaml` exists.
- [x] `compose/grafana/provisioning/datasources/postgres.yaml` exists.
- [x] `compose/grafana/provisioning/alerting/reconciliation-alerts.yaml` exists.
- [x] `tests/self-tests/grafana-dashboards-validate.test.ts` exists (commit `cda474e` in git log).
- [x] `docs/observability.md` exists, 401 lines, ASCII-only.
- [x] Commit `cda474e` present in git log.
- [x] Commit `0205dce` present in git log (carries Task 1 GREEN artifacts).
- [x] Commit `66866fe` present in git log.
- [x] `pnpm vitest run tests/self-tests/grafana-dashboards-validate.test.ts` -> 18/18 pass.
- [x] `pnpm exec tsx tools/lint-english.ts docs/observability.md` -> exits 0.
