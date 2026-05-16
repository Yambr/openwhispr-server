# Phase 34 — tenantPlugin retirement (CR-1 closure) — SUMMARY

**Closed:** 2026-05-16
**Status:** PASSED — `req.tenantId` decorator gone; client-controlled `x-tenant-id` header can no longer affect request decoration.
**Requirement:** CRIT-FIX-03 (`.planning/review/api-core.md` CR-01).
**Engineering discipline:** TDD RED → GREEN → REGRESSION, lockers exit 0, e2e GREEN. ≥ 90 % coverage on the new test files (filesystem-scan / Fastify-inject tests are trivially fully covered).

## What changed

### DELETED

| File | Reason |
| --- | --- |
| `apps/api/src/middleware/tenant.ts` | The plugin body + its inline `declare module 'fastify' { tenantId: string }` augmentation. The CR-1 hole. |
| `apps/api/tests/unit/middleware/tenant.test.ts` | Unit tests for the deleted plugin (now meaningless). |
| `tests/integration/session-token-plain-roundtrip.test.ts` | Obsolete `describe.skip` block from Phase 33-05 that tripped `lint-playwright-config` Rule 3 and blocked Phase 34 commits. The Phase 33-05 SUMMARY explicitly cites its replacement coverage at `packages/data/migrations/__tests__/0020-drop-plaintext.test.ts`. Per deviation Rule 3 (auto-fix blocking issues). |

### EDITED

| File | Change |
| --- | --- |
| `apps/api/src/index.ts` | Removed `import { tenantPlugin }` and the `app.register(tenantPlugin)` call; replaced with a closure-rationale comment block. |
| `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` | Removed dangling `vi.mock("../../../src/middleware/tenant.js", …)` line (target module no longer exists). |
| `apps/api/tests/unit/__tests__/fastify-request-types.test.ts` | Updated stale comment referencing the deleted module; assertions unchanged (it still asserts `req.user` / `req.tenant` shape only — `tenantId` was never in scope). |
| `tools/lint-no-hardcode.allowlist.txt` | Removed entry `apps/api/src/middleware/tenant.ts:44` (target file gone). |
| `tools/lint-no-env-branches.allowlist.txt` | Shifted two `apps/api/src/index.ts` line numbers from 503/507 → 502/506 (delete removed 1 net line). |
| `tools/lint-no-suppressions.allowlist.txt` | Shifted eight `apps/api/src/index.ts` line numbers by -1. |
| `.planning/REQUIREMENTS.md` | Flipped CRIT-FIX-03 from Pending → Complete (2026-05-16) in the v2.2 traceability table + checklist. |
| `.planning/ROADMAP.md` | Flipped Phase 34 row `[ ] → [x]` with closure context. |

### CREATED

| File | Purpose |
| --- | --- |
| `.planning/phases/34-tenant-plugin-retirement/34-AUDIT.md` | Production-reader inventory: zero readers of `req.tenantId`. Documents the decision to use the DELETE path. |
| `tests/e2e/tenant-isolation.test.ts` | E2E gate (DISCIPLINE Rule 3) — 3 assertions, each running `app.inject` against an in-process Fastify with optional `tenantPlugin` registration. RED on current main (3/3 fail); GREEN after delete (3/3 pass). |
| `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts` | Regression guard — asserts plugin file absent, no top-level `tenantId` on FastifyRequest augmentation (allows nested `user.tenantId` which is session-derived), and no executable `req.tenantId` reads in production source (comments scrubbed before scan). |

## Audit findings (one-liner)

**Production readers of `req.tenantId`: ZERO.** Every reference in `apps/**/src` and `packages/**/src` non-test code is either the plugin writing the decorator (deleted) or an unrelated `tenantId` field on a different shape (e.g. `user.tenantId`, `m.tenantId`, function parameters). Full inventory: `.planning/phases/34-tenant-plugin-retirement/34-AUDIT.md`.

## Commits (atomic, 5 expected; 6 landed including the unrelated unblock)

| # | SHA | Purpose |
| --- | --- | --- |
| 1 | `2e4479a` | `docs(34)`: audit doc |
| — | `d0d26ac` | `chore(34)`: delete obsolete `session-token-plain-roundtrip.test.ts` (unblock locker) |
| 2 | `e7db81a` | `test(34)`: RED e2e (3/3 failing on main) |
| 3 | `861ada3` | `feat(34)`: GREEN delete plugin + registration + augmentation |
| 4 | `3695fe6` | `test(34)`: regression guard (3 assertions) |
| 5 | `<this commit>` | `docs(34)`: SUMMARY + flip CRIT-FIX-03 + ROADMAP closure |

## Verification

| Gate | Result |
| --- | --- |
| `pnpm lint:lockers` | exit 0 (env-branches, suppressions, hardcode, prod-readiness, secret-shape, shell-credential WARN-only, plaintext-cols — all clean) |
| `tests/e2e/tenant-isolation.test.ts` BEFORE delete | 3/3 RED (decorator was set; assertion is "decorator absent") |
| `tests/e2e/tenant-isolation.test.ts` AFTER delete | 3/3 GREEN |
| `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts` | 3/3 GREEN |
| `pnpm --filter @openwhispr/api typecheck` | No NEW errors related to `req.tenantId` (pre-existing errors in `CloudNoteRow`, `realtime.ts`, `CleanedWhere` are unrelated to Phase 34 scope and pre-date these commits) |

## Deviations from plan

### Rule 3 unblock — `session-token-plain-roundtrip.test.ts` obsolete-file deletion

- **Found during:** Task 2 (RED commit attempt).
- **Issue:** `tools/lint-playwright-config.ts` Rule 3 flagged a `describe.skip("...")` at `tests/integration/session-token-plain-roundtrip.test.ts:108`. The file was wrapped in `describe.skip` during Phase 33-05 with a self-documenting comment declaring the entire suite "obsolete post-0020" and citing its replacement coverage (`packages/data/migrations/__tests__/0020-drop-plaintext.test.ts`). The `.skip` apparently slipped past Phase 33-05's pre-commit hook (or was bypassed). The locker is BLOCKING and blocked every Phase 34 commit.
- **Fix:** Deleted the obsolete file in its own atomic `chore(34)` commit (`d0d26ac`) before resuming the Task 2 RED commit. No production code touched.
- **Why not deferred:** DISCIPLINE Rule 9 forbids `--no-verify` for individual developer commits. The dead-skip block was self-documented as obsolete and had named replacement coverage; deleting it was the minimal, documented unblock per deviation Rule 3.

### Rule 3 unblock — allowlist line-number shifts

- **Found during:** Task 3 (GREEN delete commit) running `pnpm lint:lockers`.
- **Issue:** Removing the `tenantPlugin` import + registration (6 lines deleted, 5 lines added) net-removed 1 line from `apps/api/src/index.ts`. Several locker allowlists pin `apps/api/src/index.ts:<line>` for pre-existing Phase 31-era debt entries (`NODE_ENV` branches, `as unknown as` casts, hardcoded `4000` port literal). The shift made every pinned entry off-by-one.
- **Fix:** Updated the line numbers in `lint-no-env-branches.allowlist.txt` (2 entries), `lint-no-suppressions.allowlist.txt` (8 entries), and `lint-no-hardcode.allowlist.txt` (1 entry). All rationale comments updated to record the `34 -1` shift alongside the pre-existing `33-04 +9` shift. No NEW entries added — `pnpm lint:lockers-allowlist-diff` would report a clean net-zero delta on the count.

## Threat flags

None. Phase 34 REMOVED a threat surface (`req.tenantId` decorator backed by a client-controlled header); no new surface introduced.

## Known stubs

None. The retirement is complete; the authoritative tenant binding (`req.tenant`, set by `dualAuthHook`) was already in place and is the sole tenant-on-request value going forward.

## Self-Check: PASSED

- `apps/api/src/middleware/tenant.ts` — MISSING (intentional; verified with `ls apps/api/src/middleware/`)
- `tests/e2e/tenant-isolation.test.ts` — FOUND
- `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts` — FOUND
- `.planning/phases/34-tenant-plugin-retirement/34-AUDIT.md` — FOUND
- `.planning/phases/34-tenant-plugin-retirement/34-SUMMARY.md` — FOUND (this file)
- Commits `2e4479a`, `d0d26ac`, `e7db81a`, `861ada3`, `3695fe6` — verified on HEAD via `git log --oneline -6`.
- E2E + regression tests re-run pre-SUMMARY: 3/3 + 3/3 GREEN.
- `pnpm lint:lockers` re-run pre-SUMMARY: exit 0.
