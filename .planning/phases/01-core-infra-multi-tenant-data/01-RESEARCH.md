# Phase 01 Research — Hub

> Research for Phase 1 was split into three parallel dimensions to fit the agent context budget. This file is the orchestrator/index. Each dimension has its own deep-dive document with concrete config snippets, version pins, and Validation Architecture.

## Dimension files

- **[01-RESEARCH-INFRA.md](./01-RESEARCH-INFRA.md)** — docker-compose stack, image pins, healthchecks, PgBouncer config, Traefik 3 file provider, OTel Collector pipeline, Grafana provisioning, MinIO conventions
- **[01-RESEARCH-DB.md](./01-RESEARCH-DB.md)** — Drizzle ORM + Postgres roles + RLS DDL, tenant-context middleware contract, KEK/DEK envelope encryption, TEST-RLS-01 property test design
- **[01-RESEARCH-TOOLING.md](./01-RESEARCH-TOOLING.md)** — bootstrap.sh + deny-list, API entrypoint defense-in-depth, lint-rls.ts + tests, Makefile extensions, age-based backup/restore, GHA `lint-rls` + `test-migration` jobs

## Cross-dimension load-bearing findings

These are the items every plan must respect:

### From INFRA
- **Bitnami PgBouncer image is no longer free** — use `edoburu/pgbouncer:1.23.1`
- **MinIO upstream distribution risk** — pin `minio/minio:RELEASE.2026-03-25T00-00-00Z` by digest; document `coollabsio/minio` fallback
- **Verified 2026 image pins:** postgres 17.5-alpine, traefik v3.6, otel-collector-contrib 0.151.0, grafana 11.6.0, loki 3.5.0, tempo 2.8.0, mimir 2.16.0, valkey 8.1-alpine
- **Mimir tenant-header gotcha:** even single-tenant Mimir requires `X-Scope-OrgID` on every write/read
- **PgBouncer:** `default_pool_size = 100`, `max_prepared_statements = 200` (Drizzle compat), `ignore_startup_parameters = extra_float_digits,search_path` mandatory

### From DB
- **Pinned versions verified 2026-05-09:** `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `pg@8.20.0`, `fast-check@4.7.0`, `@fast-check/vitest@0.4.1`
- **Two-pool client factory mandatory:** `ownerPool` direct to Postgres (DDL only, BYPASSRLS); `appPool` via PgBouncer (RLS-subject). Sharing one pool defeats isolation.
- **`SET LOCAL` cannot bind value parameters** — use `set_config('app.tenant_id', $1, true)` instead. The `, true` (LOCAL flag) is what makes it PgBouncer-transaction-mode safe.
- **`ENABLE` alone is insufficient — also `FORCE ROW LEVEL SECURITY`** so table owners cannot bypass.
- **drizzle-kit 0.31.10 likely does not emit ENABLE/FORCE RLS DDL natively (A1 ASSUMED)** — first migration must be hand-augmented after `drizzle-kit generate`.

### From TOOLING
- **bash bootstrap is the right call** — under 80 lines using openssl + grep + assoc arrays
- **`tools/lint-rls.ts` is a near-exact mirror of `tools/lint-english.ts`** — same shebang, exit codes, stderr format
- **GHA `services:` block beats testcontainers in CI** for migration tests (~3s startup); skip PgBouncer in those jobs (only needed for the property test)
- **`age` for backup encryption** — single binary, alpine/brew/scoop packaged; private key as GHA secret
- **macOS default bash 3.2 caveat** — bootstrap.sh requires bash >=4; document `brew install bash` for macOS operators

## Pitfalls inventory (cross-dimension)

| # | Pitfall | Source | Mitigation |
|---|---------|--------|------------|
| 1 | `SET` instead of `SET LOCAL` leaks across pooled connections | DB | `withTenant()` is the only way to set tenant; never call `db.execute(SET ...)` directly |
| 2 | New tenant-scoped table without RLS policy | DB | `tools/lint-rls.ts` blocks PR; CI runs against migrated Postgres |
| 3 | `_app` role inherits BYPASSRLS from `_owner` | DB | Two distinct roles, no inheritance; init script asserts `rolbypassrls=false` for `_app` |
| 4 | Cross-tenant cache key collision | (Phase 6) | Out of scope here; Phase 6 wraps Redis access with tenant prefix |
| 5 | Default secrets shipped to prod | TOOLING | bootstrap.sh deny-list + API entrypoint defense-in-depth |
| 6 | PgBouncer transaction-mode breaks session features | INFRA | Skip PgBouncer in CI migration tests; only used for app queries |
| 7 | testcontainers Postgres minor mismatch with prod | DB | Pin `postgres:17.5-alpine` everywhere |
| 8 | `age` private key leaked to logs | TOOLING | GHA secret + `actions/upload-artifact` exclusion glob |
| 9 | `current_setting('app.tenant_id')` errors on unset | DB | Use `, true` argument → returns empty string → `::uuid` cast fails → policy denies (fail-closed) |
| 10 | `__drizzle_migrations` table accidentally tenant-scoped | DB | Migration table lives in `_meta` schema, not main schema |

## Validation Architecture

Each dimension document has its own validation section. Phase-level rollup (referenced by `01-VALIDATION.md`):

**Compose / infra:**
- `make up` exits 0; all services Healthy within 60s
- `curl http://api.localhost/api/health` → 200 (Phase 0 placeholder still serves)
- `curl http://grafana.localhost/api/health` → 200
- OTel Collector receives a test span via `telemetrygen`, forwards to Tempo

**DB / RLS:**
- `make migrate` exits 0 against fresh Postgres; tenants/users/sessions/audit_log/usage_ledger exist
- `default` tenant row exists with UUID `00000000-...`
- `_app` role connection without `app.tenant_id` set → SELECT users returns 0 rows (fail-closed)
- TEST-RLS-01: 100 random tenant pairs, 0 cross-tenant leaks observed
- KEK/DEK envelope round-trip: encrypt then decrypt yields original plaintext byte-for-byte
- `make migrate:rollback` exits 0; all tenant tables dropped

**Tooling:**
- `bootstrap.sh` with empty `.env` generates all required secrets, exits 0
- `bootstrap.sh` twice in a row is no-op (idempotent)
- `MASTER_KEK=changeme bootstrap.sh` aborts with `MASTER_KEK` in stderr
- `pnpm lint:rls` against clean schema → exit 0
- Inject bad_table without RLS → `pnpm lint:rls` exits non-zero, `bad_table` in stderr
- `make backup` produces an `.age`-encrypted dump
- `make restore BACKUP=...` restores into fresh Postgres

## Open questions for plan-time resolution

1. **drizzle-kit 0.31.10 RLS DDL emission** (A1) — verify natively-emitted SQL; hand-augment migration if absent
2. **macOS bash 3.2 vs 4+** — accept "brew install bash" docs note (recommended) vs rewrite bootstrap in Node
3. **`age` recipient identity vs MASTER_KEK** — separate `BACKUP_AGE_IDENTITY` (X25519) recommended; not the same key as the symmetric MASTER_KEK
4. **MinIO fallback registry** — `coollabsio/minio` as documented fallback when upstream pins drift
5. **RLS on `tenants` itself** — currently un-RLS'd as the root table; Phase 6 may revisit per-org installs

These are tagged `[ASSUMED]` / `[OPEN]` in the dimension docs for plan-time review.
