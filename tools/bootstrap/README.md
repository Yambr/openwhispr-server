# tools/bootstrap

Operator-side secret generator and refuse-to-start gate for the OpenWhispr
server. Implements one half of the two-layer defense documented in
`.planning/phases/01-core-infra-multi-tenant-data/01-CONTEXT.md` (D-06..D-12).
The other half lives at `apps/api/scripts/check-default-secrets.ts` and runs
inside the API container at startup.

## Purpose

`bootstrap.sh` is the single command an operator runs after cloning the repo.
It walks `.env.example`, detects every key whose current value in `.env` is
either missing or still equal to the `.env.example` placeholder, and replaces
those (and only those) with strong random secrets generated via
`openssl rand -base64 32`. Operator-set values are never overwritten.

Before writing anything, bootstrap loads the deny-list at
`tools/bootstrap/default-secrets.txt` and aborts non-zero with the offending
KEY name on stderr if any current value in `.env` matches a deny-list entry.
Phase 1 success criterion #1: "the runtime aborts on any known-default value
like `changeme` or `sk-1234`."

## Generated keys

Bootstrap reads the canonical key list from `.env.example`, not from a
hardcoded list. Adding a new row to `.env.example` automatically extends the
generator. The keys generated as of Phase 1 are:

- `POSTGRES_OWNER_PASSWORD`
- `POSTGRES_APP_PASSWORD`
- `PGBOUNCER_ADMIN_PASSWORD`
- `VALKEY_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `TRAEFIK_ADMIN_PASSWORD`
- `GRAFANA_ADMIN_PASSWORD`
- `MASTER_KEK`
- `BACKUP_AGE_IDENTITY`
- `BETTER_AUTH_SECRET`

## Deny-list semantics

- One value per line in `tools/bootstrap/default-secrets.txt`.
- Comments start with `#` and blank lines are ignored.
- Match is **case-sensitive exact byte match**. `changeme` blocks; `Changeme`
  does not. Rationale (per `01-RESEARCH-TOOLING.md` Pitfall 2): the threat
  model is "operator forgot to change the placeholder", not "operator chose
  a slightly mutated bad password". Mutated bad passwords are out of scope
  and unsolvable in general.
- Both `bootstrap.sh` and `apps/api/scripts/check-default-secrets.ts` read the
  same file. Operators extend the deny-list by appending lines; no code edit
  required.

## Idempotency rule

A key's current value in `.env` is regenerated **only if** the value is empty
or exactly equals the placeholder in `.env.example` for the same key. Any
other value (including operator-set production values that differ from the
placeholder) is preserved across re-runs. This is the rule that lets bootstrap
run safely as part of Makefile `setup` or Dockerfile `RUN` chains without
rotating live secrets.

## macOS bash 3.2 caveat

`bootstrap.sh` uses associative arrays (`declare -A`), which require **bash
4 or newer**. macOS ships bash 3.2 by default for licensing reasons. The
script guards on `BASH_VERSINFO[0] < 4` and aborts with exit code 2 plus the
exact upgrade hint:

```text
bootstrap: bash >= 4 required (current: <version>).
  macOS: brew install bash && hash -r
```

After `brew install bash` the new bash lives at `/opt/homebrew/bin/bash`
(Apple Silicon) or `/usr/local/bin/bash` (Intel). The shebang
`#!/usr/bin/env bash` picks it up automatically once the Homebrew prefix is
on `PATH`.

## `BACKUP_AGE_IDENTITY` vs `MASTER_KEK`

These are deliberately separate keys. `MASTER_KEK` is the column-DEK envelope
master used by application code at runtime; `BACKUP_AGE_IDENTITY` is the
X25519 identity used to encrypt offsite backups via the `age` CLI. Keeping
them separate means a compromised backup-restore role does not unlock
runtime data and vice versa, and lets each be rotated on its own schedule.

If the `age` CLI is installed, `bootstrap.sh` calls `age-keygen` to produce
a real X25519 identity (recommended). If not, it falls back to
`openssl rand -base64 32` and emits a stderr warning that the operator must
later install `age` and regenerate the identity for backup/restore to work.
The corresponding public recipient (`keys/backup.age.pub`) is produced by
the Phase 1 backup plan (`01-06`), not by bootstrap.

## Self-test

`tests/self-tests/refuse-default-secrets.test.ts` exercises bootstrap
against temporary directories (never the real repo `.env` — see
`01-RESEARCH-TOOLING.md` Pitfall 7) and asserts the deny-list, idempotency,
and bash-version-guard rules. The script honors a `BOOTSTRAP_REPO_ROOT`
environment variable to support that test pattern.
