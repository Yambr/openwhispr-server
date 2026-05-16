# Phase 36: worker bundle (CR-5 + CR-6 closure) — Summary

**Status**: CLOSED 2026-05-16
**Atomic commits**: `92ece0d` (36.a), `d36818e` (36.b)
**Scope**: `apps/worker/src/jobs/audit-archive.ts` + `apps/worker/src/jobs/reconciliation-discrepancy.ts` (+ extended `runIngestOnce` signature in `ingest-litellm-spend.ts`)
**Lockers**: LOCKER-06 flipped WARN-only → BLOCKING

## 36.a — DATABASE_URL out of bash (CRIT-FIX-07 / `worker.md` CR-01)

**Outcome.** `audit-archive.ts:96-128` no longer composes `spawn('bash', ['-c', \`pg_dump ... "${dbUrl}" | gzip | mc pipe ...\`])`. The new pipeline:

1. Parses `dbUrl` ONCE via `new URL(dbUrl)` into `{host, port, user, password, database}` (exported as `parseDbUrl`).
2. Spawns each pipeline stage with `argv` form only (no shell). libpq connection details flow via `PG*` env vars (PGPASSWORD, PGHOST, PGPORT, PGUSER, PGDATABASE) — credentials never appear in argv / `ps auxww` / `/proc/<pid>/cmdline` / coredumps.
3. Chains stdout→stdin between stages via `node:child_process` stream piping.
4. On any non-zero exit, scrubs the password AND the full dbUrl from the aggregated stderr blob (`redactSecret()`) BEFORE throwing — so BullMQ `failedReason`, OTel exception attributes, and Loki structured logs see only `***`.

Exporter mapping:

| Exporter | Stages |
|---|---|
| `mc_cp` (default) | `pg_dump --table=... --data-only` → `gzip -c` → `mc pipe minio/<bucket>/...` |
| `s3_cli` | `pg_dump --table=... --data-only` → `gzip -c` → `aws s3 cp - s3://<bucket>/...` |
| `aws_s3` | `psql -X -v ON_ERROR_STOP=1 -c "SELECT aws_s3.query_export_to_s3(...)"` (single proc) |
| `custom` | `$AUDIT_ARCHIVE_CUSTOM_SCRIPT <partition>` (unchanged) |

**LOCKER-06 flip.** `--warn-only` dropped from `package.json:lint:shell-credential-interpolation`. The 3 audit-archive.ts seed entries (lines 106/115/127) removed from `tools/lint-shell-credential-interpolation.allowlist.txt`. LOCKER-06 is now BLOCKING — any future re-introduction of `spawn('bash', ['-c', \`...${cred}...\`])` in production source paths is refused by lefthook + CI.

**Deviation (recorded).** Flipping `--warn-only` surfaced 11 pre-existing test/tooling findings that the flag was masking — all in `tests/`, `tools/`, or `packages/data/migrations/__tests__/` (non-production paths, interpolating test-fixture passwords or non-secret operator hostnames). Documented in `.planning/phases/36-worker-bundle/36-a-DECISIONS.md §D-1` with explicit "pre-existing test debt" rationale and added to the allowlist with `Allowlist-grow-approved: issue-3607` trailer. Out of Phase 36 scope (CR-5 targets `apps/worker/src/`).

**Tests added (audit-archive.test.ts: 12 → 20 tests, all GREEN).**

- `parseDbUrl decomposes host/port/user/password/database`
- `parseDbUrl applies default port for missing port`
- `redactSecret replaces every occurrence with ***` (incl. regex-special-character password)
- `buildExportSteps(mc_cp)` / `(s3_cli)` / `(aws_s3)` — each asserts: no `bash` cmd, no `topsecret` substring in any argv, no `postgresql://` in any argv, PGPASSWORD lives in env
- **CRIT-FIX-07 regression**: thrown error on pg_dump failure with a noisy stderr containing the password does NOT contain that password in `.message` or `.stack` (the central anti-regression test for this fix)
- **CRIT-FIX-07 no-bash**: across all 3 non-custom exporters, no spawn call uses `bash` as command and no argv contains the password
- spawn `error` event reports redacted failure (ENOENT path)

**Coverage on diff.** `audit-archive.ts`: 98.6 / 91.1 / 94.1 / 100 (≥ 90/90/90/90 ✓).

## 36.b — reconciliation-discrepancy truth-telling (CRIT-FIX-08 / `worker.md` CR-02)

**Decision: Option A** (implement properly, not delete). Rationale: the cost — ~30 LOC in `ingest-litellm-spend.ts` to extend `runIngestOnce` signature with optional window args + ~20 LOC in `reconciliation-discrepancy.ts` to replace the double-cast with a closure-capture pattern — is well under the 100-LOC threshold for falling back to Option B. The handler IS registered as a BullMQ worker (`apps/worker/src/index.ts:221`) and IS enqueued (queue registry); deleting it would leave drift detected by `reconciliation-daily-check` without any backfill mechanism.

**Outcome — runIngestOnce signature extension** (`ingest-litellm-spend.ts`):

- New optional 2nd argument `opts: RunIngestOptions = {}` with `{ since?, until?, tenantId? }`.
- When `opts.since && opts.until` provided → **windowed mode**: SQL filters on `"startTime" >= $1 AND "startTime" < $2` (inclusive lower, exclusive upper). When `opts.tenantId` is also set → an up-front owner-pool subquery resolves the tenant's user IDs and the LiteLLM_SpendLogs scan adds `"end_user" = ANY($3::text[])` so cross-tenant rows are skipped. Empty-tenant short-circuit returns `{0, 0}` without the LiteLLM round-trip.
- When `opts` omitted/empty → **watermark mode** (existing behavior preserved exactly).
- **Watermark is NEVER written in windowed mode** — backfills must not poison the live tick.

**Outcome — handler honesty** (`reconciliation-discrepancy.ts`):

- The previous double-cast (`Promise<void>` masked as `Promise<{rowsProcessed,rowsScanned}>`) is gone.
- Replaced with a closure-captured `let captured: ReconciliationDiscrepancyResult | undefined`: the inner `withTenantContext` handler awaits `runIngestOnce(deps.ingestDeps, {since, until, tenantId})` and assigns the real result before returning void; the outer wrapper reads the slot. Defensive `!captured` branch is `c8 ignore`'d (structurally unreachable — would require the HOF to swallow a throw).
- The handler now passes `{since: data.since, until: data.until, tenantId: data.tenant_id}` into the extended ingest signature — the actual discrepancy window for the actual tenant is what gets re-ingested.

**Tests added (reconciliation-discrepancy.test.ts: 4 → 8 tests, all GREEN).**

- Schema rejection for non-ISO datetime + negative drift (preserved)
- `runIngestOnce` error propagation (preserved)
- **CRIT-FIX-08 forwards `{since, until, tenantId}` to runIngestOnce** — assertion on spy's `toHaveBeenCalledWith` arguments
- **CRIT-FIX-08 destructures cleanly** — caller does `const { rowsProcessed, rowsScanned } = await handler(job)` and gets real numbers (previously would have been `undefined.rowsProcessed → TypeError`)
- **CRIT-FIX-08 windowed-backfill integration** (real testcontainer) — seeds 4 spend rows (2 in-window for target tenant, 1 out-of-window for target tenant, 1 in-window for OTHER tenant); asserts `rowsScanned=2, rowsProcessed=2`, ledger has exactly the 2 target-tenant rows with `tenant_id` matching, watermark NOT advanced
- **CRIT-FIX-08 empty-tenant short-circuit** — windowed backfill for a tenant with zero users returns `{0, 0}`
- **windowed mode without tenantId** — scans every user inside the window (cross-tenant aggregation valid when caller explicitly omits the filter)

Regression coverage: 15/15 existing `ingest-litellm-spend.test.ts` watermark-mode tests still GREEN — the extension is purely additive.

**Coverage on diff.** `reconciliation-discrepancy.ts`: 100 / 100 / 100 / 100. `ingest-litellm-spend.ts`: 96.5 / 93.5 / 100 / 98.2. Both ≥ 90/90/90/90 ✓.

## Aggregate verification

- **77/77 worker job tests GREEN** across `apps/worker/tests/unit/jobs/` (audit-archive 20, reconciliation-discrepancy 8, ingest-litellm-spend 15, partman-maintenance + reconciliation-daily-check + email-delivery + usage-rollup-daily — preserved).
- **`pnpm lint:lockers` exits 0** on HEAD (`92ece0d` + `d36818e`).
- **`pnpm lint:shell-credential-interpolation` exits 0** with 11 WARN allowlisted (pre-existing test/tooling debt; see 36-a-DECISIONS.md §D-1) and 0 failing findings.
- **No type-suppression added.** `as unknown as` in `reconciliation-discrepancy.ts` is removed; the 3 mentions in comments were rephrased after LOCKER-02 flagged the literal token. Production-source diff is type-suppression-free.
- **No `bash` in any production-source spawn** in `apps/worker/src/jobs/`.

## Files touched

| File | Type | Notes |
|---|---|---|
| `apps/worker/src/jobs/audit-archive.ts` | rewrite | argv-array spawn pipeline, PG* env, redact, parseDbUrl + redactSecret + buildExportSteps + runPipeline exports |
| `apps/worker/src/jobs/reconciliation-discrepancy.ts` | rewrite | closure-capture instead of double-cast; payload {since,until,tenant_id} forwarded |
| `apps/worker/src/jobs/ingest-litellm-spend.ts` | extension | new `RunIngestOptions` type; windowed-mode SQL path; watermark-mode preserved |
| `apps/worker/tests/unit/jobs/audit-archive.test.ts` | rewrite | 12 → 20 tests including the central no-leak regression |
| `apps/worker/tests/unit/jobs/reconciliation-discrepancy.test.ts` | rewrite | 4 → 8 tests including real-testcontainer windowed-backfill integration |
| `tools/lint-shell-credential-interpolation.allowlist.txt` | update | 3 seed entries removed; 11 pre-existing test/tooling entries added with rationale |
| `package.json` | update | `--warn-only` dropped from `lint:shell-credential-interpolation` script |
| `.planning/phases/36-worker-bundle/36-a-DECISIONS.md` | new | §D-1 rationale for the 11 test/tooling allowlist entries |

## Deferred / follow-up

- **Test/tooling LOCKER-06 cleanup** (11 entries). Out of Phase 36 scope. A future-phase entry should be added to ROADMAP.md for a dedicated test/tooling pipeline rewrite (`tests/e2e/compose-helper.ts` + `tests/e2e/helpers/phase6-compose.ts` use the `bash -c "until curl ${BACKEND_URL}/health; do sleep 1; done"` wait-for pattern; rewriting as a node polling loop touches the entire e2e harness, multi-hour change). Not blocking any v2.2 milestone.

## Self-Check

- [x] `apps/worker/src/jobs/audit-archive.ts` modified — argv form + redaction in commit `92ece0d`.
- [x] `apps/worker/src/jobs/reconciliation-discrepancy.ts` modified — closure capture + payload-forwarding in commit `d36818e`.
- [x] `apps/worker/src/jobs/ingest-litellm-spend.ts` modified — `RunIngestOptions` extension in commit `d36818e`.
- [x] `tools/lint-shell-credential-interpolation.allowlist.txt` updated — verified `pnpm lint:lockers` exits 0.
- [x] `package.json` updated — `--warn-only` removed from `lint:shell-credential-interpolation` script.
- [x] Both commit SHAs (`92ece0d`, `d36818e`) present in `git log --oneline -10`.
- [x] `.planning/REQUIREMENTS.md` — CRIT-FIX-07 + CRIT-FIX-08 flipped to Complete; LOCKER-06 flipped to BLOCKING.
- [x] `.planning/ROADMAP.md` Phase 36 row flipped `[ ] → [x]` with closure context.

## Self-Check: PASSED
