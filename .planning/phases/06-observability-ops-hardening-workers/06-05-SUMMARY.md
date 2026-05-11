---
phase: 06-observability-ops-hardening-workers
plan: 05
subsystem: audit
tags: [DATA-04, OBS-03, audit_log, rls, threat-T-audit-loss, threat-T-bearer-leak]
requires:
  - Plan 06-02 (audit_log partitioned + 18-action CHECK constraint) — GREEN
  - Phase 1 withTenant() + RLS / app.tenant_id GUC
provides:
  - apps/api/src/lib/audit.ts — recordAudit(tx, ctx, action, payload)
    canonical chokepoint
  - 18-action AuditAction const-union re-exported as AUDIT_ACTIONS
  - per-action Zod payload schemas (D-A7) at compile + runtime
  - FORBIDDEN_AUDIT_KEYS rejection (T-bearer-leak)
  - auditCtxFromRequest() Fastify-request convenience builder
  - 3 wired emission sites (account.delete, key.issued, key.revoked)
affects:
  - apps/api/src/routes/delete-account.ts — refactored to canonical
    `account.delete` action via recordAudit (replaces legacy
    `account_deleted` string)
  - apps/api/src/routes/v1/keys/create.ts — emits key.issued
  - apps/api/src/routes/v1/keys/revoke.ts — emits key.revoked
    (only on successful revoke; cross-tenant 404 skips emission)
  - apps/api/src/routes/v1/keys/__tests__/setup.ts — switched to
    `openwhispr/postgres:17.5-pgpartman` image (Rule 3 — 06-02
    fallout that blocked every keys integration test)
tech-stack:
  added: []
  patterns:
    - "shared recordAudit() helper as the SINGLE chokepoint for
      audit_log INSERTs"
    - "compile-time-checked Zod schema map via `satisfies
      Record<AuditAction, ZodTypeAny>`"
    - "runtime forbidden-key sweep at the helper boundary
      (case-insensitive)"
    - "in-band sync INSERT inside the route's withTenant() tx so the
      audit row exists iff the audited action commits (D-A1)"
    - "RLS-invisibility preservation: emit ONLY when the route's
      UPDATE/INSERT actually targeted a tenant-visible row
      (cross-tenant 404 paths skip emission)"
key-files:
  created:
    - apps/api/src/lib/audit.ts
    - apps/api/src/lib/audit.test.ts
    - .planning/phases/06-observability-ops-hardening-workers/06-05-SUMMARY.md
  modified:
    - apps/api/src/routes/delete-account.ts
    - apps/api/src/routes/delete-account.test.ts
    - apps/api/src/routes/v1/keys/create.ts
    - apps/api/src/routes/v1/keys/revoke.ts
    - apps/api/src/routes/v1/keys/__tests__/setup.ts
    - apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts
  deleted: []
decisions:
  - id: D-05-1
    summary: "ctx UUID validation relaxed from zod 4's strict
      RFC-4122 v4 (variant byte 8/9/a/b) to a hex-UUID regex that
      matches packages/data/src/tenant-context.ts withTenant(). The
      project's seed/RLS layer accepts hex-shaped UUIDs (test
      fixtures like 00000000-…-00000000000b); making the audit ctx
      stricter than the rest of the stack would block legitimate
      emissions while adding no security value (DB FK + the
      audit_log_action_check CHECK enforce well-formedness
      downstream)."
  - id: D-05-2
    summary: "recordAudit() throws on INSERT failure rather than
      swallowing-and-warn-logging. Rationale: D-A1 mandates the
      audit row exists iff the audited action commits; an INSERT
      failure inside the withTenant() tx MUST roll back the action.
      Operator-facing observability of failures comes from the
      global error handler logging the unhandled tx error
      (Loki-shippable level=error). Plan 06-11 alerts hook this
      surface."
  - id: D-05-3
    summary: "revoke.ts skips key.revoked emission when the UPDATE
      matches zero rows (cross-tenant attempt / unknown id /
      RLS-invisible). Emitting would leak the existence of a
      tenant-A key id into a row tenant-A might later read,
      violating the RLS-invisibility contract (CLAUDE.md
      mirror)."
  - id: D-05-4
    summary: "Task 2's 15-emission-site target was reduced to 3
      because the routes plan 06-05 enumerates do not yet exist in
      the codebase (no apps/api/src/routes/auth/ subdirectory, no
      apps/api/src/routes/admin/, settings routes are read-only,
      no soft-delete grace route). The 12 deferred emissions are
      enumerated below with the future plan that brings each route
      into existence."
metrics:
  duration_minutes: 75
  completed: 2026-05-11
---

# Phase 6 Plan 05: Audit Log Emission Helper + Initial Wiring Summary

**One-liner:** Implements the canonical `recordAudit()` helper (Task 1
— 100/100/100/100 coverage) at `apps/api/src/lib/audit.ts` with all
18 D-A6 actions schema-defined + forbidden-key sentinel guard, and
wires the 3 immediately-achievable emission sites
(`account.delete`, `key.issued`, `key.revoked`) — every wired site
goes through the shared helper inside the route's existing
`withTenant()` transaction so the audit row exists iff the audited
action commits.

## What landed

### Task 1 — recordAudit helper (commit `c3435a7`)

`apps/api/src/lib/audit.ts` exports:

- `AUDIT_ACTIONS` — 18-element const-union re-exported from
  `@openwhispr/data/schema` (sourced from `AUDIT_LOG_ACTIONS`); the
  DB-side CHECK constraint added in Plan 06-02 enforces the same
  set.
- `AuditAction` type — `(typeof AUDIT_ACTIONS)[number]`.
- `FORBIDDEN_AUDIT_KEYS` — `password / token / bearer /
  access_token / refresh_token / code / state / virtual_key /
  api_key / authorization`; case-insensitive rejection at the
  helper boundary (D-A7 + T-bearer-leak).
- `auditPayloadSchemas` — `Record<AuditAction, ZodTypeAny>` per
  D-A7 (one entry per action). The `satisfies` cast catches a
  missing entry at compile time if a future plan adds a 19th
  action.
- `AuditCtx` — `{ tenant_id, actor_user_id?, request_id, ip,
  user_agent }`; `actor_user_id` nullable for `auth.signin_failed`
  + `security.*` rows that cannot identify a user yet.
- `recordAudit(tx, ctx, action, payload)` — validates ctx + payload
  via Zod, runs forbidden-key sweep over the caller-supplied
  payload, applies `AUDIT_REDACT_IP=true` (payload.ip → null) and
  truncates user_agent to 512 chars, then `tx.execute(sql\`INSERT
  INTO audit_log ...\`)` synchronously inside the caller's tx.
- `auditCtxFromRequest(req, tenantId, actorUserId)` — convenience
  builder so emission sites are one-liners.

### Task 2 — 3 emission sites wired

#### `account.delete` (commit `8d5e44e`)

`apps/api/src/routes/delete-account.ts` refactored:

- Replaced the legacy `account_deleted` raw-SQL INSERT (which used
  a non-canonical action string that pre-dated the Plan 06-02 CHECK
  constraint) with `recordAudit(tx, auditCtx, "account.delete",
  {})` inside the same withTenant() tx that cascades sessions +
  users deletion.
- Payload now shaped per D-A7: `{request_id, ip, user_agent}` as
  always-required base fields, empty per-action payload (D-A7 lists
  no required keys for account.delete).
- `delete-account.test.ts` updated: 5/5 GREEN. Test fixtures
  migrated to v4-shaped UUIDs (zod 4's `.uuid()` enforces variant
  byte 8/9/a/b; the legacy `1111…/2222…` literals failed). The
  earlier `email=null` payload assertion was rewritten to assert
  only that the INSERT runs (D-A7 no longer carries an `email`
  field).

#### `key.issued` + `key.revoked` (commit `201296e`)

`apps/api/src/routes/v1/keys/create.ts`:

- After the api_keys INSERT succeeds, emit `key.issued` inside the
  same withTenant() tx. Payload `{key_id: inserted.id}` ONLY — the
  clear-text PAK and the Argon2 key_hash never reach the audit row
  (T-bearer-leak proved by sentinel sweep in the integration test
  below).

`apps/api/src/routes/v1/keys/revoke.ts`:

- After the UPDATE returns a row, emit `key.revoked` with
  `{key_id, reason: "manual"}`. When the UPDATE matches zero rows
  (cross-tenant attempt / unknown id / RLS-invisible), the audit
  emission is INTENTIONALLY skipped — emitting would leak the
  existence of a tenant-A key id into a row that tenant-A might
  later read, violating the RLS-invisibility contract.
- The future `key.revoked` reasons `rotated` and `compromised` are
  schema-defined but not yet emitted (no rotation worker or
  compromise-flagging endpoint exists yet; Plan 06-09 adds the
  `virtual-key-rotation` BullMQ queue which will emit
  `reason: "rotated"`).

`apps/api/src/routes/v1/keys/__tests__/setup.ts` — switched test
container image from `postgres:17-alpine` to
`openwhispr/postgres:17.5-pgpartman` and provisioned the
`pg_partman` extension + GRANTS, mirroring
`packages/data/src/__tests__/helpers.ts`. This is a Rule 3 blocking
fix: Plan 06-02 introduced migration 0014 which requires pg_partman
at apply time, and the apps/api keys setup wasn't updated alongside,
so every keys integration test errored at boot with `schema "partman"
does not exist`. Fixed inline because Task 2 cannot test against a
broken harness.

`apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts`
— 3 new integration tests:

1. **`key.issued` emission test** — POST /create succeeds, audit
   row exists with `action='key.issued'`, payload carries
   `key_id` equal to the response id, and `JSON.stringify(payload)`
   does NOT contain the clear-text PAK (T-bearer-leak sentinel
   sweep).
2. **`key.revoked` emission test** — POST /create then POST
   /revoke; audit row exists with `payload.key_id` matching, and
   `payload.reason === 'manual'`.
3. **Cross-tenant 404 → no emission** — tenant-A creates a key,
   tenant-B revokes the same id (returns 404 per RLS); audit_log
   has ZERO `key.revoked` rows (RLS-invisibility preserved).

### Action→Route map (3 wired / 15 in-scope per plan)

| # | D-A6 action          | Wired-in route                                | Status  |
|---|----------------------|-----------------------------------------------|---------|
| 6 | account.delete       | DELETE /api/auth/delete-account               | WIRED   |
| 8 | key.issued           | POST /api/v1/keys/create                      | WIRED   |
| 9 | key.revoked          | POST /api/v1/keys/:id/revoke                  | WIRED   |

## Deferred emissions (12 of 15 plan targets)

Each is deferred because the route or hook the plan refers to does
not yet exist in the codebase. The plan was authored assuming the
auth/admin/settings-mutation surface was already built; in fact most
of it lands in future Phase 7 (UI + admin console) and Phase 8 (auth
hardening) plans. Until then the helper is in place and the
emissions are one-liners to add when the routes appear.

| #  | D-A6 action               | Where it lands                  | Why deferred                                                                                                                                                               |
|----|---------------------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | auth.signin               | Better Auth `databaseHooks.session.create.after` in `apps/api/src/auth.ts` | BA hook integration is non-trivial: the hook receives BA's internal context, not a withTenant() tx — wiring the audit emission requires acquiring a fresh tx inside the hook, deferred to a dedicated Better-Auth-hooks plan. |
| 2  | auth.signin_failed        | Better Auth `auth.hooks.before` or explicit catch in signin route | Same BA-hook concern. The failure path also lacks a stable tenant binding (the user hasn't authenticated yet).                                                              |
| 3  | auth.signout              | Better Auth signout hook         | Same BA-hook concern.                                                                                                                                                       |
| 4  | auth.password_change      | Better Auth password-update hook | Same BA-hook concern.                                                                                                                                                       |
| 5  | auth.oauth_link           | Better Auth oauth-link hook      | Same BA-hook concern.                                                                                                                                                       |
| 7  | account.delete_requested  | New POST /api/auth/delete-account/request grace-window route | Soft-delete grace-window endpoint not yet specified; `packages/data/src/schema/soft-delete.ts` exists but no route consumes it.                                              |
| 10 | settings.tenant_changed   | Future PATCH /api/stt-config + /api/note-recording-config | The current routes are GET-only (Phase 5 D-31 left mutations to Phase 7).                                                                                                   |
| 11 | settings.user_changed     | Same as #10 (user-tier mutations) | Same — read-only routes today.                                                                                                                                              |
| 12 | admin.tenant_created      | Future POST /api/admin/tenants   | No `apps/api/src/routes/admin/` directory yet; admin console + routes ship in Phase 7.                                                                                       |
| 13 | admin.tenant_suspended    | Future PATCH /api/admin/tenants/:id/suspend | Phase 7.                                                                                                                                                                     |
| 14 | admin.user_impersonated   | Future POST /api/admin/users/:id/impersonate | Phase 7.                                                                                                                                                                     |
| 15 | admin.role_changed        | Future PATCH /api/admin/users/:id/role | Phase 7.                                                                                                                                                                     |

The three `security.*` actions (16/17/18) remain deferred to
06-07 (rate-limit middleware), 06-09 (?? — TBD), and 06-06 (SSRF
dispatcher already landed; the `security.ssrf_blocked` emission
inside it is a Plan 06-06 follow-up).

## Verification

- `apps/api/src/lib/audit.test.ts` — 41/41 GREEN against the
  partman testcontainer.
- `apps/api/src/routes/delete-account.test.ts` — 5/5 GREEN.
- `apps/api/src/routes/v1/keys/__tests__/{crud,revoke}
  .integration.test.ts` — 18/18 GREEN (15 pre-existing + 3 new
  audit assertions).
- Coverage (per-file, json-summary):
  - `audit.ts` — 100 / 100 / 100 / 100 (lines / branches /
    functions / statements) — meets the ≥90/90/90/90
    constitutional floor.
  - `delete-account.ts` — 100 / 100 / 100 / 100.
  - `routes/v1/keys/create.ts` — 91.17 / 77.27 / 85.71 / 90.9.
    The branches/functions miss are PRE-EXISTING defensive
    guards (the dual-auth 401, the "insert returned no row"
    throw, and the 23505 collision catch) that this plan did
    not modify. The new recordAudit-call line is exercised by
    the new integration test.
  - `routes/v1/keys/revoke.ts` — 95 / 87.5 / 100 / 95. Branches
    miss is the pre-existing dual-auth 401 defensive guard.
  - Phase coverage gate: new/modified LINES in this plan are
    100% exercised; pre-existing dead-defensive branches in
    create.ts/revoke.ts are explicitly out of scope (Rule 4
    boundary).
- `pnpm exec tsc -p tsconfig.json --noEmit` — pre-existing
  errors in 11 unrelated test files persist (verbatim-module-
  syntax + zod-internals + better-auth fastify-types — all
  predate this plan). No new typecheck errors introduced by
  this plan's files.

## Audit emission failure-handling contract (documented)

Per D-05-2, `recordAudit()` throws on validation or INSERT
failure rather than swallowing-and-warn-logging:

- **Programmer misuse** (wrong payload shape, forbidden key,
  missing required field) — Zod parse throws; the route's tx
  rolls back; the global error handler emits the canonical
  error envelope. This surfaces in CI/staging immediately.
- **Database error** (CHECK violation if a future action is
  added without updating Plan 06-02's CHECK; Postgres
  unavailable; partition routing failure) — pg error
  propagates; the route's tx rolls back. The audited action
  also rolls back, preserving D-A1's "audit row exists iff
  audited action commits."
- **Operator observability** — Loki captures the `level=error`
  log line emitted by the global error handler when the tx
  fails. Plan 06-11 (alerts) adds a Grafana alert rule for
  `count_over_time({app="api"} |~ "audit"
  [5m]) > 0`.

Route handlers MUST NOT catch the error from `recordAudit()`.

## Deviations from Plan

### Rule 4 — scope renegotiated (12 of 15 emissions deferred)

The plan's `files_modified` list enumerates 12 route files; 9 of
them do not exist in the codebase yet. The plan was written
assuming a finished auth/admin/settings-mutation surface, but in
fact only the 3 sites wired in this plan (`account.delete`,
`key.issued`, `key.revoked`) have routes that exist. Rather
than block this plan on landing 9 new route files (which would
fold work from Phase 7's UI + admin console plus a dedicated
Better-Auth-hooks plan into Plan 06-05), the helper has been
shipped + the 3 immediately wireable sites done + the remaining
12 documented above with the future plan that brings each into
existence. This preserves DATA-04's enforcement story
(centralized helper, schema-locked, forbidden-key sweep) while
acknowledging the realistic landing window for the remaining
emissions.

### Rule 3 — auto-fixed blocking issues

**1. `apps/api/src/routes/v1/keys/__tests__/setup.ts` — partman
image switch.** Plan 06-02 introduced migration 0014 which
requires `pg_partman`. The data-package test helpers were
updated alongside, but `apps/api/src/routes/v1/keys/__tests__
/setup.ts` (and the parallel notes/folders/transcriptions
setups) still pinned `postgres:17-alpine`. Result: every keys
integration test errored at boot with `schema "partman" does
not exist`. Fixed inline because Task 2's wiring tests cannot
run against a broken harness. The notes/folders/transcriptions
setups remain on the old image — they are not exercised by
this plan and their fix is logged in `deferred-items.md` for a
follow-up consolidation plan.

**2. `apps/api/src/lib/audit.ts` — UUID regex relaxation.** Zod
4's `z.string().uuid()` enforces strict RFC-4122 variant byte
(8/9/a/b), which rejects the project's test fixtures
(`00000000-…-00000000000b`). Used a hex-UUID regex matching
`packages/data/src/tenant-context.ts` withTenant() shape so the
audit gate accepts every input the RLS gate accepts. DB-side
FK + CHECK constraints still enforce well-formedness
downstream.

**3. `apps/api/src/lib/audit.ts` — request_id schema
relaxation.** Originally `z.string().uuid()`; Fastify's
default `genReqId` emits `req-N` counter strings. Relaxed to
`z.string().min(1)` so the helper works without a
UUID-stamping middleware (Plan 06-03 pino correlation can
wire one later).

**4. `apps/api/src/routes/v1/keys/revoke.ts` — `let params`
implicit-any.** Pre-existing biome warning escalated to
error in this commit's pre-commit hook (biome 2.x changed
severity). Fixed by annotating `let params:
z.infer<typeof ParamsSchema>;`.

### Rule 2 — auto-added missing critical functionality

**5. RLS-invisibility preservation in `key.revoked`
emission.** The plan body says "wire key.revoked in
revoke.ts" without specifying the cross-tenant-404 path.
Emitting unconditionally would write a tenant-context-A row
whose payload references a tenant-B key id — a 404 path
that confirms existence across tenants. Added the
`if (updated)` guard so the audit row only writes when the
UPDATE actually targeted a visible row. Pinned by a new
integration test.

**6. Sentinel-token sweep in `key.issued` integration test.**
The plan's acceptance criteria says "no raw secrets in any
payload field" but does not specify a positive test. Added
an integration assertion that
`JSON.stringify(audit_row.payload)` does NOT contain the
clear-text PAK returned by /create. Proves T-bearer-leak
mitigation observably.

## Known Stubs

None. All wired emissions write real rows through the helper;
all 18 D-A6 actions have working Zod schemas + the CHECK
constraint enforces them DB-side; the 12 unwired emissions
have no stub paths (they will be added inline in their
respective future plans alongside the route they emit from).

## Threat Flags

None. This plan modifies routes that were already part of the
auth + keys threat surface; no new endpoints, no new schema
columns, no new outbound network targets. The audit_log
INSERT path is enumerated in the existing T-audit-loss /
T-bearer-leak entries and remains within scope.

## Self-Check: PASSED

- `apps/api/src/lib/audit.ts` — FOUND
- `apps/api/src/lib/audit.test.ts` — FOUND
- `apps/api/src/routes/delete-account.ts` — FOUND (modified;
  `recordAudit` call present, legacy `'account_deleted'`
  string removed — `grep -n recordAudit
  apps/api/src/routes/delete-account.ts` matches; `grep -n
  account_deleted apps/api/src/routes/delete-account.ts` →
  no match)
- `apps/api/src/routes/v1/keys/create.ts` — FOUND (modified;
  `recordAudit(tx, …, "key.issued", …)` present)
- `apps/api/src/routes/v1/keys/revoke.ts` — FOUND (modified;
  `recordAudit(tx, …, "key.revoked", …)` present)
- `apps/api/src/routes/v1/keys/__tests__/setup.ts` — FOUND
  (partman image)
- commit `c3435a7` (Task 1 — helper) — FOUND
- commit `8d5e44e` (account.delete refactor) — FOUND
- commit `201296e` (key.issued + key.revoked wiring) — FOUND
