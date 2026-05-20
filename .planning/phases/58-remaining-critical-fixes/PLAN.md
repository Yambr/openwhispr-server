---
phase: 58-remaining-critical-fixes
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/worker/src/jobs/ingest-litellm-spend.ts
  - apps/worker/src/jobs/usage-rollup-daily.ts
  - apps/worker/src/jobs/reconciliation-daily-check.ts
  - apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts
  - apps/worker/tests/unit/jobs/usage-rollup-daily.test.ts
  - apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts
  - packages/data/src/schema/usage_ledger.ts
  - packages/data/migrations/0027_usage_ledger_event_at.sql
  - packages/data/migrations/0027_usage_ledger_event_at.down.sql
  - packages/data/src/encryption/oauth-state-codec.ts
  - packages/data/tests/unit/__tests__/oauth-state-codec.test.ts
  - apps/api/tests/**  (Track C regression test — exact file decided post-investigation)
  - .planning/review/REVIEW-INDEX.md
  - .planning/deferred-items.md
autonomous: true
requirements: ["worker:CR-01", "worker:CR-02", "data:CR-04", "data:CR-05"]

must_haves:
  truths:
    - "A LiteLLM spend row skipped for a recoverable reason (missing user/tenant) is re-attempted on a later ingest tick once the prerequisite data materializes — billable spend is never permanently orphaned."
    - "All three skip reasons (missing_end_user, missing_tenant, non_numeric_duration) emit a worker_billing_anomalies_total counter."
    - "Daily rollup + reconciliation bucket usage_ledger rows by the LiteLLM spend-occurrence time (event_at), not by the worker ingest time (created_at)."
    - "previous_token_fp is populated on session rotation and the AUTH-04 5-minute overlap window resolves the previous bearer to the same (user_id, tenant_id) — proven by a regression test."
    - "oauth-state-codec.ts has no dead plaintext-fallback branch; the codec only accepts encrypted (sidecar) form."
  artifacts:
    - path: "packages/data/migrations/0027_usage_ledger_event_at.sql"
      provides: "event_at timestamptz column on usage_ledger"
      contains: "ADD COLUMN"
    - path: "packages/data/src/schema/usage_ledger.ts"
      provides: "eventAt drizzle column"
      contains: "event_at"
  key_links:
    - from: "apps/worker/src/jobs/ingest-litellm-spend.ts"
      to: "usage_ledger.event_at"
      via: "INSERT writes startTime into event_at"
      pattern: "event_at"
    - from: "apps/worker/src/jobs/usage-rollup-daily.ts"
      to: "usage_ledger.event_at"
      via: "rollup window filters on event_at"
      pattern: "event_at >="
---

<objective>
Close the 4 CRITICAL findings deferred from Phase 57:
`worker:CR-01`, `worker:CR-02`, `data:CR-04`, `data:CR-05`. After this phase ALL 13
CRITICAL findings from `.planning/review/REVIEW-INDEX.md` are resolved.

Purpose: billing-correctness (no silent spend loss, no day-boundary mis-bucketing),
token-rotation correctness (AUTH-04 overlap functional), and dead-code removal in a
security-sensitive codec.

Output: RED+GREEN atomic commit pairs per track, a forward migration `0027`, an
annotated `REVIEW-INDEX.md`, and updated `deferred-items.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/58-remaining-critical-fixes/CONTEXT.md
@.planning/review/worker.md
@.planning/review/data.md
@.planning/review/REVIEW-INDEX.md
@CLAUDE.md

Already-read source (do NOT re-read — facts captured below):
- `apps/worker/src/jobs/ingest-litellm-spend.ts` — watermark site lines 277-344.
- `apps/worker/src/jobs/usage-rollup-daily.ts` — `created_at` windows lines 75-87, 118-137.
- `apps/worker/src/jobs/reconciliation-daily-check.ts` — `created_at` window lines 187-197.
- `packages/data/src/schema/usage_ledger.ts` — **has only `created_at`; NO `startTime`/`event_at` column.**
- `apps/api/src/lib/token-rotation.ts` — `recordPreviousToken` writes `previous_token_fp` via raw `sql` (lines 75-84); `tryPreviousToken` reads it (lines 137-146).
- `apps/api/src/index.ts` lines 504-540 — `onSend` hook fires `recordPreviousToken` whenever `set-auth-token` rotates and `req.tenant/req.user/req.sessionId` are set.
- `packages/data/src/encryption/oauth-state-codec.ts` — dead plaintext fallback lines 62-95.

<interfaces>
usage_ledger today (packages/data/src/schema/usage_ledger.ts):
  id uuid PK | tenant_id uuid | user_id uuid | request_id text UNIQUE
  kind text | units integer | created_at timestamptz default now()
  — no column ties a ledger row back to LiteLLM startTime.

SpendLogRow (ingest-litellm-spend.ts:148-155):
  request_id, end_user, total_tokens, model, startTime: Date|string, metadata

recordBillingAnomaly(reason: string) — ingest-litellm-spend.ts:101.
_readBillingAnomalies()/_resetBillingAnomalies() — test seams.

recordPreviousToken(db, tenantId, sessionId, oldToken) — token-rotation.ts:56
  → UPDATE sessions SET previous_token_fp = sha256(oldToken),
    previous_token_expires_at = now() + interval '5 minutes' WHERE id = sessionId.
tryPreviousToken(db, bearerToken) — token-rotation.ts:121
  → SELECT user_id,tenant_id WHERE previous_token_fp = sha256(bearer)
    AND previous_token_expires_at > now().

decryptCodeVerifierFromRow(providers, row) — oauth-state-codec.ts:89
  dead branch: `if (typeof row.code_verifier === "string") return row.code_verifier`.
  Migration 0020 dropped the plaintext `code_verifier` column — branch unreachable.
</interfaces>

Worker tests use `@testcontainers/postgresql` (real Postgres) + an in-memory
`FakeRedis` for the watermark; `describe.skipIf(SKIP)` skips at file granularity
when docker is unreachable (`canRunDocker`). Follow that established pattern —
no HTTP/internal mocks (CLAUDE.md: no mocks of internal logic).
</context>

## Phase Goal

Close `worker:CR-01`, `worker:CR-02`, `data:CR-04`, `data:CR-05` — the 4 CRITICAL
findings deferred from Phase 57 — each via strict RED→GREEN TDD, leaving ALL 13
review CRITICALs resolved.

---

## Dependency Graph

```
Track C (data:CR-04 verify+lock)  ─┐  independent — cheapest, do first
Track D (data:CR-05 dead-code)    ─┤  independent
Track A (worker:CR-01 watermark)  ─┼─► Track B (worker:CR-02 rollup buckets)
                                   │
   Track B is CHAINED to Track A.  ┘
```

**Order: C → D → A → B** (per CONTEXT.md §Constraints).

**Why B depends on A — RESOLVED by reading the schema.** `usage_ledger`
(`packages/data/src/schema/usage_ledger.ts`) has **only `created_at`** — there is
NO `startTime`/`event_at` column. `worker:CR-02` cannot be fixed by changing a
query filter alone: the column the rollup must bucket on **does not exist yet**.
Track A is the writer of `usage_ledger` (`ingest-litellm-spend.ts` INSERT, lines
321-327). Therefore:

1. Track A adds migration `0027` introducing `usage_ledger.event_at` AND makes the
   ingest INSERT write `startTime` into it.
2. Track B then switches the rollup + reconciliation window filters from
   `created_at` to `event_at`.

Track B is **not** independent of A. Track B's GREEN cannot pass until A's
migration + ingest write land. C and D touch disjoint files (`apps/api`,
`packages/data/src/encryption/oauth-state-codec.ts`) and are independent of
both A and B and of each other.

Single plan, single executor, sequential commits — the chain is short and the
file-ownership overlap (Track A and B both could touch `usage_ledger`-adjacent
code) makes splitting into parallel plans unsafe.

---

## Track C — data:CR-04 — AUTH-04 5-minute token-rotation overlap

**Finding:** `data:CR-04` — `previous_token_fp` allegedly never populated → AUTH-04
overlap window non-functional.

**Pre-conditions:** none. Do this track FIRST — it may be a no-op fix.

### Investigation step (MANDATORY — branch on the result)

The review claim ("`previous_token_fp` never populated") was made about Better
Auth's **drizzleAdapter** write path. But `recordPreviousToken`
(`apps/api/src/lib/token-rotation.ts:56-85`) writes `previous_token_fp` via a
**raw `sql` UPDATE** — it does NOT go through the lens or the drizzleAdapter, so
the empty-`ENCRYPTED_COLUMNS_MAP` problem (now fixed by Phase 57 anyway) never
applied to this path. The `onSend` hook in `apps/api/src/index.ts:507-539` fires
`recordPreviousToken` whenever `set-auth-token` rotates the bearer.

**First action — write a failing-or-passing characterization test** that proves
the current behavior end-to-end:

- File: an integration test under `apps/api/tests/` exercising `buildApp` with a
  real DB (testcontainers, same pattern as existing api integration tests). If an
  integration harness for `buildApp` + DB already exists, extend it; otherwise add
  `apps/api/tests/integration/auth-04-token-rotation-overlap.test.ts`.
- Test name MUST contain `data:CR-04`.
- Scenario: sign up a user, obtain bearer B1, perform a request that rotates the
  session (so `set-auth-token` emits B2 ≠ B1), then assert:
  1. `SELECT previous_token_fp, previous_token_expires_at FROM sessions WHERE id = <sid>`
     → `previous_token_fp` is non-NULL and equals `sha256(B1)`;
     `previous_token_expires_at` is `now()+~5min`.
  2. A subsequent authenticated request presenting the OLD bearer B1 within the
     window returns 200 (not 401) — `tryPreviousToken` resolves it.

**Branch:**

- **If the test PASSES as written** → `data:CR-04` was already closed (by the
  Phase 57 wiring / the pre-existing `recordPreviousToken` raw-SQL path). Track C
  becomes **"lock it with a regression test only"**: keep the passing test as the
  regression lock, do NOT write a production fix, and skip the RED/GREEN split
  below. Commit as a single `test(58-C)` commit (see "Commit — already-closed
  branch"). Record in `deferred-items.md` that the review finding was a
  false-positive scoped to the drizzleAdapter path, with evidence (the raw-SQL
  `recordPreviousToken` writer).
- **If the test FAILS** → proceed with the RED→GREEN split below.

### RED step (only if the investigation test failed)

- File: the test from the investigation step, committed in its failing state.
- Assertion that proves the bug: after a rotation, `previous_token_fp IS NULL`
  (overlap window never armed) OR the old-bearer request 401s.
- Commit: `test(58-C): red — data:CR-04 previous_token_fp not populated on rotation`.

### GREEN step (only if the investigation test failed)

- Likely root cause if it fails: the `onSend` hook guard
  (`apps/api/src/index.ts:516-524`) is not satisfied during real rotation — e.g.
  `req.sessionId` not stashed, or `set-auth-token` not surfaced. Fix the wiring so
  `recordPreviousToken` actually runs on rotation. Production files: `apps/api/src/index.ts`
  and/or `apps/api/src/middleware/dual-auth.ts`.
- **CLAUDE.md hard rule 1:** if the failing test exposes a deeper architectural
  constraint (e.g. Better Auth never emits `set-auth-token` in this build), do NOT
  hack production to make the test pass — HALT, log it in
  `.planning/deferred-items.md` with `WHY:` evidence, and report.
- Key invariant: `previous_token_fp = sha256(oldBearer)`; `previous_token_expires_at
  = now() + 5min`; the old bearer validates for 5 minutes and not after.
- Commit: `fix(58-C): green — data:CR-04 wire previous_token_fp on session rotation`.

### REFACTOR step
n/a.

### Commit — already-closed branch (single commit, no RED/GREEN)
```
test(58-C): lock data:CR-04 — regression test for AUTH-04 token-rotation overlap

data:CR-04 (previous_token_fp never populated) was scoped by the reviewer to
Better Auth's drizzleAdapter write path. The actual writer is recordPreviousToken
in apps/api/src/lib/token-rotation.ts, which UPDATEs previous_token_fp via a raw
`sql` statement — it never traverses the lens or the drizzleAdapter, so the
empty-ENCRYPTED_COLUMNS_MAP defect never applied here. The onSend hook in
apps/api/src/index.ts fires it on every set-auth-token rotation.

This commit adds an integration regression test that signs up a user, rotates
the session token, asserts previous_token_fp == sha256(old bearer) with a
~5-minute previous_token_expires_at, and confirms the old bearer still validates
inside the overlap window. The finding is verified-closed; this test locks it
against a future revert.

Closes data:CR-04 (verified already-closed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification
```
pnpm --filter @openwhispr/api test -- auth-04-token-rotation-overlap
grep -rn "data:CR-04" apps/api/tests/
grep -n "previous_token_fp" apps/api/src/lib/token-rotation.ts   # writer present
```

---

## Track D — data:CR-05 — Dead plaintext-fallback in oauth-state-codec.ts

**Finding:** `data:CR-05` — `decryptCodeVerifierFromRow`
(`packages/data/src/encryption/oauth-state-codec.ts:62-95`) keeps a dead
plaintext-fallback branch + stale `code_verifier?: string | null` type. Migration
0020 dropped the plaintext `oauth_state.code_verifier` column.

**Pre-conditions:** Track C committed.

### Investigation step

Confirm the plaintext branch is genuinely dead before deleting:
```
grep -rn "code_verifier" packages/data/src --include="*.ts" | grep -v "_value\|_dek\|_iv\|_auth_tag\|test"
grep -rn "decryptCodeVerifierFromRow\|RowWithSidecars" apps/ packages/ --include="*.ts" | grep -v test
grep -rn "code_verifier" packages/data/migrations/0020*.sql
grep -rln "decryptCodeVerifierFromRow" packages/data/src/bin tools/ apps/*/src
```
Confirm: (a) no caller constructs a row with a plaintext `code_verifier` field;
(b) no migration-CLI / seed script (`packages/data/src/bin/*`, `tools/*`) passes
plaintext into the codec; (c) migration 0020 drops the column. If ANY live caller
still depends on the plaintext branch → HALT, log in `deferred-items.md`, do not
delete.

### RED step

This is dead-code removal — there is no genuine RED. Combine into a single commit
(per CONTEXT.md: "single combined commit if no genuine RED is natural"). The
"test" here is a strengthened assertion, not a failing-then-passing cycle:

- File: `packages/data/tests/unit/__tests__/oauth-state-codec.test.ts`.
- Add a test named with `data:CR-05`: pass a row that has a `code_verifier` string
  but NO sidecars → assert `decryptCodeVerifierFromRow` **throws** the
  "missing ... bytea sidecars" error (i.e. the codec never trusts a
  caller-supplied plaintext). With the dead branch still present this test would
  FAIL (the branch returns the plaintext). Write the test, watch it fail, then
  delete the branch → it passes. This is a legitimate RED→GREEN; do it as two
  commits if the RED is observable, otherwise a single combined commit — state
  which in the SUMMARY.

### GREEN step

- File: `packages/data/src/encryption/oauth-state-codec.ts`.
- Delete the `if (typeof row.code_verifier === "string") return row.code_verifier;`
  line (oauth-state-codec.ts:94).
- Remove `code_verifier?: string | null;` from the `RowWithSidecars` interface
  (line 63).
- Update the header comment block (lines 22-26) and the `decryptCodeVerifierFromRow`
  docstring (lines 83-88) to drop the "falls back to the plaintext column" wording
  — replace with "Throws if sidecars are absent; there is no plaintext fallback
  (migration 0020 dropped the plaintext column)."
- Key invariant: `decryptCodeVerifierFromRow` accepts ONLY rows with all 6
  sidecars present; absence → throw, never silent plaintext trust.
- Verify `pnpm --filter @openwhispr/data typecheck` — removing the optional field
  must not break any caller (the investigation step proved none exists).

### REFACTOR step
n/a.

### Commit
```
fix(58-D): remove dead plaintext-fallback from oauth-state-codec — data:CR-05

decryptCodeVerifierFromRow kept a plaintext-fallback branch
(`if (typeof row.code_verifier === "string") return row.code_verifier`) and a
stale `code_verifier?: string | null` field on RowWithSidecars. Migration 0020
dropped the plaintext oauth_state.code_verifier column; the branch has been
unreachable since. Dead code in a security-sensitive codec is a hazard — a
future refactor could re-activate the plaintext path and have the codec trust a
caller-supplied secret.

Grep confirmed no caller (apps/**, packages/**, bin/, tools/) constructs a row
with a plaintext code_verifier field. The branch + the optional type field are
deleted. The codec now accepts only the encrypted 6-sidecar form and throws when
sidecars are absent. A regression test in oauth-state-codec.test.ts locks this:
a row with a plaintext code_verifier and no sidecars now throws instead of
returning the plaintext.

Closes data:CR-05.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification
```
pnpm --filter @openwhispr/data test -- oauth-state-codec
pnpm --filter @openwhispr/data typecheck
grep -n "code_verifier" packages/data/src/encryption/oauth-state-codec.ts | grep -v "_value\|_dek\|_iv\|_auth_tag"
  # expect: no bare `code_verifier` plaintext references remain
grep -rn "data:CR-05" packages/data/tests/
```

---

## Track A — worker:CR-01 — Spend-ingest watermark advances past skipped rows

**Finding:** `worker:CR-01` — `ingest-litellm-spend.ts:329-344`. The watermark
advances on `rows.length > 0` unconditionally (line 337). Rows skipped for
`missing end_user` (line 285), `missing tenant` (line 295), or `invalid duration`
(line 310) stay in `rows[]`, so the watermark moves past them and they are never
re-attempted. Missing-user/missing-tenant are **recoverable** (the mapping can
materialize later); invalid-duration is **unrecoverable** (bad data). Only the
duration-skip emits `recordBillingAnomaly`.

**Pre-conditions:** Tracks C, D committed.

### Investigation / design decision

Three fix options were listed in CONTEXT.md. Chosen approach (state rationale in
SUMMARY): **Option (b) — bounded watermark hold**:

- Track the oldest `startTime` among rows skipped for a **recoverable** reason
  during the tick (`missing_end_user` / `missing_tenant`).
- After the loop, advance the watermark to
  `min(lastProcessedRow.startTime, oldestRecoverableSkip.startTime)` — i.e. if any
  recoverable skip occurred, the watermark holds at (just before) that row so the
  next tick re-scans it.
- Invalid-duration skips do NOT hold the watermark (unrecoverable — holding would
  stall ingest forever on permanently-bad data).
- Idempotency is already guaranteed by `INSERT ... ON CONFLICT (request_id) DO
  NOTHING` (usage_ledger.request_id is globally UNIQUE) — re-scanning a row that
  later succeeds inserts exactly once; re-scanning a row that already inserted is
  a no-op. This is the mitigation against double-billing.
- **Bounded lookback:** to prevent the watermark stalling indefinitely on a row
  whose user never materializes, cap the hold: introduce
  `MAX_RECOVERABLE_HOLD_MS` (e.g. 24h). A recoverable-skip row older than the cap
  no longer holds the watermark (it ages out and is treated as unrecoverable);
  emit `recordBillingAnomaly("recoverable_skip_aged_out")` so operators see it.
- Emit `recordBillingAnomaly` for ALL skip reasons:
  `missing_end_user`, `missing_tenant`, `non_numeric_duration` (existing),
  `recoverable_skip_aged_out`.

If the executor finds Option (b) interacts badly with `windowed` mode, fall back
to Option (a) dead-letter table — but Option (b) needs no new table and is
preferred. Document the final choice in the SUMMARY.

### RED step

- File: `apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts`.
- Test name MUST contain `worker:CR-01`. Real Postgres (testcontainers) +
  `FakeRedis`, matching the existing `runIngestOnce` integration suite.
- Scenario A — recoverable skip holds watermark:
  1. Insert spend row R1 (`startTime` = T1) whose `end_user` references a user
     that does NOT yet exist in `users`.
  2. Run `runIngestOnce` → assert `rowsProcessed == 0`, watermark did NOT advance
     past T1 (read `WATERMARK_KEY` from `FakeRedis`; assert `<= T1` minus epsilon
     or equal to pre-tick value).
  3. Now create the user (`users` row with that id + tenant).
  4. Run `runIngestOnce` again → assert R1 is now inserted into `usage_ledger`
     (`rowsProcessed == 1`).
- Scenario B — anomaly counters: `_resetBillingAnomalies()`, run a tick over rows
  hitting each skip reason, assert `_readBillingAnomalies()` contains
  `missing_end_user` and `missing_tenant` (not just `non_numeric_duration`).
- Scenario C — unrecoverable does NOT stall: a row with invalid duration is
  skipped AND the watermark advances past it (ingest does not get stuck).
- Assertion that proves the bug (pre-fix): Scenario A step 4 fails — R1 is never
  re-scanned because the watermark already moved past T1.
- Commit: `test(58-A): red — worker:CR-01 watermark advances past recoverable skips`.

### GREEN step

- File: `apps/worker/src/jobs/ingest-litellm-spend.ts`.
- In the `for (const r of rows)` loop, when a row is skipped for a recoverable
  reason, capture its `startTime` into an `oldestRecoverableSkip` accumulator
  (min). Add `recordBillingAnomaly("missing_end_user")` at line ~286 and
  `recordBillingAnomaly("missing_tenant")` at line ~296.
- Replace the watermark-advance block (lines 337-343): in non-windowed mode,
  compute `advanceTo = oldestRecoverableSkip ? min(lastRowStartTime,
  oldestRecoverableSkipMinusEpsilon) : lastRowStartTime`. Apply the
  `MAX_RECOVERABLE_HOLD_MS` age-out: if the oldest recoverable skip is older than
  `now - MAX_RECOVERABLE_HOLD_MS`, it no longer holds (emit
  `recordBillingAnomaly("recoverable_skip_aged_out")`).
- Windowed mode is unchanged — it never writes the watermark.
- Export `MAX_RECOVERABLE_HOLD_MS` as a named const (sibling of `INITIAL_LOOKBACK_MS`).
- Key invariants:
  - Watermark never advances past an unaged recoverable-skip row.
  - `ON CONFLICT (request_id) DO NOTHING` keeps re-scans idempotent — no
    double-billing.
  - Invalid-duration / aged-out rows never hold the watermark — ingest cannot stall.
  - All four skip reasons emit a counter.
- **CLAUDE.md hard rule 1:** do not weaken production behavior to satisfy a test.
  If a test needs the watermark-hold semantics changed in a way that conflicts
  with windowed-mode callers, HALT + `deferred-items.md`.
- Commit: `fix(58-A): green — worker:CR-01 hold watermark on recoverable skips + anomaly counters`.

### REFACTOR step

Optional: extract the per-row skip handling into a small helper returning a
discriminated `{ outcome: "processed" | "skip-recoverable" | "skip-unrecoverable" }`
so the watermark math reads cleanly. Only if it does not change behavior; run the
full suite after. Otherwise `n/a`.

### Commit (GREEN)
```
fix(58-A): green — worker:CR-01 hold watermark on recoverable skips + anomaly counters

ingest-litellm-spend.ts advanced the spend-ingest watermark on rows.length > 0
unconditionally. Rows skipped for a recoverable reason (missing end_user, missing
tenant — the mapping can materialize later) stayed in rows[], so the watermark
moved past them and the billable spend was permanently orphaned. Only the
duration-skip branch emitted a billing-anomaly counter.

Fix: track the oldest startTime among recoverably-skipped rows; in watermark
mode advance to min(lastProcessedRow.startTime, oldestRecoverableSkip.startTime)
so the next tick re-scans the unresolved row. INSERT ... ON CONFLICT (request_id)
DO NOTHING keeps re-scans idempotent — no double-billing. A bounded
MAX_RECOVERABLE_HOLD_MS (24h) ages out rows whose prerequisite never materializes
so ingest cannot stall on permanently-bad data. recordBillingAnomaly now fires
for all skip reasons: missing_end_user, missing_tenant, non_numeric_duration,
recoverable_skip_aged_out.

Closes worker:CR-01.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification
```
pnpm --filter @openwhispr/worker test -- ingest-litellm-spend
grep -n "recordBillingAnomaly" apps/worker/src/jobs/ingest-litellm-spend.ts
  # expect: missing_end_user, missing_tenant, non_numeric_duration, recoverable_skip_aged_out
grep -n "MAX_RECOVERABLE_HOLD_MS\|oldestRecoverableSkip" apps/worker/src/jobs/ingest-litellm-spend.ts
grep -rn "worker:CR-01" apps/worker/tests/
```

---

## Track B — worker:CR-02 — Rollup + reconciliation bucket by event_at, not created_at

**Finding:** `worker:CR-02` — `usage-rollup-daily.ts` (lines 75-87, 118-137) and
`reconciliation-daily-check.ts` (lines 187-197) bucket `usage_ledger` rows by
`created_at` (ingest time). A tick 30s after UTC midnight allocates yesterday's
late-arriving spend into today's bucket. Reconciliation reads the same column so
its drift gauge reads 0 while the rollup is wrong.

**Pre-conditions:** Track A committed (Track B is CHAINED to A — see Dependency
Graph). `usage_ledger` has NO `startTime`/`event_at` column today; Track B adds it.

### Design decision (SURFACE in SUMMARY)

`worker:CR-02`'s fix requires a new `usage_ledger.event_at` column carrying the
LiteLLM `startTime`. Two sub-decisions:

1. **Historical rows have no `event_at`.** Migration `0027` adds the column
   nullable. The fix is **going-forward only**: ingest starts writing `event_at`
   from deploy onward. The rollup/reconciliation queries bucket on
   `COALESCE(event_at, created_at)` so historical rows (NULL `event_at`) keep
   their previous bucketing — already-reported rollup numbers do NOT shift.
   Re-computing historical rollups is explicitly OUT OF SCOPE (it would mutate
   already-published numbers; CONTEXT.md scopes Phase 58 to the 4 findings).
2. Reconciliation MUST bucket on the same `COALESCE(event_at, created_at)`
   expression as the rollup so the drift gauge stays meaningful.

State both decisions in the SUMMARY. If the executor judges `COALESCE` masks the
bug for new rows, prefer a hard `event_at` filter for rows where `event_at IS NOT
NULL` and a documented cutover — but `COALESCE` is the chosen default (no
historical-number shift, no operator surprise).

### RED step

- Files: `apps/worker/tests/unit/jobs/usage-rollup-daily.test.ts` and
  `apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts`.
- Test names MUST contain `worker:CR-02`. Real Postgres via testcontainers.
- Rollup scenario: insert a `usage_ledger` row whose **spend occurred yesterday**
  (`event_at` = yesterday 23:59:50Z) but was **ingested today** (`created_at` =
  today 00:00:20Z). Run the dispatcher + tenant handler for `date = yesterday`.
  Assert the row IS counted in yesterday's `usage_rollup_daily.total_units`.
  Pre-fix this fails — the `created_at` filter buckets the row into today.
- Reconciliation scenario: same row shape; run `reconciliation-daily-check` for
  the `[yesterday 00:00, today 00:00)` window. Assert the ledger row_count for
  that tenant includes the row (so drift vs LiteLLM `startTime`-bucketed count is
  0, not a false breach / false zero).
- Commit: `test(58-B): red — worker:CR-02 rollup buckets by created_at not event_at`.

### GREEN step

Production changes (atomic with the RED test in the GREEN commit, or RED then
GREEN as two commits — keep RED test + migration + code together as the project's
"test + production code in the SAME atomic commit" rule prefers; RED commit may be
test-only if the column does not exist yet — see note):

- **Note on RED ordering:** the RED test references `event_at`, which does not
  exist until migration `0027`. So the RED commit must include migration `0027` +
  the schema change (otherwise the test cannot even insert the row). Acceptable:
  RED commit = test + migration + schema (test still fails because the *queries*
  still use `created_at`); GREEN commit = the query changes. State this in SUMMARY.

1. `packages/data/migrations/0027_usage_ledger_event_at.sql` —
   `ALTER TABLE usage_ledger ADD COLUMN IF NOT EXISTS event_at timestamptz;`
   Add an index supporting the rollup window scan:
   `CREATE INDEX IF NOT EXISTS usage_ledger_event_at_idx ON usage_ledger (tenant_id, event_at);`
   No NOT NULL, no DEFAULT (historical rows stay NULL — going-forward only).
   Companion `0027_usage_ledger_event_at.down.sql`:
   `DROP INDEX IF EXISTS usage_ledger_event_at_idx; ALTER TABLE usage_ledger DROP COLUMN IF EXISTS event_at;`
   Register the migration in `packages/data/migrations/meta` / journal per the
   existing drizzle-kit convention (match how 0026 is registered).
2. `packages/data/src/schema/usage_ledger.ts` — add
   `eventAt: timestamp("event_at", { withTimezone: true })` (nullable) and the
   `usage_ledger_event_at_idx` index entry.
3. `apps/worker/src/jobs/ingest-litellm-spend.ts` (Track A's file — Track B
   touches it too; that is why B is chained to A and shares this plan) — the
   INSERT (lines 321-327) adds `event_at` to the column list and binds the row's
   `startTime` (normalized to a `Date`/ISO string, same normalization used for the
   watermark at lines 340-341).
4. `apps/worker/src/jobs/usage-rollup-daily.ts` — change BOTH the dispatcher
   `SELECT DISTINCT` window (lines 78-79) and the per-tenant aggregate window
   (lines 122-124) from `created_at` to `COALESCE(event_at, created_at)`.
5. `apps/worker/src/jobs/reconciliation-daily-check.ts` — change the ledger-side
   window (lines 193-194) from `created_at` to `COALESCE(event_at, created_at)`.
- Key invariants:
  - New ledger rows carry `event_at = LiteLLM startTime`.
  - Rollup + reconciliation bucket on the SAME `COALESCE(event_at, created_at)`
    expression — drift gauge stays meaningful.
  - Historical (NULL `event_at`) rows keep `created_at` bucketing — no
    already-published rollup number shifts.
- **CLAUDE.md hard rule 1:** the migration + schema + ingest write are genuine
  production needs driven by the finding, NOT by a test — the test merely proves
  the bug. This is compliant.
- Commit: `fix(58-B): green — worker:CR-02 bucket rollup + reconciliation by event_at`.

### REFACTOR step
n/a.

### Commit (GREEN)
```
fix(58-B): green — worker:CR-02 bucket rollup + reconciliation by event_at

usage-rollup-daily and reconciliation-daily-check bucketed usage_ledger rows by
created_at (the worker ingest timestamp), not by the LiteLLM startTime (when the
spend actually occurred). A rollup tick 30s after UTC midnight allocated
yesterday's late-arriving spend into today's bucket; reconciliation read the same
column so its drift gauge reported 0 while the rollup was wrong — self-concealing.

usage_ledger had no column tying a row back to LiteLLM startTime, so this fix
adds one:

 - migration 0027 adds usage_ledger.event_at (timestamptz, nullable) +
   usage_ledger_event_at_idx (tenant_id, event_at).
 - ingest-litellm-spend.ts now writes the spend row's startTime into event_at.
 - usage-rollup-daily.ts (dispatcher + tenant aggregate) and
   reconciliation-daily-check.ts bucket on COALESCE(event_at, created_at).

Going-forward only: historical rows have NULL event_at and keep created_at
bucketing via COALESCE, so already-published rollup numbers do not shift.
Re-computing historical rollups is out of scope.

Closes worker:CR-02.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification
```
pnpm --filter @openwhispr/worker test -- usage-rollup-daily
pnpm --filter @openwhispr/worker test -- reconciliation-daily-check
pnpm --filter @openwhispr/data test
grep -rn "COALESCE(event_at" apps/worker/src/jobs/
grep -n "event_at" packages/data/src/schema/usage_ledger.ts
ls packages/data/migrations/0027_usage_ledger_event_at.sql packages/data/migrations/0027_usage_ledger_event_at.down.sql
grep -rn "worker:CR-02" apps/worker/tests/
```

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LiteLLM_SpendLogs → worker | Worker reads an external billing DB; rows may be incomplete (missing end_user) or malformed (bad duration). |
| desktop client → API (token rotation) | Old bearer presented during the 5-minute overlap window crosses an auth boundary. |
| oauth_state row → codec | A row reaching `decryptCodeVerifierFromRow` carries a (formerly) secret PKCE verifier. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-58-01 | Tampering / Repudiation | spend-ingest watermark | mitigate | Recoverable-skip rows hold the watermark; `ON CONFLICT (request_id)` makes re-ingest idempotent → no double-billing, no silent spend loss. (Track A) |
| T-58-02 | Denial of Service | spend-ingest watermark | mitigate | `MAX_RECOVERABLE_HOLD_MS` (24h) caps the hold so a permanently-unresolvable row cannot stall ingest forever; aged-out rows emit a billing-anomaly counter. (Track A) |
| T-58-03 | Information disclosure | usage rollup correctness | accept | Mis-bucketed rollup leaks no data — it is a billing-accuracy bug, not a confidentiality one. `event_at` bucketing fixes accuracy. (Track B) |
| T-58-04 | Spoofing / Elevation | AUTH-04 overlap window | mitigate | `previous_token_fp` is `sha256(bearer)`; lookup filters `previous_token_expires_at > now()` so a stale/expired old bearer cannot authenticate. (Track C) |
| T-58-05 | Tampering | oauth-state codec | mitigate | Deleting the plaintext-fallback branch removes the path where the codec would trust a caller-supplied `code_verifier` instead of decrypting the ciphertext sidecars. (Track D) |
</threat_model>

<verification>
Phase-level gate (run after all 4 tracks):

```
pnpm --filter @openwhispr/worker test
pnpm --filter @openwhispr/data test
pnpm --filter @openwhispr/api test -- auth-04-token-rotation-overlap
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-01 (no NODE_ENV in jobs),
                           # LOCKER-08 (no plaintext secret cols — event_at is not secret)
pnpm typecheck             # no new errors vs the documented 5-error baseline
git log --oneline -12      # expect the RED/GREEN commit pairs for A, B, D + the C commit(s)
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not trust):
- `grep -rn "58-A\|58-B\|58-C\|58-D" apps/ packages/ --include="*.test.ts"` — every
  track has a test referencing its finding ID.
- `grep -rn "worker:CR-01\|worker:CR-02\|data:CR-04\|data:CR-05"` in test files.
- Each cited commit SHA is on HEAD; `git status --short` clean.
</verification>

<success_criteria>
- All 4 findings closed: RED+GREEN pair on main for A, B, D; C is either a RED+GREEN
  pair OR a single regression-lock commit with documented proof it was already closed.
- `usage_ledger.event_at` column exists (migration 0027 + schema + down migration).
- Ingest writes `event_at`; rollup + reconciliation bucket on `COALESCE(event_at, created_at)`.
- All four spend-skip reasons emit `recordBillingAnomaly`.
- Watermark holds on recoverable skips, bounded by `MAX_RECOVERABLE_HOLD_MS`.
- `oauth-state-codec.ts` has no plaintext-fallback branch; type field removed.
- `pnpm test` green for worker + data; `pnpm lint:lockers` green (8); `pnpm typecheck`
  no new errors vs 5-error baseline.
- `.planning/review/REVIEW-INDEX.md` annotated "Closed by Phase 58" for all 4 findings.
- `.planning/deferred-items.md` updated (Track C false-positive note if applicable;
  any HALT findings).
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
</success_criteria>

<risk_register>
| Risk | Track | Mitigation |
|------|-------|------------|
| Changing watermark-advance logic re-processes already-billed rows → **double-billing**. | A | `INSERT ... ON CONFLICT (request_id) DO NOTHING` — `usage_ledger.request_id` is globally UNIQUE; a re-scanned already-inserted row is a no-op. RED Scenario A step 4 + an idempotency replay assertion prove it. |
| Watermark never advances → **ingest stalls** on a row whose user never materializes. | A | `MAX_RECOVERABLE_HOLD_MS` (24h) ages out the hold; aged rows emit `recordBillingAnomaly("recoverable_skip_aged_out")`. RED Scenario C asserts unrecoverable rows never stall. |
| Re-bucketing historical `usage_ledger` rows by `event_at` **shifts already-reported rollup numbers**. | B | **Decision: going-forward only.** Migration 0027 adds `event_at` nullable; rollup/reconciliation use `COALESCE(event_at, created_at)` so historical (NULL) rows keep `created_at` bucketing. Re-computing history is explicitly OUT OF SCOPE. Surface this decision in SUMMARY. |
| Track B blocked because `usage_ledger` has no `startTime` column. | B | Confirmed by reading the schema — B is CHAINED to A; migration 0027 + ingest write land in this plan before the rollup query change. |
| Track C: writing a redundant production fix when Phase 57 / the raw-SQL `recordPreviousToken` path already closed `data:CR-04`. | C | Investigation step is MANDATORY and FIRST: characterization test branches the work — if it passes, Track C is regression-lock-only, no production change. |
| Track D: deleting a plaintext branch a migration-CLI / seed script still hits. | D | Investigation step greps `packages/data/src/bin`, `tools/`, `apps/*/src`, and migration 0020 to confirm the branch is genuinely dead before deletion; HALT if any live caller found. |
| A failing test exposes a deeper architectural constraint and tempts a production hack. | A, B, C | CLAUDE.md hard rule 1: HALT, log in `.planning/deferred-items.md` with `WHY:` evidence, report — never edit production solely to green a test. |
| LOCKER-08 (no plaintext secret columns) false-positive on new `event_at` column. | B | `event_at` is a timestamp, not a credential — its name does not match the LOCKER-08 regex `/^(access_token|...|code_verifier)$/`. Confirm `pnpm lint:lockers` green after migration 0027. |
</risk_register>

<out_of_scope>
Deferred to Phase 59+ (NOT touched by this phase):
- All ~38 HIGH findings (incl. `worker:CR-03..CR-09` HIGH items: email-delivery
  NODE_ENV violation, ROLLBACK-replaces-error, partman non-idempotent enqueue,
  reconciliation duplicate-enqueue, `drainStaleVkrKeys` cap, shutdown exit code,
  `maintenancePool` PgBouncer guard; and `data` HI-01..HI-06).
- All ~49 MEDIUM findings (incl. `worker:WR-01..WR-06`, `data:ME-01..ME-07`).
- All ~30 LOW findings.
- Re-computing historical `usage_rollup_daily` numbers under the new `event_at`
  bucketing (Track B is going-forward only).
- The durable per-request Better Auth RLS adapter (`data:CR-02` D3) — already a
  v2-blocker in `.planning/deferred-items.md`.
</out_of_scope>

<output>
After completion, create
`.planning/phases/58-remaining-critical-fixes/58-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- Track C branch taken (already-closed vs needed-a-fix) + evidence.
- Track A fix option chosen (b — bounded watermark hold) + any deviation.
- Track B going-forward-only decision + `COALESCE` rationale.
- Track D: single combined commit vs RED/GREEN split.
- Any HALT + `deferred-items.md` entries.
Then annotate `.planning/review/REVIEW-INDEX.md` with "Closed by Phase 58" markers
for `worker:CR-01`, `worker:CR-02`, `data:CR-04`, `data:CR-05`.
</output>
