<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 69-sso-jit-live-keycloak
plan: 02
subsystem: data + audit
tags: [audit-log, migration, sso, jit, zod, partitioned-table, no-pii]
requires:
  - "audit_log monthly RANGE-partitioned parent (migration 0014)"
  - "auditPayloadSchemas satisfies Record<AuditAction> chokepoint (Phase 6 / Plan 05)"
provides:
  - "AUDIT_LOG_ACTIONS extended 18 -> 21 (sso.jit.user.created, sso.jit.role.updated, sso.jit.rejected)"
  - "migration 0032 (up + down) admitting the 3 sso.jit.* actions on the partitioned table + all children"
  - "3 no-PII .strict() zod payload schemas in auditPayloadSchemas"
affects:
  - "Phase 69 SSO JIT hook emission sites (auth.ts) — can now write the 3 sso.jit.* audit rows"
  - "@cjm-sso-1.1 (asserts literal sso.jit.user.created audit action)"
tech-stack:
  added: []
  patterns:
    - "partitioned-parent CHECK swap: DROP + ADD without partition-local keyword (cascades to children)"
    - "NOT VALID + VALIDATE CONSTRAINT for online allow-list widening (squawk-clean)"
    - ".strict() zod object to REJECT (not strip) PII / unknown keys at the audit chokepoint"
key-files:
  created:
    - packages/data/migrations/0032_audit_log_sso_actions.sql
    - packages/data/migrations/0032_audit_log_sso_actions.down.sql
    - packages/data/migrations/__tests__/0032-audit-log-sso-actions.test.ts
    - apps/api/tests/unit/__tests__/audit-sso-payloads.test.ts
  modified:
    - packages/data/src/schema/audit_log.ts
    - packages/data/migrations/meta/_journal.json
    - apps/api/src/lib/audit.ts
    - apps/api/tests/unit/lib/audit.test.ts
decisions:
  - "D-69-2 Option A: extend the locked enum properly (no workaround) — 18 -> 21 actions"
  - "CHECK swap uses NOT VALID + VALIDATE (online-safe, pure allow-list widening) — squawk-clean without rule exclusion"
  - "no-PII payloads enforced via .strict() zod (reject email/name/sub/raw groups/email_domain)"
metrics:
  duration: ~13 min
  completed: 2026-05-29
  tasks: 2
  files: 8
---

# Phase 69 Plan 02: SSO JIT Audit Taxonomy Extension Summary

Extended the locked 18-action audit taxonomy to 21 (D-69-2 Option A) by adding `sso.jit.user.created`, `sso.jit.role.updated`, `sso.jit.rejected` to `AUDIT_LOG_ACTIONS` + the Postgres `audit_log_action_check` CHECK (migration 0032, up + down, on the RANGE-partitioned `audit_log` parent) + 3 no-PII `.strict()` zod payload schemas in `auditPayloadSchemas`, each landed as one atomic RED-first TDD commit against real Postgres + pg_partman.

## What shipped

### Task 1 — migration 0032 + AUDIT_LOG_ACTIONS 18 -> 21 (commit `37d06c33`)
- `packages/data/src/schema/audit_log.ts`: appended the 3 `sso.jit.*` literals to both the `AUDIT_LOG_ACTIONS` const array AND the `audit_log_action_check` `sql\`... IN (...)\`` CHECK so drizzle introspection stays in sync.
- `0032_audit_log_sso_actions.sql`: `ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check` then re-`ADD ... CHECK (...) NOT VALID` with the 21 values **without** the partition-local keyword, followed by `VALIDATE CONSTRAINT`. The swap cascades to every monthly partition child in one statement (partition-local would error once children exist). `NOT VALID + VALIDATE` is the online-migration pattern: this is a pure allow-list **widening** (18 -> 21 superset), so every pre-existing row already satisfies the new predicate and validation finds zero violations while avoiding the blocking full-table scan/write-block. PostgreSQL 17 accepts `NOT VALID` CHECK on a partitioned parent (empirically probed).
- `0032_audit_log_sso_actions.down.sql`: reverts the CHECK to the original 18-action set (same DROP/ADD/VALIDATE shape; narrowing, so an operator purges any `sso.jit.*` rows before `VALIDATE`).
- `meta/_journal.json`: registered the `0032_audit_log_sso_actions` entry (idx 33) so `bootMigratedPostgres()`'s drizzle `migrate()` applies it.
- Real-Postgres+pg_partman test (6 cases): the new CHECK admits the 3 actions on the parent **and** on a routed monthly child partition; still admits the 18 legacy actions; still rejects an out-of-set action; the CHECK enumerates exactly 21; the down-migration reverts to 18 and rejects `sso.jit.*`.

### Task 2 — 3 no-PII zod payload schemas (commit `026c38a5`)
- `apps/api/src/lib/audit.ts`: added `rolesEnum` / `tenantClaimMode` / `roleUpdateReason` / `jitRejectionCode` enums and the 3 schemas (verbatim D-69-2 shapes):
  - `sso.jit.user.created` → `{ tenant_id, role, tenant_claim_mode, matched_group_hash? }`
  - `sso.jit.role.updated` → `{ tenant_id, before, after, reason }`
  - `sso.jit.rejected` → `{ tenant_id, code }` (5 rejection codes)
- Each schema is `.strict()` so PII / unknown keys (`email`, `name`, `sub`, `groups`, `email_domain`) are **rejected**, not silently stripped. The winning group is carried ONLY as a SHA-256 hash, mirroring `settings.*_changed`.
- The exhaustive `satisfies Record<AuditAction, z.ZodTypeAny>` union now compiles over the 21-action enum (`tsc --noEmit` clean).
- 31 unit tests (parse success per shape, enum rejection, 5-key PII rejection per schema, 21-action exhaustiveness).

## Verification evidence

- `pnpm exec vitest run --project=data 0032-audit-log-sso-actions` → 6 passed.
- `pnpm exec vitest run --project=api audit-sso-payloads tests/unit/lib/audit.test.ts` → 79 passed (no regression).
- `pnpm --filter=@openwhispr/api exec tsc -p tsconfig.json --noEmit` → exit 0 (exhaustive union over 21 actions).
- `pnpm tsx tools/lint-migrations.ts packages/data/migrations/0032_audit_log_sso_actions.sql` → exit 0 (squawk clean).
- `grep -c ' ONLY ' packages/data/migrations/0032_audit_log_sso_actions.sql` → 0.
- `grep -o "sso.jit" packages/data/src/schema/audit_log.ts | wc -l` → 6; `... apps/api/src/lib/audit.ts` → 3.
- `pnpm lint:lockers` → exit 0 (pre-existing WARN backlog only; no new violations).
- Coverage on `apps/api/src/lib/audit.ts` (scoped run): 90 / 91.3 / 100 / 93.61 (lines/branches/funcs/stmts) — all >= 90.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file placement (plan path not a discovered test root)**
- **Found during:** Task 1
- **Issue:** The plan named the integration test `packages/data/tests/integration/__tests__/audit-log-sso-actions.test.ts`, but that directory is not in the `data` vitest project's discovered tree, whereas the existing migration tests (`0014`, `0029`) live in `packages/data/migrations/__tests__/` and ARE discovered. Placing the test at the plan's path would have left it unrun.
- **Fix:** Placed the test at `packages/data/migrations/__tests__/0032-audit-log-sso-actions.test.ts` (sibling to 0014/0029, discovered by the `data` project, matches the `pnpm test audit-log-sso-actions` filename filter). Filename retains `audit-log-sso-actions` so the acceptance command resolves it.
- **Files modified:** packages/data/migrations/__tests__/0032-audit-log-sso-actions.test.ts
- **Commit:** 37d06c33

**2. [Rule 1 - Stale test] Updated the hardcoded "exactly 18 actions" assertion to 21**
- **Found during:** Task 2
- **Issue:** `apps/api/tests/unit/lib/audit.test.ts` asserted `AUDIT_ACTIONS` has length 18. The D-69-2 taxonomy extension (the intended production change, not a test-only edit) makes it 21, so the assertion was now stale and failing.
- **Fix:** Updated the count assertions (18 → 21), the describe title, and added spot-checks for the 3 new members. This is a legitimate update to a test that encodes the OLD invariant, consistent with CLAUDE.md hard-rule 1 (the production change is the genuine SPEC/decision requirement; the test asserting the old count is what's stale).
- **Files modified:** apps/api/tests/unit/lib/audit.test.ts
- **Commit:** 026c38a5

**3. [Implementation detail] `NOT VALID + VALIDATE` instead of a plain validating ADD**
- **Found during:** Task 1
- **Issue:** A plain `ADD CONSTRAINT ... CHECK` tripped squawk's `constraint-missing-not-valid` BLOCKING rule (full-table scan + write block).
- **Fix:** Used `ADD ... NOT VALID` + a separate `VALIDATE CONSTRAINT`. This is the proper online-migration pattern (no workaround / no rule exclusion) — squawk-clean, and correct because the swap is a pure allow-list widening with zero violating rows. Empirically verified PG 17 accepts `NOT VALID` CHECK on a partitioned parent.
- **Files modified:** packages/data/migrations/0032_audit_log_sso_actions.sql, .down.sql
- **Commit:** 37d06c33

## Threat surface

T-69-05 (information disclosure via audit payloads) and T-69-06 (tampering with the partitioned-table CHECK) from the plan's threat register are both mitigated as designed:
- T-69-05: `.strict()` zod rejects extra/PII keys; `recordAudit` FORBIDDEN_AUDIT_KEYS sweep + Cyrillic guard are the runtime defence-in-depth; payloads carry only uuid/role/enum/sha256.
- T-69-06: the DROP/ADD-without-partition-local swap cascades atomically to all partition children; the down-migration restores the 18-action posture.

No new security surface beyond the plan's threat model. No threat flags.

## Known Stubs

None. Both tasks ship complete, exercised behavior. The audit *emission* call sites (auth.ts hooks that will write these rows) are out of scope for this plan and tracked by other Phase 69 plans (D-69-1 resolver + hooks).

## Self-Check: PASSED

- Files created exist: 0032_audit_log_sso_actions.sql, 0032_audit_log_sso_actions.down.sql, 0032-audit-log-sso-actions.test.ts, audit-sso-payloads.test.ts — all present.
- Commits on HEAD: 37d06c33 (Task 1), 026c38a5 (Task 2) — both confirmed via `git log --oneline`.
- Schema edit present: AUDIT_LOG_ACTIONS = 21, CHECK lists 21, auditPayloadSchemas has the 3 sso.jit.* keys.
