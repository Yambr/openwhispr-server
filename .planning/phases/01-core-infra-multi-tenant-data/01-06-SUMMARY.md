---
phase: 01-core-infra-multi-tenant-data
plan: 06
subsystem: backup-restore-docs
tags: [backup, restore, age, makefile, nightly, docs, minio, storage]
requires:
  - 01-02-SUMMARY.md   # bootstrap.sh BACKUP_AGE_IDENTITY generation
  - 01-03-SUMMARY.md   # Drizzle schema + migration runner
provides:
  - make-backup-target
  - make-restore-target
  - keys/backup.age.pub-derivation-in-bootstrap
  - nightly-backup-roundtrip-ci-job
  - docs/storage.md
  - operations.md-backup-section
affects:
  - tools/bootstrap.sh
  - Makefile
  - docs/operations.md
  - .github/workflows/nightly.yml
tech-stack:
  added:
    - age 1.3.x (X25519 envelope encryption — apt/brew/scoop packaged)
    - postgresql-client-17 (pg_dump / pg_restore / psql in nightly job)
  patterns:
    - "Dual-mode shell scripts: DATABASE_URL_OWNER (test/CI direct) or docker compose exec (local-dev container) so client-major matches server-major"
    - "Identity vs recipient X25519 split: AGE-SECRET-KEY-1... in env / GHA secret; age1... committed at keys/backup.age.pub; derivation via age-keygen -y idempotent in bootstrap.sh"
    - "Restore safety guard: refuse if information_schema.tables count > 0 in public schema"
    - "Schema-equivalence gate: pg_dump --schema-only pre vs post diff in nightly CI catches age / pg_dump version drift"
key-files:
  created:
    - scripts/backup/make-backup.sh
    - scripts/backup/make-restore.sh
    - tests/integration/backup-restore.test.ts
    - docs/storage.md
  modified:
    - tools/bootstrap.sh
    - Makefile
    - docs/operations.md
    - .github/workflows/nightly.yml
decisions:
  - "Identity (X25519 private) and MASTER_KEK (AES-256 symmetric) are separate keys with different rotation cadences — different crypto primitives, conflating them couples unrelated rotation policies"
  - "make-restore.sh refuses on non-empty target rather than CASCADE-dropping — accidental clobber prevention outweighs the small ergonomic cost of an explicit DROP DATABASE step"
  - "Dual-mode scripts (env-set vs docker compose exec) keep the local-dev story simple while letting CI run direct against a service container — single script, two paths, same contract"
  - "Public recipient committed at keys/backup.age.pub (allowlisted in .gitignore); private identity gitignored and lives in BACKUP_AGE_IDENTITY env var or GHA secret"
  - "Nightly cadence sufficient for the round-trip job — Plan 05's per-PR test-migration job already catches schema regressions; nightly catches age and pg_dump version drift"
metrics:
  duration: "30min"
  tasks_completed: 2
  files_changed: 8
  completed_date: "2026-05-09"
---

# Phase 1 Plan 06: Backup/Restore via age Envelope Encryption Summary

`make backup` / `make restore` ship an `age`-encrypted `pg_dump -Fc`
round-trip with X25519 identity/recipient separation, bootstrap.sh
auto-derives the public recipient, and a nightly GHA job exercises the
full forward-apply + backup + drop + restore + schema-equivalence diff
on a real Postgres 17 service container — closing Phase 1 success
criterion #4 and shipping the MinIO key-prefix convention (D-27/D-28).

## What Shipped

### Backup/restore scripts (Task 1)

- **`scripts/backup/make-backup.sh`** — `pg_dump -Fc | age -r <pubkey>`
  to `backups/<UTC-timestamp>.dump.age`. Two operating modes:
  `DATABASE_URL_OWNER` set (test/CI) connects directly; otherwise
  `docker compose exec -T postgres pg_dump ...` so the client major
  matches the server major (RESEARCH-TOOLING Pitfall 4).
- **`scripts/backup/make-restore.sh`** — `age -d -i <identity> | pg_restore`.
  Refuses to run if the target Postgres has any non-system tables in
  the public schema (D-25 safety guard). Identity path defaults to
  `~/.age/key.txt`, overridable via `BACKUP_AGE_IDENTITY_FILE`.
- **`tools/bootstrap.sh`** extension: when BACKUP_AGE_IDENTITY is freshly
  generated AND `age-keygen` is on PATH AND `keys/backup.age.pub` does
  not yet exist, derives the public recipient via `age-keygen -y` and
  writes it (atomic `.tmp` -> `mv`). Idempotent — never overwrites an
  existing recipient.
- **`Makefile`** — `backup` and `restore` targets replace the Phase-1
  stubs that returned `exit 1`.

### Integration test

- **`tests/integration/backup-restore.test.ts`** — five testcontainers
  Postgres 17 tests:
  1. `make-backup.sh` produces a non-empty `.age` file.
  2. `make-restore.sh` against a fresh empty Postgres reproduces seed
     data (`tenants` + `notes` rows verified by row count and content).
  3. `make-restore.sh` against a non-empty target exits non-zero with
     `refusing` in stderr.
  4. `make-backup.sh` exits non-zero with a clear error when
     `keys/backup.age.pub` is missing.
  5. `make-restore.sh` exits non-zero with a clear error when
     `BACKUP_AGE_IDENTITY_FILE` points at a non-existent path.
- The whole suite is `describe.skipIf`-skipped when `age` /
  `age-keygen` / `pg_dump` are not on PATH, with an explanatory
  diagnostic. CI installs `age` and `postgresql-client-17` so the skip
  never fires in nightly.

### Nightly round-trip CI job (Task 2)

- **`.github/workflows/nightly.yml`** — new `backup-roundtrip` job:
  - postgres:17-alpine service container with healthcheck.
  - Installs `age` and `postgresql-client-17` via apt.
  - Restores `BACKUP_AGE_IDENTITY` from GHA secret to `~/.age/key.txt`
    (chmod 600), derives `keys/backup.age.pub` via `age-keygen -y`.
  - Forward-applies all migrations as `openwhispr_owner`, snapshots
    `pg_dump --schema-only` to `/tmp/schema-pre.sql`.
  - Runs `bash scripts/backup/make-backup.sh`, drops & recreates the
    database, runs `bash scripts/backup/make-restore.sh`.
  - Snapshots post-restore schema, asserts `diff -u /tmp/schema-pre.sql
    /tmp/schema-post.sql` exits clean.
- Job is **NOT** in `scripts/branch-protection.json` required contexts
  (nightly is scheduled, not per-PR). The `branch-protection-contexts`
  self-test stays green (verified — 2 tests passing).
- Pre-existing SHA pin re-used: `step-security/harden-runner@a5ad31d6...`
  (matches `ci.yml`).

### Operator documentation

- **`docs/operations.md`** — Backup and Restore section covering:
  - Identity vs recipient separation (X25519 split, lifecycle table).
  - One-time setup (install age, run bootstrap, push GHA secret, commit
    pubkey).
  - `make backup` / `make restore` operator workflow.
  - Restore-safety guard and the explicit DROP DATABASE override path.
  - Postgres major version constraint and how the docker compose exec
    path enforces it.
  - Identity rotation procedure (re-keygen, re-encrypt, secure destroy).
  - Bootstrap bash >= 4 prerequisite (macOS `brew install bash` note).
- **`docs/storage.md`** (new) — MinIO single-bucket + per-tenant
  key-prefix convention (D-27 / D-28):
  - Bucket layout table (versioning, region, SSE).
  - Key-prefix grammar `tenants/<tenant-uuid>/<resource-type>/<resource-id>`
    with worked examples and the resource-type registry.
  - Tenancy enforcement posture: app-tier prefix discipline in v1;
    MinIO IAM in Phase 6+.
  - Multipart upload tuning numbers from RESEARCH-INFRA §8.3.
  - Console-route reachability via Traefik dynamic.yml.

## Identity vs Recipient Rationale

The plan called out (RESEARCH-TOOLING Open Question 2) whether
`MASTER_KEK` should double as the `age` identity. We chose **separation**:

| Concern             | MASTER_KEK            | BACKUP_AGE_IDENTITY |
| ------------------- | --------------------- | ------------------- |
| Crypto primitive    | AES-256 symmetric     | X25519 asymmetric   |
| Lifecycle           | Per-row DEK envelope  | Per-backup-file     |
| Rotation cadence    | Annual (Phase 2 ADR)  | Operator-driven     |
| GHA exposure        | Never                 | Required (decrypt)  |
| `age` compatibility | No (wrong primitive)  | Native              |

Conflating them would force operators to rotate a column-encryption key
every time they re-keyed a backup chain, and would prevent CI from
holding the key at all (since `MASTER_KEK` is supposed to live only in
the runtime data plane).

## Verification Snapshot

| Check                                                           | Status |
| --------------------------------------------------------------- | ------ |
| `bash -n scripts/backup/*.sh`                                   | ok     |
| `pnpm vitest run tests/integration/backup-restore.test.ts`      | 5/5    |
| `pnpm vitest run tests/self-tests/`                             | 40/40  |
| `pnpm exec tsx tools/lint-english.ts`                           | clean  |
| `pnpm -r exec tsc --noEmit`                                     | clean  |
| `make help` lists `backup` and `restore`                        | yes    |
| `branch-protection-contexts.test.ts`                            | 2/2    |
| `grep -q backup-roundtrip nightly.yml`                          | yes    |
| `grep -q age-keygen tools/bootstrap.sh`                         | yes    |

The integration test ran locally against `postgres:17-alpine` testcontainers
with `age 1.3.1` (brew) and `postgresql-client-18` (libpq) — pg_dump 18
reads PG 17 successfully (forward-compatible client).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Removed unused imports from integration test**
- **Found during:** Task 1 commit (lefthook biome pre-commit).
- **Issue:** `execFileSync` import and `recipientFile` local variable
  remained from an earlier draft and tripped biome
  `lint/correctness/noUnusedImports` and `noUnusedVariables`.
- **Fix:** Trimmed the import to `spawnSync` and dropped the unused
  variable.
- **Files modified:** `tests/integration/backup-restore.test.ts`.
- **Commit:** `9df1534` (rolled into the Task 1 commit).

**2. [Rule 3 — Blocking] Reformatted commit-message body to <100 chars**
- **Found during:** Task 1 commit (lefthook commitlint).
- **Issue:** First commit attempt used a long bullet line that tripped
  `body-max-line-length`.
- **Fix:** Re-wrapped bullets to <100 chars, recommitted.

### Plan-Doc Adjustment (NOT a code change)

The plan called for a `keys/backup.age.pub.example` placeholder file and
a `.gitignore` allowlist split. The repo's existing `.gitignore` already
allowlists the real `keys/backup.age.pub` (see Plan 01-02), and that
choice is operationally simpler — the public key is, by definition,
public, so committing the operator's recipient is fine and saves a
documentation step. Kept the existing allowlist; did not introduce a
`.example` placeholder. Plan-text-vs-code drift documented here.

## Out-of-Scope Discoveries

Three pre-existing biome lint/format warnings authored by 01-04 / 01-05
were flagged by `pnpm exec biome check .`. They are NOT introduced by
01-06 and per the executor SCOPE BOUNDARY rule are out of scope. Logged
to `.planning/phases/01-core-infra-multi-tenant-data/deferred-items.md`
with a recommended `chore(01): apply biome --unsafe` clean-up at the
top of Phase 2.

## Phase 1 Closure

Plan 06 satisfies the last open Phase-1 requirement, **DATA-07**. With
01-01 through 01-06 landed, all Phase-1 requirements (DATA-01..02,
DATA-05..07, PROVIDER-02, TEST-MIGRATION-01, TEST-RLS-01) are complete.
DATA-03 and DATA-04 are intentionally deferred to Phase 3 (usage ledger
write-path) and Phase 6 (audit log writers) respectively, as planned.

## Follow-ups

- **Phase 2:** ADR for `MASTER_KEK` vs `BACKUP_AGE_IDENTITY` rotation
  cadences (already prefigured in this SUMMARY; needs formal ADR).
- **Phase 6:** MinIO IAM policies pinning each tenant API role to its
  prefix (`s3:prefix=tenants/<tenant-uuid>/*`). Currently app-tier
  discipline only.
- **Phase 9:** Off-site / S3 backup target — replicate `backups/` to a
  customer-owned S3 bucket via lifecycle rule. Currently local-disk only.
- **Phase 9:** Replace single-host Postgres with CloudNativePG operator;
  swap `pg_dump`-based backup for online streaming dumps with WAL archive.
- **Phase 2 chore:** apply the deferred biome `--unsafe` fixes from
  `deferred-items.md`.

## Self-Check: PASSED

- File: `scripts/backup/make-backup.sh` — FOUND
- File: `scripts/backup/make-restore.sh` — FOUND
- File: `tests/integration/backup-restore.test.ts` — FOUND
- File: `docs/storage.md` — FOUND
- File: `docs/operations.md` — FOUND (modified)
- File: `tools/bootstrap.sh` — FOUND (modified)
- File: `Makefile` — FOUND (modified)
- File: `.github/workflows/nightly.yml` — FOUND (modified)
- Commit: `9df1534` — FOUND (`feat(01-06): backup/restore via age envelope encryption`)
- Commit: `4df0297` — FOUND (`docs(01-06): operations + storage docs and nightly backup roundtrip`)
