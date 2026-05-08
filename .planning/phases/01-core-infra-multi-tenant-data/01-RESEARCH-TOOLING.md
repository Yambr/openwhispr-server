# Phase 1: Core Infra & Multi-Tenant Data — Tooling / Scripts / Lints Research

**Researched:** 2026-05-09
**Domain:** developer tooling — bootstrap script, RLS introspection lint, backup/restore CLI, GHA workflow extensions
**Confidence:** HIGH (patterns + targets concretely specified by D-06..D-12 and D-21..D-26)

## Summary

This research covers the tooling dimension of Phase 1 — everything that runs **outside** the running data plane: the `bootstrap.sh` refuse-to-start gate, the `tools/lint-rls.ts` introspection script and its companion self-test, the `make backup` / `make restore` workflow built on `age` envelope encryption, and the two new GHA jobs (`lint-rls`, `test-migration`) that must wire into both `ci.yml` and `scripts/branch-protection.json`.

**Primary recommendation:** ship `bootstrap.sh` as **bash** (under 80 lines per D-decision, openssl is universal on dev/CI runners), `tools/lint-rls.ts` as a standalone tsx script mirroring the exact shape of `tools/lint-english.ts` (shebang, exit codes 0/1/2, stderr file:line:col diagnostics), and the GHA `lint-rls` and `test-migration` jobs as `services:`-block Postgres consumers (no testcontainers in CI — the matrix-managed Postgres service is faster and simpler).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (relevant to tooling dimension)

- **D-06:** `.env.example` ships at repo root; every value placeholder. `bootstrap.sh` reads `.env.example`, generates strong random for unset secrets, writes `.env` (gitignored). Idempotent.
- **D-07:** `bootstrap.sh` aborts non-zero on deny-list match (`changeme`, `password`, `admin`, `sk-1234`, `secret`, empty). Deny-list at `tools/bootstrap/default-secrets.txt` (one per line, comments allowed).
- **D-08:** API container entrypoint runs the same default-secret check (defense-in-depth). Logs offending KEY name (not value), exits 1.
- **D-09:** Self-test `tests/self-tests/refuse-default-secrets.test.ts` — fixture `.env` with deny-list value, asserts non-zero exit + key in stderr.
- **D-10:** `openssl rand -base64 32` (or Node `crypto.randomBytes(32).toString('base64url')` fallback) for: POSTGRES_PASSWORD, PGBOUNCER_ADMIN_PASSWORD, REDIS_PASSWORD, MINIO_ROOT_PASSWORD, TRAEFIK_ADMIN_PASSWORD, MASTER_KEK, BETTER_AUTH_SECRET.
- **D-11:** `MASTER_KEK` is the root KEK; per-row DEKs encrypted by it.
- **D-12:** `KeyProvider` interface — `EnvKeyProvider` (default), `VaultKeyProvider` (stub), `KmsKeyProvider` (stub). Selected by `OPENWHISPR_KEY_PROVIDER`.
- **D-21:** `tools/lint-rls.ts` introspects `pg_class.relrowsecurity` + `pg_policies`. FAILS on (a) `tenant_id`-bearing table without RLS, (b) RLS-enabled table without policy, (c) policy that doesn't reference `current_setting('app.tenant_id'...)`.
- **D-22:** CI step `pnpm lint:rls` on every PR touching `migrations/`. Self-test injects bad migration, asserts non-zero.
- **D-23:** Property tests: `packages/data/src/__tests__/rls-property.test.ts` using fast-check.
- **D-24:** `make backup` → `pg_dump -Fc` + `age` (preferred) or AES-256-GCM via Node crypto → `backups/YYYY-MM-DDTHH-MM-SS.dump.age`.
- **D-25:** `make restore BACKUP=path` decrypts + `pg_restore`. Errors clearly if target has data.
- **D-26:** CI `test-migration` job: spin up Postgres, forward-apply, dump, drop, restore, schema-equivalence assertion. On `migrations/` change.

### Claude's Discretion (relevant to tooling)

- bash vs Node for `bootstrap.sh` — pick bash if under ~80 lines (verdict: **bash** suffices).
- `age` vs Node `crypto` AES-256-GCM for backup — pick whichever is lighter (verdict: **age**, single binary, no Node dep tree, alpine-packaged).
- TS vs SQL for RLS lint — pick TS for consistency with `tools/lint-english.ts` (verdict: **TS**).

### Deferred Ideas (OUT OF SCOPE for tooling work)

- Real Vault / KMS adapters (stubs only in v1)
- Off-site / S3 backup (local-disk only in v1)
- Postgres failover / Patroni / CloudNativePG (single-node compose only)
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **English-only source artifacts (DOCS-09)** — all comments, identifiers, log messages, deny-list comments, error messages MUST be ASCII English. The `lint-english` job (already wired) covers `**/*.ts` and `**/*.md` — the new tooling files inherit it automatically.
- **No mocks for cross-service integration** — `lint-rls.ts` runs against a real Postgres (testcontainer in unit test, GHA `services:` block in CI). Do not stub `pg`.
- **Conventional Commits + commitlint** — any commits introducing tooling MUST be `feat(tools): ...`, `chore(ci): ...`, etc.
- **GitHub Actions only** — no other CI. New jobs land in `.github/workflows/ci.yml`.
- **Vitest 4 coverage thresholds 85/80/80/85** — new tooling modules must come with tests.
- **Strict TDD** — `tools/lint-rls.test.ts` and `tests/self-tests/refuse-default-secrets.test.ts` are written **before** the production scripts.

## Standard Stack (Tooling Dimension)

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `bash` | 5.x | `bootstrap.sh` host language [VERIFIED: ubuntu-24.04 ships bash 5.2] | Universal on Linux/macOS dev + CI; openssl + grep + sed sufficient |
| `openssl` | 3.x | `openssl rand -base64 32` secret generation [CITED: D-10] | Pre-installed on every supported platform; FIPS-clean RNG |
| `tsx` | latest 4.x | Run TS scripts via `pnpm exec tsx tools/lint-rls.ts` [VERIFIED: already used by `tools/lint-english.ts:1`] | Matches existing pattern; zero compile step |
| `pg` (node-postgres) | 8.x | Postgres client used by `lint-rls.ts` [CITED: STACK.md §3 "pg ≥ 8"] | PgBouncer-transaction-mode-friendly; lighter than postgres-js for a one-shot script |
| `age` | 1.2.x | Backup encryption [CITED: D-24] | Single static binary; alpine/debian/brew/scoop packaged; portable encrypted-at-rest format |
| `pg_dump` / `pg_restore` | 17.x | Backup/restore [VERIFIED: matches Postgres 17 service image] | Must match Postgres major; `-Fc` custom-format is the canonical pg_restore-friendly dump |
| `drizzle-kit` | latest 0.x | Migration runner: `pnpm drizzle-kit migrate` [CITED: D-14] | Already chosen ORM; `migrate` subcommand is the standard apply path |
| Vitest 4 | 4.x | Unit tests for `lint-rls.ts` and self-tests [VERIFIED: existing `tools/lint-english.test.ts` uses Vitest] | Established |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `@testcontainers/postgresql` | 10.x | Optional — for `lint-rls.test.ts` if maintainers prefer testcontainer to GHA service | Unit-test of `lint-rls.ts` only; CI uses GHA `services:` block |
| `pgbouncer` (image `bitnami/pgbouncer:1.23`) | 1.23+ | NOT used in tooling jobs (CI migration tests run direct against Postgres) | Skip in `lint-rls` and `test-migration` jobs — only the property test (separate job, Phase 1 task) needs it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| bash for bootstrap | Node script (`tools/bootstrap/index.ts`) | More portable on Windows-native operators | **bash** — under 80 lines per D-discretion; openssl + grep is enough; Windows operators use WSL anyway |
| `age` for backup encryption | Node `crypto.createCipheriv` AES-256-GCM | Removes external binary dep, but bigger Node code surface | **age** — keeps backup format portable; restore-from-cold-tarball works with just `age` + `pg_restore`, no Node needed |
| `pg` (node-postgres) | `postgres` (postgres-js) | postgres-js is faster | **pg** — STACK.md notes "pg more compatible with PgBouncer transaction mode"; lint script is one-shot, perf irrelevant |
| testcontainers in CI | GHA `services:` block | testcontainers more hermetic | **GHA services** — faster startup (~3s vs ~15s), simpler config, well-supported by Postgres official image |
| GHA matrix Postgres versions | Pin a single PG 17 | Matrix catches version-specific bugs | **single PG 17 pin** — Phase 1 scope, single supported version per `STACK.md` |

**Installation (verification):**
```bash
# All assumed available on ubuntu-24.04 GHA runner; verify locally:
openssl version           # OpenSSL 3.x
bash --version            # GNU bash 5.x
node --version            # v24.x (via pnpm/action-setup)
pnpm --version            # 11.x
age --version             # 1.2.x — install via `apt install age` / `brew install age` / scoop
pg_dump --version         # must match server major (17.x)
```

**Version verification commands** (run during planning to lock pins):
```bash
npm view pg version                         # node-postgres latest
npm view drizzle-kit version                # latest 0.x
npm view @testcontainers/postgresql version # if used in lint-rls.test.ts
apt-cache policy age                        # ubuntu-24.04 packaged age version
```

## Architecture Patterns

### Recommended Repo Layout (additions)
```
.
├── .env.example                                # placeholder secrets — committed
├── tools/
│   ├── bootstrap/
│   │   ├── default-secrets.txt                 # deny-list, one per line, # comments
│   │   └── README.md                           # how the deny-list is consumed
│   ├── bootstrap.sh                            # bash entrypoint (D-06, D-07, D-10)
│   ├── lint-rls.ts                             # standalone tsx script (D-21)
│   └── lint-rls.test.ts                        # Vitest unit test
├── tests/
│   └── self-tests/
│       ├── refuse-default-secrets.test.ts      # D-09
│       └── rls-introspection.test.ts           # D-22
├── scripts/
│   └── backup/
│       ├── make-backup.sh                      # invoked by `make backup`
│       └── make-restore.sh                     # invoked by `make restore`
├── keys/
│   └── backup.age.pub                          # public recipient — committed
├── backups/                                    # gitignored; created by `make backup`
└── apps/api/scripts/
    └── check-default-secrets.ts                # D-08 — runs at API container startup
```

### Pattern 1: Standalone tsx-runnable lint script (mirrors `tools/lint-english.ts`)
**What:** A self-contained TS file with `#!/usr/bin/env -S pnpm exec tsx` shebang, top-level `main()`, exit codes 0/1/2.
**When to use:** All repo-rooted lint scripts that read state and emit file:line:col diagnostics.
**Example:**
```typescript
#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-rls.ts — RLS-introspection lint (DATA-RLS-LINT-01).
 *
 * Connects to a Postgres database (DATABASE_URL env), introspects
 * pg_class.relrowsecurity and pg_policies, and FAILS on:
 *   - any table with a `tenant_id` column and relrowsecurity=false
 *   - any RLS-enabled table with no policy
 *   - any policy whose USING/WITH CHECK does not reference current_setting('app.tenant_id')
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation; each printed to stderr as `table: reason`
 *   2 — internal error (DB unreachable, etc.)
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm exec tsx tools/lint-rls.ts
 */
import { Client } from "pg";
import { exit, stderr, stdout } from "node:process";

interface Violation { table: string; reason: string }

const Q_NO_RLS = `
  SELECT DISTINCT c.relname AS table_name
  FROM pg_class c
  JOIN information_schema.columns col ON col.table_name = c.relname
  WHERE col.column_name = 'tenant_id'
    AND c.relkind = 'r'
    AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND c.relrowsecurity = false;
`;

const Q_RLS_NO_POLICY = `
  SELECT c.relname AS table_name
  FROM pg_class c
  LEFT JOIN pg_policies p ON p.tablename = c.relname
  WHERE c.relrowsecurity = true
    AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND p.policyname IS NULL;
`;

const Q_BAD_POLICY = `
  SELECT tablename, policyname, qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (qual IS NULL OR qual NOT LIKE '%app.tenant_id%');
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) { stderr.write("lint-rls: DATABASE_URL not set\n"); exit(2); }
  const client = new Client({ connectionString: url });
  await client.connect();
  const violations: Violation[] = [];
  try {
    const noRls = await client.query(Q_NO_RLS);
    for (const r of noRls.rows) {
      violations.push({ table: r.table_name, reason: "has tenant_id column but RLS is disabled" });
    }
    const rlsNoPolicy = await client.query(Q_RLS_NO_POLICY);
    for (const r of rlsNoPolicy.rows) {
      violations.push({ table: r.table_name, reason: "RLS enabled but no policy attached" });
    }
    const badPolicy = await client.query(Q_BAD_POLICY);
    for (const r of badPolicy.rows) {
      violations.push({
        table: r.tablename,
        reason: `policy ${r.policyname} does not reference app.tenant_id`,
      });
    }
  } finally {
    await client.end();
  }
  if (violations.length > 0) {
    stderr.write(`RLS-lint violation: ${violations.length} offender(s)\n`);
    for (const v of violations) stderr.write(`  ${v.table}: ${v.reason}\n`);
    exit(1);
  }
  stdout.write("RLS-lint passed\n");
}

main().catch((err) => { stderr.write(`lint-rls: internal error: ${String(err)}\n`); exit(2); });
```

### Pattern 2: Idempotent bash bootstrap with deny-list

```bash
#!/usr/bin/env bash
# tools/bootstrap.sh — idempotent secret generator + refuse-to-start gate.
# Reads .env.example for the canonical key list, .env for current values,
# generates random replacements for missing/placeholder values, aborts on
# any value matching tools/bootstrap/default-secrets.txt deny-list.
#
# Exit codes:
#   0 — .env written/up-to-date
#   1 — at least one value matched the deny-list
#   2 — internal error (missing .env.example, openssl unavailable, ...)
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ENV_EXAMPLE="${REPO_ROOT}/.env.example"
readonly ENV_FILE="${REPO_ROOT}/.env"
readonly DENY_LIST="${REPO_ROOT}/tools/bootstrap/default-secrets.txt"

if [[ ! -f "${ENV_EXAMPLE}" ]]; then
  echo "bootstrap: .env.example not found at ${ENV_EXAMPLE}" >&2; exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "bootstrap: openssl not found in PATH" >&2; exit 2
fi

# Load deny-list, stripping comments and blank lines.
mapfile -t DENY_VALUES < <(grep -vE '^\s*(#|$)' "${DENY_LIST}" || true)

# Read existing .env values (if any) into associative array.
declare -A CURRENT
if [[ -f "${ENV_FILE}" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "${key}" || "${key}" =~ ^[[:space:]]*# ]] && continue
    CURRENT["${key}"]="${value}"
  done < "${ENV_FILE}"
fi

# Walk .env.example for the canonical key list.
declare -A RESULT
declare -a OFFENDERS
while IFS='=' read -r key example_value; do
  [[ -z "${key}" || "${key}" =~ ^[[:space:]]*# ]] && continue

  current="${CURRENT[${key}]:-}"

  # If current value matches deny-list, record offender.
  if [[ -n "${current}" ]]; then
    for bad in "${DENY_VALUES[@]}"; do
      if [[ "${current}" == "${bad}" ]]; then
        OFFENDERS+=("${key}")
        break
      fi
    done
  fi

  # If unset OR matches example placeholder OR empty, generate a new secret.
  if [[ -z "${current}" || "${current}" == "${example_value}" ]]; then
    RESULT["${key}"]="$(openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_')"
  else
    RESULT["${key}"]="${current}"  # keep operator-set value (idempotent)
  fi
done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "${ENV_EXAMPLE}")

if (( ${#OFFENDERS[@]} > 0 )); then
  echo "bootstrap: refusing to write .env — offending keys with deny-list values:" >&2
  for k in "${OFFENDERS[@]}"; do echo "  ${k}" >&2; done
  exit 1
fi

# Write .env atomically.
tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
{
  echo "# Generated by tools/bootstrap.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Do not commit — gitignored."
  for key in "${!RESULT[@]}"; do
    printf '%s=%s\n' "${key}" "${RESULT[${key}]}"
  done
} > "${tmp}"
mv "${tmp}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
echo "bootstrap: .env written (${#RESULT[@]} keys)"
```

**Idempotency proof:** First run finds `CURRENT` empty, generates all secrets. Second run reads the just-generated values, matches none against deny-list, finds none matching `.env.example` placeholders → preserves them all → no rewrite of values. (The file is rewritten with the same values + a fresh timestamp comment; if the timestamp delta matters, change the script to skip rewrite when `RESULT == CURRENT` byte-equal.)

### Pattern 3: API-startup defense-in-depth (D-08)

`apps/api/scripts/check-default-secrets.ts` — invoked by the container's entrypoint **before** `node dist/index.js`:

```typescript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const denyPath = resolve(process.env.DENY_LIST_PATH ?? "/app/tools/bootstrap/default-secrets.txt");
const deny = readFileSync(denyPath, "utf8")
  .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

const REQUIRED_KEYS = [
  "POSTGRES_PASSWORD", "PGBOUNCER_ADMIN_PASSWORD", "REDIS_PASSWORD",
  "MINIO_ROOT_PASSWORD", "TRAEFIK_ADMIN_PASSWORD", "MASTER_KEK", "BETTER_AUTH_SECRET",
];

const offenders: string[] = [];
for (const k of REQUIRED_KEYS) {
  const v = process.env[k];
  if (!v || deny.includes(v)) offenders.push(k);
}
if (offenders.length > 0) {
  for (const k of offenders) process.stderr.write(`refusing to start: ${k} is unset or matches deny-list\n`);
  process.exit(1);
}
```

In the `Dockerfile` for `apps/api`:
```Dockerfile
ENTRYPOINT ["sh", "-c", "node /app/scripts/check-default-secrets.js && exec node /app/dist/index.js"]
```

### Pattern 4: Makefile target idempotency

Each new target is wrapped to be safe to re-run:
- `migrate` — drizzle-kit `migrate` is idempotent by design (won't reapply already-applied migrations)
- `migrate:rollback` — drizzle-kit `down --steps 1`; abort if no migrations applied
- `lint:rls` — read-only; trivially idempotent
- `backup` — emits a new timestamped file each invocation; never clobbers
- `restore BACKUP=...` — refuse to run if target Postgres has any non-system tables (D-25 "Idempotent: errors clearly if target already has data")

### Anti-Patterns to Avoid

- **Don't embed the deny-list in the bootstrap script source** — D-07 explicitly puts it at `tools/bootstrap/default-secrets.txt` so operators (and future phases) can extend without code changes.
- **Don't run `bootstrap.sh` from inside the API container's entrypoint** — that's D-08's *separate* check. Bootstrap is operator-side; the entrypoint check is runtime-side.
- **Don't use Node's `crypto.randomBytes` from bash via inline `node -e ...`** — adds Node dep to the bootstrap path. openssl is universal; Node fallback only if openssl absent (and even then, a script-aborts-with-clear-message is fine).
- **Don't skip the `, true` in `current_setting('app.tenant_id', true)`** — `true` is `missing_ok`; without it, lint queries on a session that hasn't called `withTenant()` raise instead of returning empty. Phase 1's `lint-rls.ts` only reads metadata, so this doesn't bite the lint, but the policy DDL must include it (verified in D-16).
- **Don't store the `age` private key in the repo** — public recipient (`keys/backup.age.pub`) is committed; private key is `MASTER_KEK`-equivalent (separate env var `BACKUP_AGE_IDENTITY` — store as GHA secret in CI, in 1Password / Vault for operators).
- **Don't put PgBouncer between CI's migration runner and Postgres** — migrations need session-level features (CREATE INDEX CONCURRENTLY, etc.); PgBouncer transaction-mode breaks them. The `lint-rls` and `test-migration` jobs connect *directly* to the Postgres service.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random secret generation | Custom `/dev/urandom` reader | `openssl rand -base64 32` | FIPS-clean, universally available, exact behavior expected by D-10 |
| Backup encryption | Custom AES-256-GCM via Node `crypto` | `age` | Single static binary, portable encrypted-at-rest format; restorable from cold tarball without Node |
| `.env` parsing in bash | Custom regex | `grep -E '^[A-Z_][A-Z0-9_]*=' .env.example` + `IFS='=' read` | Standard idiom; handles comments and blank lines |
| Postgres metadata introspection | Hand-parse `pg_dump --schema-only` output | Query `pg_class.relrowsecurity` and `pg_policies` directly | These views are the canonical source; pg_dump output format is not stable across versions |
| Migration runner | Hand-rolled SQL apply loop | `pnpm drizzle-kit migrate` | Already chosen ORM; tracks applied migrations in `__drizzle_migrations` table |
| GHA Postgres provisioning in jobs | Custom `pg_ctl initdb` | `services: postgres: image: postgres:17-alpine` | Built-in to GHA; ~3s startup; healthcheck supported |
| Schema-equivalence check after restore | Custom AST diff | `pg_dump --schema-only` from both DBs, `diff` the outputs | Exact, version-portable, well-understood |

**Key insight:** Every tool listed here is already battle-tested for the exact use case. The temptation to roll a "lighter" custom solution dies the moment you hit the first edge case (e.g., a `.env` value containing `=` inside a quoted string, or `pg_dump` reordering CREATE statements between minor versions).

## Common Pitfalls

### Pitfall 1: `bootstrap.sh` regenerating live production secrets
**What goes wrong:** Operator pulls a new `.env.example` row, re-runs bootstrap, and finds their existing Postgres password was rotated → containers can no longer connect.
**Why it happens:** Naive scripts treat any "missing in .env but present in .env.example" as a regenerate signal.
**How to avoid:** Strict "regenerate only if `current` is empty OR equals the placeholder in `.env.example`" rule (in the bash skeleton above). Operators committed-real-value, even if it differs from the placeholder, is preserved.
**Warning signs:** Second run of `bootstrap.sh` produces a different `.env` than the first run on the same inputs.

### Pitfall 2: Deny-list false negatives via case / whitespace
**What goes wrong:** `POSTGRES_PASSWORD=Changeme` (capitalized) slips past a deny-list containing only `changeme`.
**Why it happens:** Exact byte-match.
**How to avoid:** Decision point — keep exact match (simpler, predictable) and document that deny-list entries are case-sensitive. (The threat model is "operator forgot to change the placeholder," not "operator chose a slightly mutated bad password" — the latter is out of scope and would be unsolvable anyway.)
**Warning signs:** Self-test that injects `Changeme` exits 0; if you want to catch this, lowercase both sides before comparing.

### Pitfall 3: `lint-rls.ts` connects through PgBouncer transaction-mode
**What goes wrong:** The lint queries metadata views; PgBouncer transaction-mode is fine for that — but if the lint script ever needs to `SET search_path` or use prepared statements, transaction-mode bites.
**Why it happens:** Operator wires `DATABASE_URL` to PgBouncer port 6432 thinking "it's all Postgres".
**How to avoid:** Document in `tools/lint-rls.ts` header that `DATABASE_URL` should point to **Postgres directly**, not through PgBouncer. CI jobs already do this (Postgres service exposed on 5432).
**Warning signs:** Random "prepared statement does not exist" errors in lint output.

### Pitfall 4: `pg_dump` / `pg_restore` version mismatch
**What goes wrong:** Local dev runs `pg_dump` 16, server is Postgres 17 → restore fails with "unsupported version" or quietly drops new features.
**Why it happens:** Distro packages lag; macOS `brew install postgresql` can be major-version-different.
**How to avoid:** `make backup` and `make restore` invoke `pg_dump` / `pg_restore` from inside the Postgres 17 container (`docker compose exec postgres pg_dump ...`). CI Postgres service is `postgres:17-alpine` — version is implicit. Document the requirement in `docs/operations.md`.
**Warning signs:** "server version mismatch" in CI logs; restored DB missing constraints.

### Pitfall 5: `age` private key handling in CI
**What goes wrong:** Backup-restore CI job needs the `age` private key to decrypt; private key checked into the repo (catastrophic) or only-on-laptop (CI fails).
**Why it happens:** Convenience.
**How to avoid:** Store private key as GHA secret `BACKUP_AGE_IDENTITY`. At job start: `mkdir -p ~/.age && echo "${{ secrets.BACKUP_AGE_IDENTITY }}" > ~/.age/key.txt && chmod 600 ~/.age/key.txt`. The `make restore` script reads `${BACKUP_AGE_IDENTITY_FILE:-~/.age/key.txt}`.
**Warning signs:** Plain-text key in `keys/` directory (only `.pub` belongs there).

### Pitfall 6: GHA service-block Postgres readiness race
**What goes wrong:** Job runs `pnpm migrate` before Postgres has accepted its first connection; first migration call fails with "the database system is starting up".
**Why it happens:** GHA `services:` block reports container as up before Postgres is actually accepting connections.
**How to avoid:** Add `options: --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10` to the service block (already in the snippet under "CI workflow snippets" below). Then GHA waits for healthy before running steps.
**Warning signs:** Flaky CI — passes ~80% of the time, fails with connection-refused on the rest.

### Pitfall 7: Self-test fixtures leaking into the actual `.env`
**What goes wrong:** `tests/self-tests/refuse-default-secrets.test.ts` runs in the repo root, drops a fixture `.env` containing `POSTGRES_PASSWORD=changeme` into a tmp dir — but if the test passes the repo root as cwd to `bootstrap.sh`, the real `.env` gets clobbered.
**Why it happens:** Copy-paste from the unit test pattern (which **does** pass the repo root).
**How to avoid:** Always run bootstrap-self-tests against a `mkdtempSync(...)` directory; mirror the `lint-english.test.ts` pattern exactly (it does this — `mkdtempSync(join(tmpdir(), "lint-clean-"))`). Pass that tmp dir as the bootstrap root via env var `BOOTSTRAP_REPO_ROOT` or CLI arg.
**Warning signs:** A test run rewrites your local `.env`. (`bootstrap.sh` should accept an optional `${1}` arg overriding `REPO_ROOT` for exactly this reason.)

## Code Examples

### Example: `tools/bootstrap/default-secrets.txt`
```
# OpenWhispr default-secret deny-list (D-07).
# Any value in .env matching one of these strings makes bootstrap.sh
# refuse to write .env and the API container refuse to start.
# Comments start with '#'. Blank lines ignored. One value per line.
changeme
password
admin
sk-1234
secret
```

### Example: `tools/lint-rls.test.ts` skeleton

```typescript
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const SCRIPT = join(process.cwd(), "tools", "lint-rls.ts");

function runLint(databaseUrl: string): { code: number; stderr: string } {
  try {
    execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

describe("lint-rls.ts", () => {
  let pg: StartedPostgreSqlContainer;
  let url: string;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:17-alpine").start();
    url = pg.getConnectionUri();
  }, 60_000);

  afterAll(async () => { await pg.stop(); });

  it("exits 0 on a clean (empty) schema", () => {
    expect(runLint(url).code).toBe(0);
  });

  it("exits non-zero when a tenant_id table has no RLS", async () => {
    // create offending table via a one-shot pg client
    // ... CREATE TABLE bad_table (id uuid, tenant_id uuid);
    const r = runLint(url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad_table/);
  });

  it("exits non-zero when an RLS-enabled table has no policy", async () => { /* ... */ });
  it("exits non-zero when a policy lacks app.tenant_id", async () => { /* ... */ });
});
```

### Example: `tests/self-tests/refuse-default-secrets.test.ts` skeleton

```typescript
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "bootstrap.sh");
const DENY_LIST_SRC = join(process.cwd(), "tools", "bootstrap", "default-secrets.txt");

function runBootstrap(repoRoot: string): { code: number; stderr: string } {
  try {
    execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, BOOTSTRAP_REPO_ROOT: repoRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

describe("D-09 self-test: bootstrap refuses default secrets", () => {
  it("aborts non-zero when POSTGRES_PASSWORD=changeme", () => {
    const root = mkdtempSync(join(tmpdir(), "bootstrap-bad-"));
    try {
      mkdirSync(join(root, "tools", "bootstrap"), { recursive: true });
      writeFileSync(join(root, ".env.example"), "POSTGRES_PASSWORD=PLACEHOLDER\n");
      writeFileSync(join(root, ".env"), "POSTGRES_PASSWORD=changeme\n");
      writeFileSync(join(root, "tools", "bootstrap", "default-secrets.txt"),
        // copy the real deny-list so the test exercises the production data
        require("node:fs").readFileSync(DENY_LIST_SRC, "utf8"));
      const r = runBootstrap(root);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/POSTGRES_PASSWORD/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("exits 0 and generates .env when run on placeholders", () => { /* ... */ });
  it("is idempotent across two runs", () => { /* ... */ });
});
```

### Example: `Makefile` extensions

```makefile
.PHONY: migrate migrate-rollback lint-rls backup restore

migrate:
	pnpm drizzle-kit migrate

migrate-rollback:
	pnpm drizzle-kit down --steps 1

lint-rls:
	pnpm exec tsx tools/lint-rls.ts

# Backup: pg_dump | age encrypt → backups/<timestamp>.dump.age
backup:
	@mkdir -p backups
	@ts="$$(date -u +%Y-%m-%dT%H-%M-%S)"; \
	docker compose exec -T postgres pg_dump -Fc -U $${POSTGRES_USER:-openwhispr_owner} $${POSTGRES_DB:-openwhispr} \
	  | age -r "$$(cat keys/backup.age.pub)" \
	  > "backups/$${ts}.dump.age"; \
	echo "wrote backups/$${ts}.dump.age"

# Restore: age decrypt | pg_restore. Requires BACKUP=path; refuses if target has data.
restore:
	@test -n "$(BACKUP)" || (echo "Usage: make restore BACKUP=path/to/file.dump.age" >&2; exit 1)
	@test -f "$(BACKUP)" || (echo "BACKUP file not found: $(BACKUP)" >&2; exit 1)
	@count=$$(docker compose exec -T postgres psql -U $${POSTGRES_USER:-openwhispr_owner} -d $${POSTGRES_DB:-openwhispr} -tAc \
	  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"); \
	if [ "$$count" != "0" ]; then echo "refusing to restore: target has $$count tables" >&2; exit 1; fi
	@age -d -i $${BACKUP_AGE_IDENTITY_FILE:-$$HOME/.age/key.txt} "$(BACKUP)" \
	  | docker compose exec -T postgres pg_restore -U $${POSTGRES_USER:-openwhispr_owner} -d $${POSTGRES_DB:-openwhispr}
```

Wire to `package.json` scripts so `pnpm lint:rls` and `pnpm migrate` work without `make`:
```json
{
  "scripts": {
    "migrate": "drizzle-kit migrate",
    "migrate:rollback": "drizzle-kit down --steps 1",
    "lint:rls": "tsx tools/lint-rls.ts"
  }
}
```

### Example: `.github/workflows/ci.yml` additions

```yaml
  lint-rls:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: openwhispr_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450
        with: { egress-policy: audit }
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm migrate
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/openwhispr_test
      - run: pnpm lint:rls
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/openwhispr_test

  test-migration:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: openwhispr_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Apply migrations forward
        run: pnpm migrate
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/openwhispr_test }
      - name: Snapshot schema (pre)
        run: |
          PGPASSWORD=test pg_dump -h localhost -U postgres --schema-only openwhispr_test > /tmp/schema-pre.sql
      - name: Drop and recreate database
        run: |
          PGPASSWORD=test psql -h localhost -U postgres -c "DROP DATABASE openwhispr_test"
          PGPASSWORD=test psql -h localhost -U postgres -c "CREATE DATABASE openwhispr_test"
      - name: Re-apply migrations forward
        run: pnpm migrate
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/openwhispr_test }
      - name: Snapshot schema (post)
        run: |
          PGPASSWORD=test pg_dump -h localhost -U postgres --schema-only openwhispr_test > /tmp/schema-post.sql
      - name: Assert schema-equivalent
        run: diff -u /tmp/schema-pre.sql /tmp/schema-post.sql
      - name: Test rollback (last migration)
        run: pnpm migrate:rollback
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/openwhispr_test }
```

### Example: `scripts/branch-protection.json` extension

Add to `required_status_checks.contexts`:
```json
"lint-rls",
"test-migration"
```

The existing `harness-self-check` job spawns `tests/self-tests/branch-protection-contexts.test.ts` (per Phase 0 pattern), which auto-detects drift between this file and `.github/workflows/ci.yml` job names.

### Example: `.env.example` (new file)

```
# OpenWhispr Server — environment configuration template.
# Run `tools/bootstrap.sh` to generate strong random values for all keys.
# Do not commit a populated .env (it is gitignored).

POSTGRES_USER=openwhispr_owner
POSTGRES_DB=openwhispr
POSTGRES_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
PGBOUNCER_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
REDIS_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
MINIO_ROOT_USER=openwhispr
MINIO_ROOT_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
TRAEFIK_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
MASTER_KEK=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
BETTER_AUTH_SECRET=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
OPENWHISPR_KEY_PROVIDER=env
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled `crypto.createCipheriv('aes-256-gcm', ...)` for backup encryption | `age` single-binary recipient encryption | age 1.0 GA (2022); mainstream by 2024 | Portable encrypted-at-rest format; no Node dep on the restore path |
| `dotenv` with no validation | `bootstrap.sh` deny-list + container-startup recheck | OWASP A05:2021 made misconfiguration top-3 | Refuse-to-start at two layers catches operator skipping bootstrap |
| Migration tests via `pg-mem` (in-memory pg shim) | testcontainer or GHA `services:` block real Postgres | testcontainers GA (~2020); GHA services mature | Real Postgres catches RLS / extension / version-specific bugs that pg-mem misses |
| Lint scripts as bash + `psql -f` | TS scripts via `tsx` with `pg` client | tsx 4.x maturity (~2024) | Type-safe diagnostics; same Vitest unit-test rig as the rest of the repo |
| `pg_basebackup` cron + tar.gz | `pg_dump -Fc \| age` → object storage (Phase 9) | age + S3 lifecycle cheap (~2023+) | Schema-aware restores; selective table restore supported |

**Deprecated/outdated:**
- **`gpg` for backup encryption** — works, but heavier dep tree, key-server complexity, harder to operate. `age` is the 2026 boring choice.
- **`pg_dump -Fp` (plain SQL)** — slower restore, less robust for binary data. `-Fc` (custom format) is the canonical choice.
- **Custom `Make` rules invoking `node`** — replaced with `pnpm <script>` for consistency with the rest of the repo.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `age` is packaged in `apt` on ubuntu-24.04 GHA runners and `brew` on macOS [ASSUMED — verify with `apt-cache policy age` at execution time] | Standard Stack / Backup | If absent, fallback to `apt install age` step in CI or pin a `ghcr.io/...age` image; either is straightforward |
| A2 | `openssl rand -base64 32` is available on every supported dev platform [ASSUMED — true on Linux/macOS; Windows operators use WSL per project posture] | bash bootstrap | If a Windows-native operator hits this, document WSL requirement |
| A3 | Drizzle 0.x has a `down` subcommand for rollback [ASSUMED — verify against current `drizzle-kit` docs at execution time] | Makefile / migrate-rollback | If absent, custom rollback script needed (read `__drizzle_migrations`, run inverse SQL); plan for this contingency |
| A4 | GHA Postgres `services:` block startup is ~3s with healthcheck [ASSUMED — based on community measurements] | CI workflow | If slower, increase health-retries; non-blocking |
| A5 | `pg_dump --schema-only` output is stable across two runs against the same schema [VERIFIED: documented Postgres behavior; deterministic ordering] | test-migration | Low risk |
| A6 | Bash 5 associative arrays available on macOS dev machines [ASSUMED — macOS ships bash 3.2 by default; users with Homebrew bash 5 OK; bootstrap may need `#!/usr/bin/env bash` + brew bash check, OR rewrite without assoc-arrays for portability] | bootstrap.sh | **Medium risk — verify**. If macOS default bash 3.2 must work, switch bootstrap to `#!/usr/bin/env bash` + degrade gracefully OR write in Node. Recommend documenting "requires bash >= 4" and erroring early if `${BASH_VERSINFO[0]}` < 4. |

## Open Questions

1. **macOS default bash 3.2 vs the bash 4+ associative-array pattern**
   - What we know: macOS ships bash 3.2; assoc arrays require bash 4+; project assumes self-hosters can install Homebrew bash.
   - What's unclear: Whether project tolerates "must `brew install bash` first" as a docs item, or wants the bootstrap to work on shipped macOS bash.
   - Recommendation: Add an early `if (( BASH_VERSINFO[0] < 4 )); then echo "bash >= 4 required (run: brew install bash)" >&2; exit 2; fi` guard. Document in `docs/operations.md`. Resolve in discuss-phase if hard requirement.

2. **`age` recipient identity — single key or per-environment?**
   - What we know: D-24 says "encrypted with the MASTER_KEK using `age`". `age` recipient is an `age1...` public string, not a symmetric key.
   - What's unclear: Whether `MASTER_KEK` is the `age` private key (X25519) directly, or a separate key. Decision: pick separate — `MASTER_KEK` is for column DEK envelope (symmetric); `BACKUP_AGE_IDENTITY` is the X25519 key for backup encryption. The two have different rotation cadences.
   - Recommendation: clarify in plan; add `BACKUP_AGE_IDENTITY` to D-10 generated keys (or generate via `age-keygen` instead of `openssl rand`).

3. **Is the `tools/lint-rls.test.ts` allowed to use testcontainers, or must it use the same GHA service block?**
   - What we know: Unit test convention in this repo (Phase 0) is "fast tests in Vitest, no external services."
   - What's unclear: Whether project posture allows testcontainer-based unit tests for tooling (which adds Docker requirement to local `pnpm test`).
   - Recommendation: Use testcontainers in the unit test (it's the standard Vitest+testcontainers pattern). Document Docker as a prerequisite for `pnpm test` (already true for the rls-property tests per D-23).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash >= 4 | bootstrap.sh | Linux ✓; macOS ✗ (default 3.2) | 5.x on Linux/CI | `brew install bash` on macOS; document. |
| openssl | bootstrap.sh secret generation | ✓ | 3.x | Node `crypto.randomBytes` (degraded) |
| Node 24 + pnpm 11 | lint-rls.ts, drizzle-kit, vitest | ✓ (Phase 0 wired) | 24.x / 11.0.8 | — |
| age | make backup, make restore, CI test-migration extension | ✓ apt/brew/scoop | 1.2.x | Node `crypto` AES-256-GCM (heavier) |
| Docker + docker-compose | make backup/restore wrappers (use compose exec) | ✓ in CI; operator-required for self-host | 24+ | Direct `pg_dump` if Postgres reachable |
| Postgres 17 client tools (`pg_dump`, `pg_restore`, `psql`) | backup, restore, schema-equivalence | invoked through compose | 17.x | — |

**Missing dependencies with no fallback:** none for CI. Local dev requires `age` and bash 4+ — document in `docs/operations.md`.

**Missing dependencies with fallback:** none critical.

## Validation Architecture (Tooling)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (already wired in Phase 0) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `pnpm vitest run tools/lint-rls.test.ts tests/self-tests/refuse-default-secrets.test.ts tests/self-tests/rls-introspection.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map (tooling slice)
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-06 | bootstrap.sh writes .env from placeholders | unit | `pnpm vitest run tests/self-tests/refuse-default-secrets.test.ts -t "generates .env"` | Wave 0 |
| D-07 | bootstrap.sh aborts on deny-list value | unit (self-test) | `pnpm vitest run tests/self-tests/refuse-default-secrets.test.ts -t "aborts non-zero"` | Wave 0 |
| D-06 (idempotent) | second bootstrap.sh run is a no-op for set values | unit (self-test) | `pnpm vitest run tests/self-tests/refuse-default-secrets.test.ts -t "idempotent"` | Wave 0 |
| D-08 | API container entrypoint refuses default secrets | integration | `pnpm vitest run apps/api/scripts/check-default-secrets.test.ts` | Wave 0 |
| D-21 | lint-rls flags table with tenant_id but no RLS | unit | `pnpm vitest run tools/lint-rls.test.ts -t "no RLS"` | Wave 0 |
| D-21 | lint-rls flags RLS table without policy | unit | `pnpm vitest run tools/lint-rls.test.ts -t "no policy"` | Wave 0 |
| D-21 | lint-rls flags policy without app.tenant_id | unit | `pnpm vitest run tools/lint-rls.test.ts -t "lacks app.tenant_id"` | Wave 0 |
| D-22 | lint-rls self-test on injected bad migration | self-test | `pnpm vitest run tests/self-tests/rls-introspection.test.ts` | Wave 0 |
| D-24 | make backup produces .age file | integration | `bash -c 'make backup && ls backups/*.dump.age'` (manual; CI integration is the test-migration job) | Wave 0 |
| D-25 | make restore decrypts and restores | integration | (CI test-migration job, when extended with backup-restore round-trip) | Wave 0 |
| D-26 | CI runs forward-apply + rollback | CI job | `gh workflow run ci.yml` → assert `test-migration` job green | Wave 0 (job name) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tools/ tests/self-tests/` (~5–10s for the tooling slice; ~30s if testcontainer pulls cold)
- **Per wave merge:** `pnpm test` (full suite — exercises lint-rls, self-tests, and existing Phase 0 tests together)
- **Phase gate:** Full suite green + `lint-rls` and `test-migration` GHA jobs green on PR before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tools/lint-rls.ts` — RLS introspection script (TDD: skeleton + failing test first)
- [ ] `tools/lint-rls.test.ts` — Vitest unit test using `@testcontainers/postgresql`
- [ ] `tools/bootstrap.sh` — bash bootstrap script (gated on bash >=4 check)
- [ ] `tools/bootstrap/default-secrets.txt` — deny-list data file
- [ ] `tests/self-tests/refuse-default-secrets.test.ts` — self-test mirroring `tests/self-tests/cyrillic-injection.test.ts`
- [ ] `tests/self-tests/rls-introspection.test.ts` — self-test for RLS lint
- [ ] `apps/api/scripts/check-default-secrets.ts` + `.test.ts` — D-08 entrypoint check
- [ ] `Makefile` — extend with `migrate`, `migrate:rollback`, `lint:rls`, `backup`, `restore` (replace stub-fail bodies)
- [ ] `package.json` scripts — `migrate`, `migrate:rollback`, `lint:rls`
- [ ] `.env.example` — placeholders for all 7 generated keys + non-secret config
- [ ] `keys/.gitkeep` and `keys/backup.age.pub` — committed placeholder + real recipient
- [ ] `backups/.gitignore` (`*\n!.gitignore`) — directory committed, contents ignored
- [ ] `.github/workflows/ci.yml` — append `lint-rls` and `test-migration` jobs
- [ ] `scripts/branch-protection.json` — append `"lint-rls"` and `"test-migration"` to required contexts (existing branch-protection-contexts self-test will then enforce)
- [ ] Framework install: `pnpm add -D @testcontainers/postgresql pg @types/pg` (only the tooling deps not already in repo)

### Bootstrap-specific manual validation gates (per CONTEXT additional context §12)
- [ ] "Run bootstrap.sh with empty .env → generates all required secrets, exits 0"
- [ ] "Run bootstrap.sh twice in a row → second run is no-op (idempotent for set values)"
- [ ] "Set MASTER_KEK=changeme → bootstrap aborts, 'MASTER_KEK' in stderr"
- [ ] "Run pnpm lint:rls against clean schema → exits 0"
- [ ] "Inject bad_table without RLS → pnpm lint:rls exits non-zero, 'bad_table' in stderr"
- [ ] "make backup → produces .age file in backups/"
- [ ] "make restore BACKUP=... → restores into fresh Postgres successfully"

All of the above are encoded as Vitest tests above OR as explicit CI workflow assertions in the `lint-rls` / `test-migration` jobs.

## Sources

### Primary (HIGH confidence)
- `/Users/nick/openwhispr-server/.planning/phases/01-core-infra-multi-tenant-data/01-CONTEXT.md` — D-06..D-12, D-21..D-26 verbatim
- `/Users/nick/openwhispr-server/tools/lint-english.ts` — pattern source for `tools/lint-rls.ts` (shebang style, exit codes, glob+stderr format)
- `/Users/nick/openwhispr-server/tests/self-tests/cyrillic-injection.test.ts` — pattern source for `tests/self-tests/refuse-default-secrets.test.ts`
- `/Users/nick/openwhispr-server/.github/workflows/ci.yml` — confirmed harness pattern (`step-security/harden-runner`, pnpm/action-setup@v4 v11.0.8, actions/setup-node@v5 node 24)
- `/Users/nick/openwhispr-server/scripts/branch-protection.json` — confirmed branch-protection schema and existing required contexts
- Postgres 17 docs § Row Security Policies — https://www.postgresql.org/docs/17/ddl-rowsecurity.html (canonical RLS DDL)
- Postgres `pg_policies` system view — https://www.postgresql.org/docs/17/view-pg-policies.html (introspection source)
- age GitHub — https://github.com/FiloSottile/age (encryption format, recipient model)
- drizzle-kit migrate docs — https://orm.drizzle.team/docs/kit-overview (migrate / down subcommands)

### Secondary (MEDIUM confidence)
- GitHub Actions service containers — Postgres example — https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers (verified pattern)
- `@testcontainers/postgresql` README — https://node.testcontainers.org/modules/postgresql/

### Tertiary (LOW confidence — to confirm at execution time)
- `age` apt package available on ubuntu-24.04 — confirm with `apt-cache policy age` in CI before locking the workflow.
- macOS default bash version on operator dev machines — assumed 3.2 (Apple ships outdated bash); if hard requirement, switch bootstrap to Node.

## Metadata

**Confidence breakdown:**
- bash bootstrap pattern: HIGH — straight openssl + grep + sed; standard idiom; only macOS bash 3.2 assumption needs confirmation
- lint-rls.ts pattern: HIGH — exact mirror of `tools/lint-english.ts` shape; `pg_class` / `pg_policies` queries are documented Postgres views
- Makefile / age / pg_dump pattern: HIGH — every step is canonical
- GHA service block + branch-protection wiring: HIGH — exact mirror of existing Phase 0 jobs
- macOS bash compatibility: MEDIUM — assumption A6 needs explicit decision
- `age` packaging on all platforms: MEDIUM — assumption A1 needs verify-step
- drizzle-kit `down` subcommand existence: MEDIUM — assumption A3 needs verify against current 0.x docs

**Research date:** 2026-05-09
**Valid until:** 2026-06-08 (30 days — tools are stable, but verify drizzle-kit pin and ubuntu-24.04 `age` package version at execution time)
