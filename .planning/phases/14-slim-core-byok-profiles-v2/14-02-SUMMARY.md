---
phase: 14-slim-core-byok-profiles-v2
plan: 02
subsystem: operator-env-templates
tags: [env-slim, byok-matrix, bootstrap, operations-docs]
requires: [tools/bootstrap.sh existing three-way value semantics, packages/email/createEmailSender loud-fail precedent]
provides:
  - .env.slim.example  (slim-core operator quickstart template, 10 active keys + 6 commented overlay sections)
  - .env.full.example  (renamed-from .env.example reference template, content preserved verbatim)
  - tools/bootstrap.sh BOOTSTRAP_ENV_TEMPLATE override + --print-template dry-run flag
  - docs/operations.md ## BYOK Environment Matrix section
affects:
  - tests/self-tests/refuse-default-secrets.test.ts (BOOTSTRAP_ENV_TEMPLATE override threaded into the helper)
  - tests/unit/bootstrap-cert-gen.test.ts (same)
  - tests/unit/bootstrap-interpolate.test.ts (same)
  - .gitignore (whitelist .env.slim.example and .env.full.example)
tech-stack:
  added: []
  patterns:
    - dotenv KEY=VALUE template with commented overlay appendix (NocoBase precedent)
    - bash env-overridable template path with existence guard + clear error
    - markdown reference table mapping overlay -> BYOK env -> loud-fail code -> compose file -> Helm toggle
key-files:
  created:
    - .env.slim.example
    - tools/bootstrap.test.sh
    - tests/integration/env-slim-example.test.ts
    - tests/integration/docs-operations-byok-matrix.test.ts
  modified:
    - tools/bootstrap.sh
    - docs/operations.md
    - tests/self-tests/refuse-default-secrets.test.ts
    - tests/unit/bootstrap-cert-gen.test.ts
    - tests/unit/bootstrap-interpolate.test.ts
    - .gitignore
    - .planning/deferred-items.md
  renamed:
    - .env.example -> .env.full.example
decisions:
  - "Slim contract is 10 uncommented keys: 5 user-visible + 4 bootstrap-invisible + 1 OTel disable sentinel; 3 derived URLs interpolate via ${VAR}."
  - "Overlay appendix in the same file (Option B from RESEARCH); 6 commented sections each opening with `# REQUIRES: compose/docker-compose.<overlay>.yml`."
  - "BOOTSTRAP_ENV_TEMPLATE override has NO silent fallback when the path is missing — exits 2 with `template not found: <path>` on stderr."
  - "--print-template short-circuits AFTER the existence guard but BEFORE any .env write or cert minting (dry-run safe for tooling)."
  - "Three pre-existing bootstrap tests received BOOTSTRAP_ENV_TEMPLATE overrides so their `.env.example` fixtures continue to work (Rule 3 unblock; no behavior change to the tests themselves)."
metrics:
  duration_minutes: ~30
  completed: 2026-05-14
  tasks_completed: 3
  files_created: 4
  files_modified: 7
  files_renamed: 1
  commits: 6
---

# Phase 14 Plan 02: Slim Env Template + BYOK Matrix Summary

Authored the slim-core operator env template (`.env.slim.example`), renamed
the legacy 90-key monolithic template to `.env.full.example`, made
`tools/bootstrap.sh` env-overridable, and shipped the canonical BYOK
Environment Matrix section in `docs/operations.md`. Closes SLIM-03 (slim
env template) and SLIM-04 (BYOK matrix doc); pre-req for Plan 14-07's
Gherkin scenarios.

## Commits

| # | Hash | Type | Title |
|---|---|---|---|
| 1 | `248caf3` | test | test(14-02): red bootstrap env-overridable template |
| 2 | `d6f922d` | feat | feat(14-02): bootstrap.sh BOOTSTRAP_ENV_TEMPLATE override |
| 3 | `b6ead30` | test | test(14-02): red .env.slim.example conformance |
| 4 | `2b7742b` | feat | feat(14-02): .env.slim.example + rename .env.example |
| 5 | `fe33826` | test | test(14-02): red operations.md byok matrix |
| 6 | `c45fdda` | docs | docs(14-02): byok environment matrix in operations.md |

Strict TDD per task (RED commit precedes GREEN commit in every case).

## Slim contract — the 10 uncommented keys

| # | Key | Value | Role |
|---|---|---|---|
| 1 | `POSTGRES_APP_PASSWORD`        | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | user-visible |
| 2 | `BETTER_AUTH_SECRET`           | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | user-visible |
| 3 | `LITELLM_MASTER_KEY`           | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | user-visible |
| 4 | `BETTER_AUTH_URL`              | `http://localhost:3000`              | user-visible |
| 5 | `OPENROUTER_API_KEY`           | `` (empty)                           | user-visible |
| 6 | `POSTGRES_OWNER_PASSWORD`      | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | bootstrap-invisible |
| 7 | `VALKEY_PASSWORD`              | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | bootstrap-invisible |
| 8 | `MASTER_KEK`                   | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | bootstrap-invisible |
| 9 | `BACKUP_AGE_IDENTITY`          | `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` | bootstrap-invisible |
| 10 | `OTEL_EXPORTER_OTLP_ENDPOINT` | `disabled`                           | OTel sentinel (CONTEXT decision 5) |

Plus 3 derived URLs (interpolated from the keys above, operators do not edit):

- `DATABASE_URL=postgres://openwhispr_app:${POSTGRES_APP_PASSWORD}@postgres:5432/openwhispr`
- `VALKEY_URL=redis://:${VALKEY_PASSWORD}@valkey:6379/0`
- `LITELLM_BASE_URL=http://litellm:4000`

## Commented overlay appendix — 6 banner sections

Each section opens with a `# REQUIRES: compose/docker-compose.<overlay>.yml`
banner. Operators uncomment the BYOK envs AND add `-f compose/<file>.yml`
to opt in.

| Banner | BYOK envs (commented) |
|---|---|
| `# REQUIRES: compose/docker-compose.storage.yml`          | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` |
| `# REQUIRES: compose/docker-compose.observability.yml`    | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` |
| `# REQUIRES: compose/docker-compose.ingress.yml`          | `INGRESS_BASE_URL`, `ACME_EMAIL`, `TRAEFIK_ADMIN_PASSWORD` |
| `# REQUIRES: compose/docker-compose.pgbouncer.yml`        | `PGBOUNCER_ADMIN_PASSWORD` |
| `# REQUIRES: compose/docker-compose.dev-tools.yml`        | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| `# REQUIRES: compose/docker-compose.contract-test.yml`    | (none — self-contained) |

## bootstrap.sh edit (Task 1)

Replaced the hard-coded template path with an env-overridable resolution and added a dry-run flag:

```bash
readonly ENV_EXAMPLE="${BOOTSTRAP_ENV_TEMPLATE:-${REPO_ROOT}/.env.slim.example}"

PRINT_TEMPLATE_ONLY=0
if (( $# > 0 )) && [[ "$1" == "--print-template" ]]; then
  PRINT_TEMPLATE_ONLY=1
fi

if [[ ! -f "${ENV_EXAMPLE}" ]]; then
  printf 'bootstrap: template not found: %s\n' "${ENV_EXAMPLE}" >&2
  if [[ -n "${BOOTSTRAP_ENV_TEMPLATE:-}" ]]; then
    printf '  (BOOTSTRAP_ENV_TEMPLATE override; unset it to use the slim default)\n' >&2
  fi
  exit 2
fi

if (( PRINT_TEMPLATE_ONLY )); then
  printf '%s\n' "${ENV_EXAMPLE}"
  exit 0
fi
```

No silent fallback. Operators with a missing template see exactly which
path bootstrap looked at and (when an override is active) a hint to clear it.

## BYOK Environment Matrix — the canonical table in docs/operations.md

| Overlay | BYOK env(s) when OFF | Loud-fail code | Compose overlay file | Helm toggle |
|---|---|---|---|---|
| storage | `S3_ENDPOINT` (plus `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` when `S3_ENDPOINT` is set) | `BYOK_STORAGE_REQUIRED` | `compose/docker-compose.storage.yml` | `storage.enabled` |
| observability | `OTEL_EXPORTER_OTLP_ENDPOINT` (sentinel value `disabled` is the explicit opt-out — anything else is treated as a real endpoint URL) | `BYOK_OBSERVABILITY_REQUIRED` | `compose/docker-compose.observability.yml` | `observability.enabled` |
| ingress | `INGRESS_BASE_URL` | `BYOK_INGRESS_REQUIRED` | `compose/docker-compose.ingress.yml` | `tls.enabled` |
| pgbouncer | `DATABASE_URL` (already required for every profile; the row exists for documentation symmetry, not a new gate) | `BYOK_DATABASE_REQUIRED` | `compose/docker-compose.pgbouncer.yml` | `pooler.enabled` |
| dev-tools | `SMTP_HOST` (`NODE_ENV=production` only — matches the `createEmailSender` precedent in `packages/email/src/EmailSender.ts`) | `BYOK_SMTP_REQUIRED` | `compose/docker-compose.dev-tools.yml` | `mailpit.enabled` |

The matrix is preceded by a paragraph naming `apps/api/src/lib/byok-guard.ts`
as the implementing module (Test 6 of the conformance vitest) and followed
by a "Reading the loud-fail record" subsection with a sample Pino JSON
envelope. An "Upgrade path from `.env.example`" subsection documents the
`cp .env.slim.example .env.new && diff` migration recipe and the
`BOOTSTRAP_ENV_TEMPLATE` override for operators staying on the 90-key
template.

## Verification — all GREEN

| Check | Result |
|---|---|
| `bash tools/bootstrap.test.sh` | 5/5 GREEN (3 plan behaviors expanded to 5 sub-assertions) |
| `pnpm vitest run tests/integration/env-slim-example.test.ts` | 10/10 GREEN (9 plan behaviors + 1 well-formedness sweep) |
| `pnpm vitest run tests/integration/docs-operations-byok-matrix.test.ts` | 6/6 GREEN |
| `ls .env.full.example` | exists |
| `ls .env.example` | absent (renamed) |
| `BOOTSTRAP_ENV_TEMPLATE=/tmp/nonexistent bash tools/bootstrap.sh --print-template` | exit 2 + `template not found: /tmp/nonexistent` on stderr |
| Pre-existing bootstrap unit + cert-gen tests | 21/21 GREEN after BOOTSTRAP_ENV_TEMPLATE thread-through |

Aggregate: 42 assertions across 3 new test files + bootstrap.test.sh, all green; 21 pre-existing assertions in bootstrap-* tests preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] BOOTSTRAP_ENV_TEMPLATE thread-through into three pre-existing tests**

- **Found during:** Task 1 GREEN (after `tools/bootstrap.sh` started defaulting to `.env.slim.example`)
- **Issue:** `tests/self-tests/refuse-default-secrets.test.ts`, `tests/unit/bootstrap-cert-gen.test.ts`, and `tests/unit/bootstrap-interpolate.test.ts` each write a `.env.example` fixture into a `mkdtempSync` scratch root and call bootstrap with `BOOTSTRAP_REPO_ROOT=<scratch>`. After Task 1 changed the default template to `.env.slim.example`, bootstrap could no longer find the fixture (those tests do not write a slim template).
- **Fix:** Added `BOOTSTRAP_ENV_TEMPLATE: join(root, ".env.example")` to each `execFileSync` `env` block so the existing fixtures continue to exercise the bootstrap surface unchanged. No behavior change to the tests themselves; the override just preserves their existing template path semantics.
- **Files modified:** the three test files above.
- **Commit:** `d6f922d`.

**2. [Rule 3 - Blocking] `.gitignore` whitelist for the two new env templates**

- **Found during:** Task 1 GREEN staging.
- **Issue:** `.gitignore` rule `.env.*` would have ignored the new `.env.slim.example` and `.env.full.example` (rename target).
- **Fix:** Added `!.env.slim.example` and `!.env.full.example` to the existing whitelist that already covered `.env.example`, `.env.e2e.example`, `.env.embedded.example`.
- **Commit:** `d6f922d`.

### Deferred Items

**3. Pre-existing failure in `refuse-default-secrets.test.ts > generates valid .env on placeholders`**

- **Found during:** Task 1 GREEN verification sweep.
- **Why deferred:** Failure exists on `main` HEAD before any Plan 14-02 changes — confirmed by `git stash && pnpm vitest run` reproducing the identical assertion failure. The test fixture seeds `.env.example` with non-canonical placeholders (e.g. `POSTGRES_OWNER_PASSWORD=PLACEHOLDER_OWNER`) that bootstrap's Phase 02.2 three-way value semantics treat as "real default config values" and preserve verbatim. Falls outside the executor scope boundary (Plan 14-02 only touches the template path resolution and the new env+doc surface).
- **Logged to:** `.planning/deferred-items.md` § "From Plan 14-02 (Phase 14)".

## Parallel-safety with Plan 14-01

Plan 14-01 ran in parallel on `main` and touches `docker-compose.yml` plus
`tests/integration/slim-core-base.test.ts`. Plan 14-02 touches
`.env.slim.example`, `.env.full.example` (rename of `.env.example`),
`tools/bootstrap.sh`, `tools/bootstrap.test.sh`, `docs/operations.md`,
`tests/integration/env-slim-example.test.ts`,
`tests/integration/docs-operations-byok-matrix.test.ts`, and 3 pre-existing
bootstrap test files. **No file overlap.** Confirmed via `git status` at
plan start; never re-staged `docker-compose.yml`.

## Self-Check

Verifying file/commit claims:

- `.env.slim.example` exists — yes (8962 bytes).
- `.env.full.example` exists — yes (22383 bytes, content preserved verbatim from `.env.example`).
- `.env.example` does NOT exist — confirmed.
- `tools/bootstrap.test.sh` exists — yes (executable).
- `tests/integration/env-slim-example.test.ts` exists — yes.
- `tests/integration/docs-operations-byok-matrix.test.ts` exists — yes.
- 6 plan commits exist on `main` — confirmed (`248caf3`, `d6f922d`, `b6ead30`, `2b7742b`, `fe33826`, `c45fdda`).
- All 3 new test files GREEN — confirmed in verification table.
- Pre-existing bootstrap unit tests GREEN — confirmed (21/21).

## Self-Check: PASSED
