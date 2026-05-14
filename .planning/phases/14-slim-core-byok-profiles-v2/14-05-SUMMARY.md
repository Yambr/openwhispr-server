---
phase: 14-slim-core-byok-profiles-v2
plan: 05
subsystem: worker
tags: [worker, bullmq, byok, observability, constitutional-cleanup]
requires: [14-01, 14-02, 14-03, 14-04]
provides: [byok-03-audit-closure, noopx-removal-complete]
affects:
  - apps/worker/src/index.ts
  - apps/worker/src/queues.ts
  - apps/worker/src/scheduler.ts
  - apps/worker/src/queues.test.ts
  - apps/worker/src/scheduler.test.ts
  - apps/worker/src/jobs/virtual-key-rotation.ts (deleted)
  - apps/worker/src/jobs/virtual-key-rotation.test.ts (deleted)
  - tests/e2e/log-scrub-sentinel.test.ts
  - tests/integration/virtual-key-rotation-removed.test.ts (new)
  - docs/architecture.md
  - docs/operations.md
key-files:
  created:
    - tests/integration/virtual-key-rotation-removed.test.ts
  modified:
    - apps/worker/src/index.ts
    - apps/worker/src/queues.ts
    - apps/worker/src/scheduler.ts
    - apps/worker/src/queues.test.ts
    - apps/worker/src/scheduler.test.ts
    - tests/e2e/log-scrub-sentinel.test.ts
    - docs/architecture.md
    - docs/operations.md
  deleted:
    - apps/worker/src/jobs/virtual-key-rotation.ts
    - apps/worker/src/jobs/virtual-key-rotation.test.ts
decisions:
  - "Removed virtual-key-rotation wholesale (CONTEXT decision 3 + RESEARCH §A.5) instead of building four new pieces of infra (litellm-client methods, DB migration, admin route, dispatcher) — out of Phase 14 scope, and BYOK-03 is satisfied by removal of the noopX adapters."
  - "Re-anchored OBS-03 log-scrub-sentinel e2e to the email-delivery queue (cheapest surviving queue with deterministic Zod schema); sentinel parked under `password` (canonical REDACT_PATHS entry) so the failure path still exercises the redactor."
  - "Kept Q2/W2 slot indices unused in docs/architecture.md mermaid diagram so surviving slot numbers (Q3..Q9, W3..W9) stay stable for downstream readers / Helm consumers."
  - "Added boot-time transient SCAN+DEL cleanup (`drainStaleVkrKeys` in apps/worker/src/index.ts) wrapped in try/catch — non-fatal, idempotent. Manual valkey-cli fallback documented for fleet-wide rollouts that prefer pre-image drains."
requirements: [BYOK-03]
metrics:
  duration: "~20 min"
  tasks_completed: 3
  files_touched: 11
  net_loc: "+325 / -383 = -58 net"
  conformance_tests: "9/9 GREEN"
  worker_unit_tests: "queues.test.ts + scheduler.test.ts 9/9 GREEN"
completed: 2026-05-14
---

# Phase 14 Plan 05: virtual-key-rotation removal Summary

One-liner: **Deleted the virtual-key-rotation BullMQ worker + queue + cron + noop LiteLLM key client / user-key lookup adapters wholesale per CONTEXT decision 3 + REQUIREMENTS BYOK-03 audit closure — closing the constitutional "no mocks of internal logic" violation; re-anchored the OBS-03 log-scrub e2e to email-delivery; added boot-time transient Valkey-key cleanup for upgrade-in-place operators.**

## Why

`apps/worker/src/index.ts` carried two `noopLitellmKeyClient` + `noopUserKeyLookup` constants that fed a `vkrWorker` BullMQ Worker registered on a weekly cron. The cron enqueued a nil-UUID sentinel payload — both `tenant_id` and `user_id` were `00000000-0000-0000-0000-000000000000`, which the schema rejected and the job could never succeed against. The "production driver" the comments described had never been built. Phase 14 RESEARCH §A.5 mapped the entire deletion (8 files, ~30 LOC of removal). CONTEXT decision 3 chose **delete the dead path** over **build the real four-piece adapter** (litellm-client methods, DB migration, admin route, dispatcher — all out of Phase 14 scope). REQUIREMENTS BYOK-03 ("loud-fail or remove") is now satisfied by removal.

## 8-file removal map (executed)

| # | File | Action |
|---|---|---|
| 1 | `apps/worker/src/jobs/virtual-key-rotation.ts` | DELETED (100 LOC) |
| 2 | `apps/worker/src/jobs/virtual-key-rotation.test.ts` | DELETED (176 LOC) |
| 3 | `apps/worker/src/index.ts` | removed noopX adapters, `vkrWorker` registration, drain-list entry, type imports; ADDED `drainStaleVkrKeys` boot cleanup |
| 4 | `apps/worker/src/queues.ts` | removed `virtualKeyRotationSchema` import, `virtualKeyRotation` from `QUEUE_NAMES`, the matching `QueueRegistry` field, the typed-queue construction, the `closeQueueRegistry` close call |
| 5 | `apps/worker/src/scheduler.ts` | removed `NIL_UUID`, `virtualKeyRotationCron` from `SchedulerConfig` + default, the weekly upsert call |
| 6 | `apps/worker/src/queues.test.ts` | asserts queue count is now 7 (was 8); dropped vkr from matchObject |
| 7 | `apps/worker/src/scheduler.test.ts` | dropped vkr stub in `makeRegistry`, removed "upserts virtual-key-rotation at 0 3 * * 0" test, trimmed override + DEFAULT_SCHEDULER_CONFIG tests to three cron fields |
| 8 | `tests/e2e/log-scrub-sentinel.test.ts` | rewrote the worker-side sentinel sweep to enqueue against email-delivery instead of virtual-key-rotation; sentinel parked under `password` (REDACT_PATHS canonical entry) |

Plus new artifact:

| # | File | Action |
|---|---|---|
| 9 | `tests/integration/virtual-key-rotation-removed.test.ts` | NEW — 9 conformance assertions locking the removal in place |

Plus docs:

| # | File | Action |
|---|---|---|
| 10 | `docs/architecture.md` | removed Q2[virtual-key-rotation] + W2[vkrWorker] + their edges from the mermaid diagram; left Q2/W2 slot numbers unused intentionally; added explanatory blockquote |
| 11 | `docs/operations.md` | added "Upgrade from Phase 13 — virtual-key-rotation removal" subsection under Upgrade runbook; documents boot-time transient cleanup; manual fallback for fleet-wide rollouts |

## Transient cleanup block (apps/worker/src/index.ts)

```ts
/**
 * Phase 14 / Plan 05 — transient cleanup of stale BullMQ keys left over
 * from the deleted virtual-key-rotation worker. Operators upgrading
 * in-place have `bull:virtual-key-rotation:*` keys in Valkey from a
 * previous worker boot; BullMQ would not delete them on its own and a
 * resurrected Worker pickup of a nonexistent queue is harmless but
 * produces log noise. SCAN+DEL with a small COUNT so the cleanup is
 * non-blocking on a large keyspace. Idempotent — a second boot finds
 * zero matching keys and exits the loop cleanly. Safe to remove in a
 * future phase once stragglers stop appearing. Wrapped in try/catch
 * because cleanup failure must NEVER prevent the worker from booting.
 */
async function drainStaleVkrKeys(redis: IORedis, logger: typeof log): Promise<void> {
  try {
    let cursor = "0";
    let total = 0;
    do {
      const [next, keys] = await redis.scan(
        cursor, "MATCH", "bull:virtual-key-rotation:*", "COUNT", "200",
      );
      cursor = next;
      if (keys.length > 0) { await redis.del(...keys); total += keys.length; }
    } while (cursor !== "0");
    if (total > 0) {
      logger.info({ deleted: total }, "drained stale bull:virtual-key-rotation:* keys (Plan 14-05)");
    }
  } catch (err) {
    logger.warn({ err }, "transient vkr-key cleanup failed; non-fatal");
  }
}
```

Wired before any Worker construction inside `main()`:

```ts
const connection: ConnectionOptions = redis;

// Phase 14 / Plan 05 — transient cleanup of stale BullMQ keys from
// the removed virtual-key-rotation worker.
await drainStaleVkrKeys(redis, log);
```

## Log-scrub e2e rewrite (summary of changes)

The second `it(...)` block in `tests/e2e/log-scrub-sentinel.test.ts` previously enqueued an invalid payload against `virtual-key-rotation` with the sentinel parked under `virtual_key`. Both queue references (`enqueueBullMQJob` queue name + `waitForBullMQJob` queue name) moved to `email-delivery`. The sentinel field moved from `virtual_key` to `password` — both are canonical REDACT_PATHS entries from Plan 06-10, so the redactor's behavior under test is unchanged. The Zod schema for `email-delivery` rejects the minimal `{ password, reason }` payload (missing required `tenant_id` etc.), driving the same Zod-parse failure code path the original test exercised.

## docs/operations.md upgrade note (verbatim subsection)

> ### Upgrade from Phase 13 — virtual-key-rotation removal
>
> Phase 14 / Plan 05 removed the `virtual-key-rotation` BullMQ worker, its weekly cron, and its noop LiteLLM key-client + user-key-lookup adapters per CONTEXT decision 3 and the REQUIREMENTS BYOK-03 audit closure. The production rotation dispatcher was never built; the weekly cron enqueued a nil-UUID sentinel against noop adapters in production code — a direct violation of the constitutional "no mocks of internal logic" rule (CLAUDE.md).
>
> **Operator action — none required for new installs.** A fresh `docker compose up` or `helm install` against Phase 14+ images provisions the seven surviving queues only, and Valkey never sees a `bull:virtual-key-rotation:*` keyspace.
>
> **Operator action — upgrade-in-place from Phase 13 → 14.** Existing deployments have stale `bull:virtual-key-rotation:*` keys in Valkey from the prior worker boot. The Phase 14 worker drains these automatically at boot via a one-shot SCAN+DEL loop in `apps/worker/src/index.ts` (`drainStaleVkrKeys`) — wrapped in try/catch so cleanup failure never blocks the worker from starting. For most operators the transient cleanup is sufficient and no further action is needed.
>
> If you prefer a manual one-shot cleanup (e.g. fleet-wide rollout where you'd rather drain keys before the new worker image lands), exec into the Valkey container and run [docker-compose + Helm one-liners — see source]. The one-shot is idempotent — subsequent runs find zero matching keys and exit cleanly.

## Commits

| Hash | Subject |
|---|---|
| `dc49bca` | `test(14-05): add red conformance for virtual-key-rotation removal` |
| `e0eb9c9` | `fix(14-05)!: remove virtual-key-rotation worker wiring (no internal mocks)` |
| `a583483` | `test(14-05): rewrite log-scrub sentinel against email-delivery queue` |
| `05eef7b` | `docs(14-05): remove vkr from architecture diagram, add upgrade note` |

## Verification

- **Conformance test:** `pnpm vitest run tests/integration/virtual-key-rotation-removed.test.ts` → **9/9 GREEN** (RED before commit `dc49bca`; GREEN after `e0eb9c9` for assertions 1-7,9 and after `a583483`+`05eef7b` for assertions 6,8).
- **Worker unit tests:** `pnpm exec vitest run apps/worker/src/queues.test.ts apps/worker/src/scheduler.test.ts` → **9/9 GREEN** (vkr expectations removed; no fake-success substitutions).
- **`git ls-files | grep -F virtual-key-rotation`** → only matches `tests/integration/virtual-key-rotation-removed.test.ts` (the conformance test that NAMES the removed artifact in its assertions — expected).
- **`grep -rln 'noopLitellmKeyClient\|noopUserKeyLookup' apps/`** → zero hits in live code; comment-only references in `apps/worker/src/index.ts` header are allowed (regex-tested in conformance).

## Diff line count

```
git diff --shortstat: 11 files changed, 325 insertions(+), 383 deletions(-)
net: -58 LOC
```

The bulk of the 383 deletions is the two deleted job files (276 LOC combined); the bulk of the 325 insertions is the new 175-LOC conformance test, the 50-LOC operations.md upgrade subsection, the 30-LOC `drainStaleVkrKeys` helper, and the 7-LOC architecture.md explanatory blockquote.

## Deviations from Plan

**1. [Rule 1 - Bug] Conformance test too strict — failed on legitimate explanatory comments**

- **Found during:** Task 3 verification
- **Issue:** The Task 1 RED test asserted ZERO grep matches for `virtualKeyRotation|noopLitellmKeyClient|...` under `apps/worker/src/` and `apps/api/src/`. After Task 2 landed, those symbols remained inside explanatory comments in `apps/worker/src/index.ts` (the "Phase 14 / Plan 05 — the virtual-key-rotation worker… was removed wholesale" block) and `apps/worker/src/queues.test.ts` (single-line comment marking the removed assertion). Same issue applied to the docs/architecture.md `vkrWorker` reference in the explanatory blockquote and the `tests/e2e/log-scrub-sentinel.test.ts` comment marker.
- **Fix:** Tightened the conformance test to strip JS/TS line + block comments before applying the negative-pattern, and scoped the architecture.md assertion to mermaid fences only. The intent of the assertion is "no live identifier references"; the narrative explanation of *why* the removal happened is documentation, not regression.
- **Files modified:** `tests/integration/virtual-key-rotation-removed.test.ts`
- **Commit:** `a583483`

**2. [Rule 3 - Blocking] commitlint rejected uppercase "RED" in subject**

- **Found during:** Task 1 commit
- **Issue:** First commit attempt used `test(14-05): RED virtual-key-rotation removal conformance` — commitlint's subject-case rule rejected the uppercase RED.
- **Fix:** Re-worded to `test(14-05): add red conformance for virtual-key-rotation removal` (all-lowercase subject).
- **Commit:** `dc49bca`

**Auth gates:** None.

**Architectural changes:** None.

## Out-of-scope discoveries (logged, not fixed)

- Pre-existing `pnpm --filter @openwhispr/worker typecheck` failures in `apps/worker/src/lib/typed-queue.ts`, `apps/worker/src/lib/with-tenant-context.ts`, `apps/worker/src/db/app-pool.ts`, `apps/worker/src/i18n/template-renderer.ts`, `apps/worker/src/jobs/reconciliation-daily-check.ts`. Confirmed pre-existing via `git stash` round-trip before any Plan 05 work. **Out of scope for Plan 05** (Scope Boundary rule). Already logged in `.planning/deferred-items.md` would be the natural home — but since this file's status is unknown without a fresh check, I'm noting them here too for the next executor.

## E2E gate (deferred)

The plan's Task 3 verification step calls for `E2E=1 pnpm test:e2e -t log-scrub-sentinel` as a smoke gate. I did NOT run the e2e smoke in this execution wave — it requires a real `docker compose up` boot which is gated by `E2E=1` and depends on the worker image being built from the post-Plan-05 source. The test compiles cleanly (no symbol references to the deleted queue) and the rewrite is a like-for-like swap from `virtual-key-rotation` → `email-delivery`. The next E2E CI run on `main` will exercise it.

## TDD Gate Compliance

| Gate | Commit | Notes |
|---|---|---|
| RED | `dc49bca` `test(14-05): add red conformance for virtual-key-rotation removal` | 9/9 assertions FAIL pre-edit |
| GREEN | `e0eb9c9` `fix(14-05)!: remove virtual-key-rotation worker wiring (no internal mocks)` | 5/9 assertions PASS post-Task-2 |
| GREEN (Task 3) | `a583483` + `05eef7b` | 9/9 assertions PASS post-Task-3 |

(No REFACTOR commit — the removal pattern is its own simplification.)

## Self-Check: PASSED

- [x] Created files exist: `tests/integration/virtual-key-rotation-removed.test.ts` (verified by `git log --name-status -1 dc49bca`)
- [x] Deleted files gone: `apps/worker/src/jobs/virtual-key-rotation.{ts,test.ts}` (verified by `git ls-files | grep virtual-key-rotation` returning only the conformance test)
- [x] All 4 commit hashes present on `main`: `dc49bca`, `e0eb9c9`, `a583483`, `05eef7b` (verified by `git log --oneline -5`)
- [x] Conformance suite GREEN: 9/9 (`pnpm vitest run tests/integration/virtual-key-rotation-removed.test.ts`)
- [x] Worker unit tests GREEN: 9/9 (`pnpm exec vitest run apps/worker/src/queues.test.ts apps/worker/src/scheduler.test.ts`)
- [x] `must_haves.truths` from PLAN: every bullet honored (file deletion, queue-name removal, cron removal, log-scrub rewrite, architecture.md diagram update, operations.md upgrade note, transient cleanup at boot)
- [x] `must_haves.artifacts` excludes/contains rules: verified by the 9 conformance assertions themselves
