---
phase: 1
slug: core-infra-multi-tenant-data
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit/integration/property), testcontainers via Docker daemon |
| **Config file** | `vitest.config.ts` (root); `packages/data/vitest.config.ts` may extend for testcontainer setup |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` (alias: `vitest run --coverage`) |
| **Phase gate command** | `pnpm lint && pnpm lint:english && pnpm lint:rls && pnpm typecheck && pnpm test && pnpm vitest run tests/self-tests/ && make up && curl http://api.localhost/api/health` |
| **Estimated runtime** | Quick: ~10s. Full (with testcontainers): ~3-5 min. |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run --changed`
- **After every plan wave:** `pnpm test` + `pnpm lint:rls` + `pnpm vitest run tests/self-tests/`
- **Before `/gsd-verify-work`:** Full GHA workflow run on a real PR — every CI check green
- **Max feedback latency:** 30s for unit; 5 min for full suite

---

## Per-Task Verification Map

The planner will populate this table fully. Skeleton:

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 1-XX-XX | XX | N | DATA-XX | unit/integration/self-test | (planner fills) | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Phase 1 substrate that must exist before later tasks can run:

- [ ] `bootstrap.sh` exists before any compose-up step
- [ ] `.env.example` ships all keys with placeholder values
- [ ] `docker-compose.yml` skeleton from Phase 0 expanded with all 10 services
- [ ] `packages/data/drizzle.config.ts` exists before any migration generation
- [ ] `packages/data/src/schema/*.ts` schema files exist before `drizzle-kit generate`
- [ ] First migration `0000_initial.sql` exists with hand-augmented RLS DDL before `pnpm migrate` runs
- [ ] `tools/lint-rls.ts` exists before `lint:rls` Make target / CI job
- [ ] `tools/bootstrap/default-secrets.txt` deny-list exists before bootstrap-self-test runs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator runs `bootstrap.sh && docker compose up` lands on Healthy stack | success criterion #1 | Requires real Docker daemon; CI uses service blocks instead | After fork: `bash bootstrap.sh && docker compose up -d && sleep 60 && docker compose ps`; every service shows `(healthy)` |
| Branch protection now requires `lint-rls` + `test-migration` | (no explicit REQ; CI hygiene) | GitHub repo settings change | Re-run `bash scripts/setup-branch-protection.sh` after Phase 1 lands |
| Restore from backup taken at the start of Phase 1 succeeds | DATA-07 | Requires real `age` private key configured locally | `make backup` → save → drop DB → `make restore BACKUP=path` → schema-equivalent |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 5min full
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates the per-task map

**Approval:** pending
