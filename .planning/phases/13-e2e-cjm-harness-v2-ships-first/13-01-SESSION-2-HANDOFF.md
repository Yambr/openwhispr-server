# Plan 13-01 — Session 2 Handoff

**Session:** 2 of 5
**Tasks covered:** 13-01-04 (packages/email/ real implementation: `EmailSender` + structural `Logger` + prod loud-fail + `SMTP_SECURE` / `SMTP_REJECT_UNAUTHORIZED` env overrides + README env-var contract)
**Working-tree only — NO COMMITS this session.** Per D-04 atomic-commit invariant.
**Date:** 2026-05-14

---

## 1. `git status --short` snapshot (end of session)

```
 M .planning/config.json
 M apps/api/vitest.config.ts
 M package.json
 M pnpm-lock.yaml
 D speaches-audio.md
 M vitest.config.ts
?? .planning/deferred-items.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-RECON.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-SESSION-1-HANDOFF.md
?? apps/api/vitest.setup.ts
?? apps/web/public/
?? packages/email/
?? tests/e2e-cjm/
?? tools/__tests__/global-vitest-teardown.test.ts
?? tools/global-vitest-teardown.ts
?? tools/lint-weak-assertions.test.ts
?? tools/lint-weak-assertions.ts
```

**Topologically identical to Session-1 snapshot.** `packages/email/` was already
untracked at end of Session 1 (skeleton files only — `package.json`, `tsconfig.json`,
`vitest.config.ts`, empty `src/index.ts`). Session 2 added 3 files inside that
already-untracked directory plus the README, so the `??` line for `packages/email/`
still represents the only change to the working-tree status surface.

**Session 3 MUST verify the snapshot above matches `git status --short` before doing
anything.** If it does not match, halt with a Rule 4 checkpoint.

---

## 2. Files written this session (`wc -l`)

| File | LOC | Status |
|---|---:|---|
| `packages/email/src/EmailSender.ts` | 155 | new (real implementation; replaces Session-1 placeholder) |
| `packages/email/src/EmailSender.test.ts` | 425 | new (24 unit tests) |
| `packages/email/src/index.ts` | 19 | rewritten (Session-1 stub `export {}` -> full public-surface barrel) |
| `packages/email/README.md` | 174 | new (operator-facing env-var contract, log-event reference, testing posture) |

**Total new+rewritten LOC this session: 773.**

No file outside `packages/email/` was touched. The skeleton files written by the
prior agent in Session 1 (`packages/email/package.json`, `packages/email/tsconfig.json`,
`packages/email/vitest.config.ts`) are unchanged.

---

## 3. Test + coverage results

### 3a. `pnpm --filter @openwhispr/email test` — EXIT 0

```
RUN  v4.1.5 /Users/dev/openwhispr-server/packages/email
Test Files  1 passed (1)
     Tests  24 passed (24)
```

24 tests in 7 `describe` blocks:

- **happy path (SMTP_HOST configured)** — 6 tests: T1 sendMail-resolves; T2 sendMail-rejects (RE-THROW); T8 auth-only-when-both; T10 html-flow-through; default `SMTP_FROM`; default `SMTP_PORT=587` + `secure=false`.
- **SMTP_SECURE env override (T5)** — 4 tests: port=465 heuristic, port=587 heuristic, `SMTP_SECURE="true"` override beats heuristic, `SMTP_SECURE="false"` override beats heuristic.
- **SMTP_REJECT_UNAUTHORIZED env (T6)** — 3 tests: unset -> no `tls` option, `"true"` -> no `tls` option, `"false"` -> `tls: { rejectUnauthorized: false }` propagates.
- **production loud-fail gate (T3)** — 3 tests: prod + unset throws `/email\.smtp_required_in_production/`; prod + set does NOT throw; loud-fail does NOT also emit warn.
- **dev fallback (T4, T9)** — 5 tests: warn `event=email.smtp_not_configured`; `NODE_ENV=development` no-throw; T9 dev-fallback `{ delivered:true, reason:"smtp-not-configured" }`; dev-fallback does NOT call nodemailer; dev-fallback logs `event=email.skipped`.
- **structural Logger acceptance (T7)** — 2 tests: plain-object Logger satisfies the contract (no Fastify dep); SendArgs compile-time contract.
- **nodemailer module integration sanity** — 1 test: named + default exports both resolve.

### 3b. `pnpm --filter @openwhispr/email test --coverage` — coverage on `packages/email/src/**`

```
=============================== Coverage summary ===============================
Statements   : 100% ( 25/25 )
Branches     : 100% ( 18/18 )
Functions    : 100% ( 3/3 )
Lines        : 100% ( 25/25 )
================================================================================
```

**100/100/100/100 on `EmailSender.ts`.** Exceeds the constitutional ≥90/90/90/90
floor by 10pp on every axis.

> Note on the empty per-file table: v8 + Vitest 4 with `all: false` (inherited from
> root config) reports an empty "All files" rollup table but the aggregate summary
> is authoritative — `25/25 statements`, `18/18 branches`, `3/3 functions`,
> `25/25 lines` corresponds exactly to the surface in `packages/email/src/EmailSender.ts`
> (the `index.ts` barrel is type-only re-exports and emits no runtime statements).
> If the executor in a future session wants the per-file table to render, set
> `all: true` in `packages/email/vitest.config.ts` — but this is a cosmetic
> reporter detail, not a coverage gap.

### 3c. `pnpm --filter @openwhispr/email typecheck` — EXIT 0

`tsc -p tsconfig.json --noEmit` clean against `tsconfig.base.json` strict settings
(including `exactOptionalPropertyTypes: true`). All test-file types reconciled
explicitly (typed `vi.fn()` generics on `sendMailMock` + `createTransportMock`,
explicit `SpyLog` intersection type for log spies, `firstCall![0]` instead of
destructure-from-tuple for `mock.calls[0]` access).

### 3d. `pnpm install --frozen-lockfile` — EXIT 0

```
Scope: all 17 workspace projects
Already up to date
```

No devDep / dep drift relative to Session 1.

---

## 4. Plan acceptance grep checklist (task 13-01-04 lines 360–368)

| # | Acceptance criterion | Required | Actual | Status |
|---:|---|---|---:|:--:|
| 1 | `pnpm vitest run packages/email` exits 0 with ≥ 8 tests | exit 0, ≥8 | exit 0, 24 | ✅ |
| 2 | Coverage ≥ 90/90/90/90 on `EmailSender.ts` | ≥90 | 100/100/100/100 | ✅ |
| 3 | `grep -E "SMTP_PASSWORD" packages/email/src/EmailSender.ts` ≥ 1 | ≥1 | 2 | ✅ |
| 4 | `grep -E "SMTP_PASS\b" packages/email/src/EmailSender.ts` = 0 | =0 | 0 | ✅ |
| 5 | `grep -E "email\.smtp_required_in_production" packages/email/src/EmailSender.ts` ≥ 1 | ≥1 | 1 | ✅ |
| 6 | `grep -v '^//' packages/email/README.md \| grep -c "SMTP_PASSWORD"` ≥ 1 | ≥1 | 2 | ✅ |
| 7 | `grep -v '^//' packages/email/src/EmailSender.ts \| grep -c "FastifyBaseLogger"` = 0 | =0 | 0 | ✅ |

(One header line-comment in `EmailSender.ts` mentions `@fastify/* coupling` in the
"no Fastify coupling" callout — it is filtered out by the plan's `grep -v '^//'`
acceptance command. Confirmed via manual re-run of the exact acceptance pipeline.)

---

## 5. Decisions applied this session (binding for downstream sessions)

### 5a. `index.ts` barrel re-exports the full public surface

`packages/email/src/index.ts` exports `createEmailSender`, `CreateEmailSenderOpts`,
`EmailSender`, `Logger`, `SendArgs`, `SendResult`. Importers (apps/worker in
Session 5, apps/api after D-04 rewires) should import from `@openwhispr/email`
without reaching into `./src/...`.

### 5b. nodemailer mocked via typed `vi.fn` generics, NOT runtime `as never` casts

The test mock provides BOTH `default.createTransport` AND named `createTransport`
exports (ESM/CJS interop safety) and types them as
`(opts: CreateTransportOpts) => { sendMail: typeof sendMailMock }`. `sendMailMock`
is typed `(opts: SendMailOpts) => Promise<{ messageId: string }>`. This makes
`createTransportMock.mock.calls[0]?.[0]` resolve to `CreateTransportOpts | undefined`
under strict TS, eliminating the `mock.calls[0] ?? []` destructure-from-empty-tuple
anti-pattern that would otherwise need `// @ts-expect-error`.

### 5c. `packages/email/package.json` `nodemailer` and `@types/nodemailer` left at
wildcard pins (`"*"`) from the Session-1 skeleton

The Session-1 prior agent left `nodemailer: "*"` + `@types/nodemailer: "*"` in
`packages/email/package.json`. The resolved versions at install time are
`nodemailer@8.0.7` (matches the root workspace transitive). **No action this
session.** A follow-up cleanup to pin them at exact versions can land in Session 5's
atomic commit if desired, but is not gated by Task 13-01-04 acceptance criteria.

### 5d. v8 + Vitest 4 `all: false` per-file empty rollup is a known reporter
quirk, NOT a coverage gap

The aggregate summary is authoritative; rephrased explanation in §3b. Future
sessions running coverage on `packages/email/` should rely on the summary numbers,
not the per-file table.

---

## 6. Notes for downstream sessions

### Session 3 — `/api/health` `migrations_completed` + weak-assertion sweep

- **Schema lives in `packages/contract-tests/src/schemas.ts`** (NOT
  `packages/contract-tests/schemas/health.ts` — plan's `<files>` line 376 is wrong;
  RECON busted assumption #5 + Session-1 handoff §5 already flagged this).
- **15 weak-assertion sites, not 8** (Session-1 handoff §3g). Task 13-01-06 `<files>`
  list must be expanded to 7 files. Acceptance criterion line 437 should read
  "≥ 15 line changes across exactly 7 files".
- `checkMigrationsCompleted` MUST reuse the existing api pool (not a one-shot
  `new Client()`) — see RECON OQ-3 + plan task 13-01-05 action description.

### Session 4 — compose harness + readiness + steps

- Open Rule 4 checkpoints from RECON still apply: OQ-1 (mailpit reachability),
  OQ-2 (which compose file does `make e2e-cjm` boot), OQ-3 (drop direct Postgres
  `SELECT 1` probe).
- `world.ts` must keep `test` + `expect` imported from `"playwright-bdd"` (NOT
  `@playwright/test`) per Session-1 §4c.

### Session 5 — atomic D-04 commit + integration delta

- `apps/worker/src/index.ts` rewires: drop `noopSender` (lines 68-72), add
  `createEmailSender` import + `realSender = createEmailSender({ log, env: process.env })`,
  replace `sender: noopSender` with `sender: realSender`.
- `apps/worker/package.json` adds `"@openwhispr/email": "workspace:*"` to deps.
- Delete `apps/api/src/email.ts` + `apps/api/src/email.test.ts` (the latter is
  replaced by `packages/email/src/EmailSender.test.ts` from this session).
- Update 3 importer paths in `apps/api/`: `auth.ts`,
  `__tests__/auth-locale-and-enqueue.test.ts`,
  `__tests__/auth-send-verification-email.test.ts` — change
  `from "./email.js"` / `from "../email.js"` to `from "@openwhispr/email"`.
- The `EmailSender` public surface is **stable** as of this session; Session 5
  importers should use the named exports from `@openwhispr/email`:
  `createEmailSender`, `EmailSender`, `Logger`, `SendArgs`, `SendResult`,
  `CreateEmailSenderOpts`.

---

## 7. First action for Session 3

```bash
git status --short  # MUST match §1 exactly — if not, halt with Rule 4
```

Then begin Task 13-01-05 (health probe). Read:

1. `apps/api/src/routes/health.ts` (current handler)
2. `packages/contract-tests/src/schemas.ts` (locate `HealthResponse` zod schema —
   confirm it is NOT `.strict()` before extending)
3. `apps/api/src/db.ts` (or wherever the existing pool factory lives — reuse
   the pool, not a one-shot Client)
4. `packages/data/src/migrate.ts` line 173–174 confirms the migrations table is
   `_meta.__drizzle_migrations`

Then author/modify in this order (RED -> GREEN per strict TDD):

1. `apps/api/src/routes/health.test.ts` (NEW — Fastify `inject` tests for the
   two `migrations_completed` branches; assert via mocked pool).
2. `apps/api/src/routes/health.ts` (add `checkMigrationsCompleted(pool)` helper +
   include the field in the response object).
3. `packages/contract-tests/src/schemas.ts` (extend `HealthResponse` zod schema with
   `migrations_completed: z.boolean()` — verify the schema is open, not strict, first).
4. Find + update any contract conformance fixtures asserting `HealthResponse`:
   `grep -rln "HealthResponse\|/api/health" packages/contract-tests/`.

After health is green, proceed to Task 13-01-06 (weak-assertion sweep across the
**15 sites in 7 files** — see Session-1 handoff §3g for the full table).

End Session 3 with `13-01-SESSION-3-HANDOFF.md` and another `git status --short`
snapshot.
