---
phase: 1
slug: core-infra-multi-tenant-data
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-09
updated: 2026-05-09
---

# Phase 1 — Validation Strategy

> Per-task validation contract used during execution feedback sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit/integration/property) + @fast-check/vitest 0.4.1 + testcontainers 10.x + @testcontainers/postgresql |
| **Config files** | `vitest.config.ts` (root); `packages/data/package.json` exports |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` |
| **Phase gate command** | `pnpm lint && pnpm lint:english && pnpm typecheck && pnpm test && pnpm lint:rls && pnpm vitest run tests/self-tests/ tests/infra/compose-schema.test.ts && make up && bash tests/infra/smoke.sh && bash tests/infra/otel-roundtrip.sh && bash tests/infra/loki-roundtrip.sh && bash tests/infra/mimir-roundtrip.sh && make down` |
| **Estimated runtime** | Quick: ~10s. Full (with testcontainers + age): ~5-7 min including PgBouncer-sidecar property test. |

---

## Sampling Rate

- After every task commit: `pnpm vitest run --changed`
- After every wave merge: `pnpm test` + `pnpm lint:rls` + `pnpm vitest run tests/self-tests/ tests/infra/`
- Before `/gsd-verify-work`: full GHA run on a real PR; lint-rls + test-migration jobs green
- Max feedback latency: 30s for unit, 5-7min for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement(s) | Test Type | Automated Command | Status |
|---------|------|------|----------------|-----------|-------------------|--------|
| 1-01-1 | 01 | 1 | PROVIDER-02, DATA-06 (substrate) | unit (compose-schema) + bash syntax | `pnpm vitest run tests/infra/compose-schema.test.ts && bash -n tests/infra/*.sh` | pending |
| 1-01-2 | 01 | 1 | PROVIDER-02, DATA-06 | unit (compose-schema), grep-verify config files | `pnpm vitest run tests/infra/compose-schema.test.ts && grep -q 'edoburu/pgbouncer:1.23.1' docker-compose.yml && grep -q 'pool_mode = transaction' compose/pgbouncer/pgbouncer.ini && grep -q 'X-Scope-OrgID' compose/otel-collector/config.yaml && grep -q 'readTimeout: 3700s' compose/traefik/traefik.yml && grep -q 'MASTER_KEK=PLACEHOLDER' .env.example && test -f compose/grafana/provisioning/datasources/tempo.yaml` | pending |
| 1-02-1 | 02 | 1 | DATA-05, DATA-06 | self-test (TDD red) | `pnpm vitest run tests/self-tests/refuse-default-secrets.test.ts apps/api/scripts/check-default-secrets.test.ts` | pending |
| 1-02-2 | 02 | 1 | DATA-05, DATA-06 | self-test (TDD green) + grep | `pnpm vitest run tests/self-tests/refuse-default-secrets.test.ts apps/api/scripts/check-default-secrets.test.ts && bash -n tools/bootstrap.sh && grep -q 'BASH_VERSINFO' tools/bootstrap.sh && grep -q 'set -euo pipefail' tools/bootstrap.sh && test -x tools/bootstrap.sh && grep -q 'REQUIRED_KEYS' apps/api/scripts/check-default-secrets.ts` | pending |
| 1-03-1 | 03 | 2 | DATA-01, DATA-02, DATA-06 | unit + integration (TDD red) | `pnpm vitest run packages/data/src/__tests__/migration-rollback.test.ts packages/data/src/__tests__/usage-ledger.test.ts packages/data/src/__tests__/audit-log.test.ts` | pending |
| 1-03-2 | 03 | 2 | DATA-01, DATA-02, DATA-06 | integration (TDD green) + grep | `pnpm vitest run packages/data/src/__tests__/migration-rollback.test.ts packages/data/src/__tests__/usage-ledger.test.ts packages/data/src/__tests__/audit-log.test.ts && grep -q 'FORCE  ROW LEVEL SECURITY' packages/data/migrations/0000_initial.sql && grep -q '00000000-0000-0000-0000-000000000000' packages/data/migrations/0000_initial.sql && grep -q 'CREATE POLICY users_tenant_isolation' packages/data/migrations/0000_initial.sql && grep -q 'BYPASSRLS' packages/data/migrations/init/00-roles.sql && grep -q 'rolbypassrls' packages/data/migrations/init/00-roles.sql` | pending |
| 1-04-1 | 04 | 2 | DATA-01 | unit + integration (PgBouncer interleave) | `pnpm vitest run packages/data/src/__tests__/tenant-context.test.ts packages/data/src/__tests__/pgbouncer-interleave.test.ts apps/api/src/middleware/tenant.test.ts && grep -q "set_config\\('app.tenant_id'" packages/data/src/tenant-context.ts && grep -q 'addHook' apps/api/src/middleware/tenant.ts` | pending |
| 1-04-2 | 04 | 2 | DATA-05 | unit (envelope + key-provider) | `pnpm vitest run packages/data/src/__tests__/envelope.test.ts packages/data/src/__tests__/key-provider.test.ts && grep -q "createCipheriv\\('aes-256-gcm'" packages/data/src/encryption/env-key-provider.ts && grep -q 'randomBytes(12)' packages/data/src/encryption/env-key-provider.ts && grep -q 'not implemented in v1' packages/data/src/encryption/vault-key-provider.ts && grep -q 'not implemented in v1' packages/data/src/encryption/kms-key-provider.ts` | pending |
| 1-05-1 | 05 | 3 | TEST-RLS-01 (lint slice) | unit + self-test | `pnpm vitest run tools/lint-rls.test.ts tests/self-tests/rls-introspection.test.ts && grep -q 'app.tenant_id' tools/lint-rls.ts && grep -q '#!/usr/bin/env -S pnpm exec tsx' tools/lint-rls.ts` | pending |
| 1-05-2 | 05 | 3 | TEST-RLS-01 | property (fast-check 100 pairs) | `pnpm vitest run packages/data/src/__tests__/rls-property.test.ts && grep -q 'fc.uuid' packages/data/src/__tests__/rls-property.test.ts && grep -q 'edoburu/pgbouncer:1.23.1' packages/data/src/__tests__/rls-property.test.ts && grep -q 'numRuns: 100' packages/data/src/__tests__/rls-property.test.ts && grep -q '"fast-check": "4.7.0"' packages/data/package.json` | pending |
| 1-05-3 | 05 | 3 | TEST-RLS-01, TEST-MIGRATION-01 | CI workflow + branch-protection drift self-test | `grep -q 'lint-rls:' .github/workflows/ci.yml && grep -q 'test-migration:' .github/workflows/ci.yml && grep -q '"lint-rls"' scripts/branch-protection.json && grep -q '"test-migration"' scripts/branch-protection.json && grep -q 'postgres:17-alpine' .github/workflows/ci.yml && grep -q 'pg_dump --schema-only' .github/workflows/ci.yml && pnpm vitest run tests/self-tests/branch-protection-contexts.test.ts` | pending |
| 1-06-1 | 06 | 3 | DATA-07 | integration (testcontainers + age) | `bash -n scripts/backup/make-backup.sh && bash -n scripts/backup/make-restore.sh && grep -q 'pg_dump -Fc' scripts/backup/make-backup.sh && grep -q 'age -d' scripts/backup/make-restore.sh && grep -q 'information_schema.tables' scripts/backup/make-restore.sh && grep -q 'age-keygen -y' tools/bootstrap.sh && pnpm vitest run tests/integration/backup-restore.test.ts` | pending |
| 1-06-2 | 06 | 3 | DATA-07 | CI workflow (nightly) + docs lint | `grep -q 'backup-roundtrip:' .github/workflows/nightly.yml && grep -q 'BACKUP_AGE_IDENTITY' .github/workflows/nightly.yml && grep -q 'age-keygen -y' .github/workflows/nightly.yml && grep -q 'diff -u /tmp/schema-pre.sql /tmp/schema-post.sql' .github/workflows/nightly.yml && grep -q 'tenants/' docs/storage.md && grep -q 'make backup' docs/operations.md && grep -q 'BACKUP_AGE_IDENTITY' docs/operations.md && pnpm lint:english` | pending |

*Status legend: pending · green · red · flaky*

---

## Wave 0 Requirements

The following substrate must exist before Plan 03/04/05/06 tasks can run. Plans 01 and 02 (Wave 1) supply all of it.

- [ ] `tests/infra/compose-schema.test.ts` (Plan 01-1) — RED before docker-compose.yml expansion lands
- [ ] `tests/infra/{smoke,wait-healthy,otel-roundtrip,loki-roundtrip,mimir-roundtrip}.sh` (Plan 01-1)
- [ ] `docker-compose.yml` 10-service expansion (Plan 01-2)
- [ ] `compose/{otel-collector,grafana,traefik,pgbouncer}/...` config files (Plan 01-2)
- [ ] `.env.example` enumerates every key (Plan 01-2)
- [ ] `tests/self-tests/refuse-default-secrets.test.ts` (Plan 02-1) — RED first
- [ ] `apps/api/scripts/check-default-secrets.test.ts` (Plan 02-1) — RED first
- [ ] `tools/bootstrap.sh` (Plan 02-2) — bash 4+ guard, idempotent
- [ ] `apps/api/scripts/check-default-secrets.ts` (Plan 02-2)
- [ ] `tools/bootstrap/default-secrets.txt` deny-list (Plan 02-1)
- [ ] `packages/data/drizzle.config.ts` + schema files + tests-RED (Plan 03-1) — RED first
- [ ] `packages/data/migrations/0000_initial.sql` hand-augmented with FORCE RLS (Plan 03-2)
- [ ] `packages/data/migrations/init/00-roles.sh` + `.sql.tpl` (Plan 03-2)
- [ ] `packages/data/src/tenant-context.ts` (Plan 04-1)
- [ ] `apps/api/src/middleware/tenant.ts` (Plan 04-1)
- [ ] `packages/data/src/encryption/*` (Plan 04-2)
- [ ] `tools/lint-rls.ts` + tests (Plan 05-1) — RED before script lands
- [ ] `packages/data/src/__tests__/rls-property.test.ts` (Plan 05-2)
- [ ] `.github/workflows/ci.yml` extension (Plan 05-3)
- [ ] `scripts/branch-protection.json` extension (Plan 05-3)
- [ ] `scripts/backup/{make-backup,make-restore}.sh` (Plan 06-1)
- [ ] `tests/integration/backup-restore.test.ts` (Plan 06-1)
- [ ] `keys/backup.age.pub.example` + `.gitignore` allowlist (Plan 06-1)
- [ ] `.github/workflows/nightly.yml` backup-roundtrip job (Plan 06-2)
- [ ] `docs/operations.md` + `docs/storage.md` (Plan 06-2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator runs `bootstrap.sh && docker compose up` lands on Healthy stack | success criterion #1 | Real Docker daemon required; CI uses GHA service blocks for unit-level coverage | `bash tools/bootstrap.sh && make up && sleep 60 && docker compose ps` — every service shows `(healthy)` |
| Branch protection updated to require `lint-rls` + `test-migration` | (CI hygiene; no explicit REQ ID) | GitHub repo settings change requires admin permissions | After Plan 05 merges: re-run `bash scripts/setup-branch-protection.sh` (or apply scripts/branch-protection.json via `gh` API) |
| Operator must add `BACKUP_AGE_IDENTITY` GitHub secret before nightly backup-roundtrip job runs green | DATA-07 (CI) | GHA secrets are repo-admin scoped | Repo Settings -> Secrets -> Actions -> add `BACKUP_AGE_IDENTITY` containing the line from `.env`'s `BACKUP_AGE_IDENTITY=` (the AGE-SECRET-KEY-1... value) |
| Restore from backup taken at the start of Phase 1 succeeds | DATA-07 | Requires real `age` private key + a running Postgres | `make backup` -> save -> drop DB -> `make restore BACKUP=path` -> schema-equivalent |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies declared above
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags in any verify command
- [x] Feedback latency < 30s quick / < 7min full
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
