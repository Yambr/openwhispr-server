---
phase: 33-envelope-encrypt-credentials
plan: 05
status: closed
closed: 2026-05-16
requirements_closed:
  - CRIT-FIX-02
  - LOCKER-PLAINTEXT-COLS
duration_min: ~40
commits:
  - sha: 99c00d8
    title: "test(33-05): red — LOCKER-PLAINTEXT-COLS lint test (LOCKER-08)"
  - sha: f7fea28
    title: "feat(33-05): atomic closure — drop plaintext + LOCKER-PLAINTEXT-COLS + Rule 15 + docs/security §12 + e2e"
key_files_created:
  - packages/data/migrations/0020_envelope_encrypt_secret_columns_drop_plaintext.sql
  - packages/data/migrations/0020_envelope_encrypt_secret_columns_drop_plaintext.down.sql
  - packages/data/migrations/__tests__/0020-drop-plaintext.test.ts
  - tools/lint-no-plaintext-secret-columns.ts
  - tools/__tests__/lint-no-plaintext-secret-columns.test.ts
  - tests/e2e/encryption-at-rest.test.ts
key_files_modified:
  - packages/data/migrations/meta/_journal.json
  - packages/data/src/schema/_helpers.ts
  - packages/data/src/schema/accounts.ts
  - packages/data/src/schema/sessions.ts
  - packages/data/src/schema/verifications.ts
  - packages/data/src/schema/oauth_state.ts
  - packages/data/tests/unit/__tests__/0003_better_auth_tenant_defaults.test.ts
  - packages/data/tests/unit/__tests__/0001_better_auth.test.ts
  - packages/data/tests/unit/__tests__/backfill.test.ts
  - packages/data/tests/unit/__tests__/rls-property.test.ts
  - tests/integration/session-token-plain-roundtrip.test.ts
  - apps/api/src/routes/desktop-signin.ts
  - apps/api/src/routes/auth-callback.ts
  - apps/api/src/lib/token-rotation.ts
  - apps/api/tests/unit/lib/token-rotation.test.ts
  - .planning/DISCIPLINE.md
  - CLAUDE.md
  - docs/security.md
  - package.json
  - .github/workflows/nightly.yml
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
---

# Phase 33 / Plan 33-05 — Atomic closure: 0020 drop-plaintext + LOCKER-PLAINTEXT-COLS + Rule 15 + docs + e2e

**Requirements closed:** CRIT-FIX-02 (final closure of envelope-encryption rollout) + LOCKER-PLAINTEXT-COLS (DISCIPLINE Rule 15 introduction).

**One-liner.** Single atomic GREEN commit (`f7fea28`) per LOCKER-07 precedent — drops the 8 plaintext credential columns via migration 0020, flips Drizzle schemas to bytea-only sidecars, introduces `tools/lint-no-plaintext-secret-columns.ts` (LOCKER-PLAINTEXT-COLS / LOCKER-08 — BLOCKING from day one, no `--warn-only`, no allowlist), wires DISCIPLINE Rule 15 + CLAUDE.md mirror + lefthook + Makefile + ci.yml + nightly.yml, ships `docs/security.md` §12 (encryption scope + `MASTER_KEK` setup + KEK rotation runbook + AWS/GCP/Azure/Vault KMS recipes + rollback rescue), deletes the 5 Phase-32-Category-A obsolete tests in `0003_better_auth_tenant_defaults.test.ts`, and adds `tests/e2e/encryption-at-rest.test.ts`. RED test (`99c00d8`) preceded the atomic GREEN per DISCIPLINE Rule 1.

## Per-task outcomes

### Task 1 + 2 — LOCKER test + binary

- `tools/__tests__/lint-no-plaintext-secret-columns.test.ts` — 15 cases (10 `scanFile` AST tests + 5 `runMain` CLI shape tests). RED commit `99c00d8`.
- `tools/lint-no-plaintext-secret-columns.ts` — TypeScript Compiler API AST scan mirroring `lint-tenant-context.ts` and `lint-secret-shape-in-error.ts`. Walks `packages/data/src/schema/**/*.ts`; emits a `Violation` for every CallExpression of shape `<fn>("<col>", ...)` where `fn ∈ {text, varchar, char}` and `<col>` is in the 8-credential set. BLOCKING from day one — no `--warn-only` handling, no allowlist file.
- **Coverage:** 100 / 92.85 / 100 / 100 (stmt / branch / func / line) per `pnpm test:lint-no-plaintext-secret-columns` — exceeds DISCIPLINE Rule 2 90/90/90/90 floor.

### Task 3 + 4 — migration 0020 + down migration + test

- `0020_envelope_encrypt_secret_columns_drop_plaintext.sql` — drops 8 plaintext credential columns + 2 plaintext-era indexes (`sessions_token_unique`, `sessions_previous_token_idx`), promotes `sessions_token_fp_unique` to full UNIQUE (was partial-unique from 0019), flips `sessions.token_fp` to NOT NULL.
- `0020_envelope_encrypt_secret_columns_drop_plaintext.down.sql` — rescue rollback (NOT journaled). Restores plaintext-column shape but cannot recover plaintext data (it has been dropped from disk; reverse-backfill required — documented in `docs/security.md` §12.4).
- `meta/_journal.json` — entry idx 21 appended.
- `__tests__/0020-drop-plaintext.test.ts` — 13 cases under real Postgres testcontainer: 8 plaintext-columns-gone (1 per credential), 2 plaintext-indexes-gone, 1 `sessions_token_fp_unique` no-WHERE assertion, 2 NOT-NULL / nullable assertions on token_fp / previous_token_fp, 1 "48 bytea sidecars survive" count check, 2 down-migration assertions (DDL grep + apply + restored-shape verification).

### Task 5 — Drizzle schema flips

- `_helpers.ts` — added `bytea` `customType<{ data: Uint8Array; driverData: Buffer }>` for the 4 schema files to import.
- `accounts.ts` — removed 4 plaintext columns (`access_token`, `refresh_token`, `id_token`, `password`); added 24 bytea sidecars (4 × 6).
- `sessions.ts` — removed plaintext `token` + `previous_token`; added 12 bytea sidecars + `token_fp: bytea("token_fp").notNull()` + `previous_token_fp: bytea("previous_token_fp")`; replaced `tokenUnique` (on plaintext token) → `tokenFpUnique` (full UNIQUE on token_fp); replaced `previousTokenIdx` → `previousTokenFpIdx`.
- `verifications.ts` — removed plaintext `value`; added 6 bytea sidecars.
- `oauth_state.ts` — removed plaintext `code_verifier`; added 6 bytea sidecars.
- **Locker run at this point:** `pnpm lint:no-plaintext-secret-columns` exits 0 against the real schema. Closure invariant satisfied.

### Task 6 — DISCIPLINE Rule 15 + CLAUDE.md mirror + integration wiring

- `.planning/DISCIPLINE.md` Rule 15 appended after Rule 14 — full prose with the 8-credential regex, the 6-sidecar shape, the boot-validator gate, the BLOCKING-from-day-one constitutional clause.
- `CLAUDE.md` § "Engineering discipline (constitutional, NON-NEGOTIABLE)" sub-bullet 15 added (mirror).
- `package.json` — `lint:no-plaintext-secret-columns` + `test:lint-no-plaintext-secret-columns` scripts added; `lint:lockers` aggregate `&&`-chain extended to include the new locker.
- `.github/workflows/nightly.yml` — `lockers-nightly` job extended with `tsx tools/lint-no-plaintext-secret-columns.ts` invocation (BLOCKING — no `--warn-only` flag).
- `lefthook.yml` + `Makefile` + CI `lint-english` job — no change needed: all three already invoke `pnpm lint:lockers` aggregate which now includes the new locker.

### Task 7 — docs/security.md §12 + e2e

- `docs/security.md` §12 — 6 subsections totalling ~150 lines: encryption scope (table of 8 columns + 4 tables + the 48 bytea sidecars + 2 fingerprints), `MASTER_KEK` setup (env semantics, docker-compose + Helm fragments), KEK rotation runbook (4 steps via overlap window), rollback rescue procedure, KMS provisioning recipes (AWS KMS `generate-data-key`, GCP KMS `decrypt`, Azure Key Vault `az keyvault secret show`, HashiCorp Vault `vault kv get`), defence-in-depth note pointing at LOCKER-PLAINTEXT-COLS.
- `tests/e2e/encryption-at-rest.test.ts` — `describe.skipIf(process.env.E2E !== "1")` shape per `lockers.test.ts` precedent. Two `LOCKER fixture subprocess` cases (exit-1 on bad fixture, exit-0 on clean fixture via `execFileSync` against the locker binary against a synthetic `mkdtempSync` fixture root) + one pointer case naming the apps/api integration suite (Phase 33-04 §D-05) where compose-stack-based ciphertext-on-disk assertions live. **3/3 GREEN locally with E2E=1.**

### Task 8 — delete obsolete Phase-32-deferred tests

- `0003_better_auth_tenant_defaults.test.ts` rewritten: the 5 cases (1 rolconfig + 4 INSERT-default-tenant assertions) replaced with 3 introspection-based "Phase 32 + 33 net effect" cases that assert (a) `openwhispr_app` rolconfig has NO `app.tenant_id` binding (Phase 32), (b) Better Auth tables have NO column DEFAULT on `tenant_id` (Phase 32), (c) the 8 plaintext credential columns are gone (Phase 33).
- **Rule 1 cascade** — three additional tests flipped to the new bytea / fp shape (not in Task 8's listed set but blocked the GREEN commit; see Deviations below): `0001_better_auth.test.ts`, `rls-property.test.ts`, plus `backfill.test.ts` and `session-token-plain-roundtrip.test.ts` skipped with rationale.

### Task 9 — REQUIREMENTS / ROADMAP / SUMMARY closure

- `.planning/REQUIREMENTS.md` — CRIT-FIX-02 traceability row + checkbox flipped Pending → Closed; new LOCKER-PLAINTEXT-COLS row added Complete.
- `.planning/ROADMAP.md` — Phase 33 line `[ ] → [x]` with full closure context (Plans 33-01..05 narrative).

## Verification

```bash
$ pnpm test:lint-no-plaintext-secret-columns
# Test Files  1 passed (1)
# Tests       15 passed (15)
# Coverage: 100 / 92.85 / 100 / 100 (stmt/branch/func/line)
```

```bash
$ pnpm lint:no-plaintext-secret-columns
# lint-no-plaintext-secret-columns PASSED: schema is clean (no plaintext credential columns)
```

```bash
$ pnpm lint:lockers
# All 7 lockers: 6 pre-existing (LOCKER-01..06) + LOCKER-PLAINTEXT-COLS — exit 0
```

```bash
$ E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/encryption-at-rest.test.ts
# Test Files  1 passed (1)
# Tests       3 passed (3)  — 2 LOCKER subprocess + 1 pointer
```

## Deviations from Plan

### [Rule 1 - Bug] Production routes wrote to dropped plaintext columns

**Found during:** schema-flip task — `apps/api/src/routes/desktop-signin.ts` (oauth_state INSERT), `apps/api/src/routes/auth-callback.ts` (oauth_state SELECT/RETURNING), `apps/api/src/lib/token-rotation.ts:recordPreviousToken` (sessions UPDATE) all referenced the plaintext `code_verifier` / `previous_token` columns that migration 0020 drops. Post-0020 these routes would raise `42703 column does not exist`.

**Fix:** dropped the plaintext column from the SQL fragments + the SELECT/RETURNING column lists. `recordPreviousToken` no longer writes plaintext `previous_token` (only the SHA-256 fingerprint `previous_token_fp`); the AUTH-04 5-minute overlap CONTRACT is preserved as a behaviour guarantee, with fingerprint-only storage.

**Files modified:** `apps/api/src/routes/desktop-signin.ts`, `apps/api/src/routes/auth-callback.ts`, `apps/api/src/lib/token-rotation.ts`.

**Commit:** included in the atomic GREEN closure commit `f7fea28`.

### [Rule 1 - Bug] Test files asserted dropped plaintext shape

**Found during:** schema-flip + production-route migration. Three additional test files referenced the now-dropped artifacts (`sessions.token` / `sessions.previous_token` / `account.password` / `verification.value` / `oauth_state.code_verifier` / `sessions_previous_token_idx`).

**Fix:** per CLAUDE.md Hard Rule 1 ("legitimate production removal forces test migration, not the inverse"):

- `0001_better_auth.test.ts` — `it.each` column list flipped from `["token", "previous_token", ...]` → `["token_fp", "previous_token_fp", ...]`; partial-index assertion flipped to `sessions_previous_token_fp_idx`.
- `rls-property.test.ts` — sessions INSERT swapped from `(tenant_id, user_id, token, expires_at)` → `(tenant_id, user_id, token_fp, expires_at)` with `createHash("sha256").update(bearer).digest()` (NOT NULL constraint satisfied).
- `apps/api/tests/unit/lib/token-rotation.test.ts:recordPreviousToken` test rewritten to assert fp-only UPDATE shape, with `expect(update?.sql).not.toMatch(/SET previous_token =/)` as the inverse-regression guard.
- `backfill.test.ts` (Phase 33-03 integration) wrapped in `describe.skip(... "obsolete post-0020")` — the test seeds plaintext data which 0020 drops; the production backfill unit retains its TypeScript unit coverage at `packages/data/src/encryption/__tests__/backfill.test.ts`.
- `session-token-plain-roundtrip.test.ts` wrapped in `describe.skip` for the same reason.

**Files modified:** see above.

**Commit:** included in `f7fea28`.

### [Rule 3 - Blocking] `c8 ignore` block comment caused TypeScript parse failure

**Found during:** initial coverage run.

**Issue:** I authored the rationale comment as `/* c8 ignore start — ... mirroring the /* c8 ignore */ bands ... */` — the inner `/* */` closed the outer comment prematurely, leaving `bands ... ` as code-outside-comment.

**Fix:** converted the rationale to `//` line-comments (`c8-ignore-band-rationale:` style) and kept only the pragma `/* c8 ignore start */` as a bare block.

**Files modified:** `tools/lint-no-plaintext-secret-columns.ts`.

**Commit:** included in `f7fea28`.

## Atomic-invariant verification (LOCKER-07 precedent)

The atomic GREEN commit `f7fea28` ships ALL of:
- migration 0020 + .down.sql + journal entry
- 0020 migration test
- 4 Drizzle schema flips + bytea customType helper
- tools/lint-no-plaintext-secret-columns.ts (locker source)
- DISCIPLINE.md Rule 15 + CLAUDE.md mirror
- package.json + nightly.yml wiring (lefthook + Makefile + ci.yml unchanged — already invoke `pnpm lint:lockers` aggregate)
- docs/security.md §12
- tests/e2e/encryption-at-rest.test.ts
- 5 obsolete Phase-32-deferred test cases replaced
- 4 additional cascade-affected tests migrated
- REQUIREMENTS.md + ROADMAP.md closure

The RED commit `99c00d8` ships the locker test in advance per DISCIPLINE Rule 1 — equivalent to LOCKER-07's two-commit cadence. Verifier-acceptable per Phase 31 Plan 31-07 §D-2 precedent.

## Self-Check

- `99c00d8` exists on HEAD: **FOUND** (`git log --oneline | grep 99c00d8`).
- `f7fea28` exists on HEAD: **FOUND**.
- `packages/data/migrations/0020_envelope_encrypt_secret_columns_drop_plaintext.sql`: **FOUND**.
- `tools/lint-no-plaintext-secret-columns.ts`: **FOUND**.
- `pnpm lint:no-plaintext-secret-columns` against repo root: exits 0 — **VERIFIED**.
- `pnpm lint:lockers`: exits 0 — **VERIFIED**.
- `pnpm test:lint-no-plaintext-secret-columns` coverage 100/92.85/100/100: **VERIFIED**.
- `E2E=1 vitest run tests/e2e/encryption-at-rest.test.ts`: 3/3 GREEN — **VERIFIED**.
- `.planning/DISCIPLINE.md` Rule 15 prose present: **VERIFIED** (`grep -n "Rule 15\|LOCKER-PLAINTEXT-COLS" .planning/DISCIPLINE.md`).
- `CLAUDE.md` Rule 15 mirror present: **VERIFIED** (`grep -n "15\\. \\*\\*No plaintext" CLAUDE.md`).
- `docs/security.md` §12 present: **VERIFIED** (`grep -n "^## 12. Encryption at rest" docs/security.md`).
- `.planning/REQUIREMENTS.md` CRIT-FIX-02 + LOCKER-PLAINTEXT-COLS rows complete: **VERIFIED**.
- `.planning/ROADMAP.md` Phase 33 row `[x]`: **VERIFIED**.

## Self-Check: PASSED
