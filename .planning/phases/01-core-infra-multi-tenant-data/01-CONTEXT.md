# Phase 1: Core Infra & Multi-Tenant Data - Context

**Gathered:** 2026-05-09 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the full data plane the rest of the project sits on, with multi-tenancy enforced at the database from migration #1.

**In scope:**
- `docker-compose.yml` services: Postgres 17, PgBouncer 1.23+ (transaction-mode), Redis 7.4 / Valkey 8, MinIO, Traefik 3, OTel Collector, Grafana + Loki + Tempo + Mimir
- `bootstrap.sh` — refuse-to-start on default secrets (`changeme`, `sk-1234`, etc.); generates real secrets and writes `.env`
- Drizzle ORM setup + initial migration that creates `tenants` (with seeded `default` tenant), the application Postgres role, and RLS policies for every `tenant_id`-bearing table
- Tenant-context middleware contract for the API (`SET LOCAL app.tenant_id` per request transaction; PgBouncer-transaction-mode safe)
- RLS-introspection lint script (CI-blocking) that fails any new migration adding a `tenant_id`-bearing table without an enabled RLS policy
- TEST-RLS-01 property tests (random tenant pairs, every queryable model)
- KEK/DEK envelope encryption for sensitive columns: KEK adapter pattern (env / Vault / KMS) with the env adapter shipping in v1
- `make backup` / `make restore` — encrypted dump + one-command restore; CI runs forward-apply + rollback on every `migrations/` change
- Per-tenant MinIO bucket-prefix convention documented (no MinIO IAM enforcement yet; planning convention only)

**Out of scope (deferred to later phases):**
- API endpoints (Phase 2+)
- LiteLLM proxy bundling (Phase 3)
- BullMQ workers (Phase 6)
- Real auth (Phase 2 — but the `users` / `sessions` tables are added here in this phase as RLS-protected tables ready for Phase 2 to populate)
- Helm chart (Phase 9)

</domain>

<decisions>
## Implementation Decisions

### Compose stack composition

- **D-01:** Single `docker-compose.yml` at repo root, **Compose Spec v2** (no `version:` key — Spec is current, version key is legacy). Profiles: `default` (Postgres + PgBouncer + Redis + MinIO + Traefik + observability), `obs-only` (just observability for ops debugging), `db-only` (just Postgres + PgBouncer for CI / migration testing).
- **D-02:** Services: `postgres` (image `postgres:17-alpine`), `pgbouncer` (image `bitnami/pgbouncer:1.23` or equivalent CNCF — verify current 2026 pin during execution), `redis` (image `valkey/valkey:8-alpine` — Valkey for OSS license cleanliness), `minio` (image `minio/minio:RELEASE.2025-...`), `traefik` (image `traefik:v3.x` — verify minor), `otel-collector` (`otel/opentelemetry-collector-contrib:0.x`), `grafana` (`grafana/grafana:11.x`), `loki` (`grafana/loki:3.x`), `tempo` (`grafana/tempo:2.x`), `mimir` (`grafana/mimir:2.x`).
- **D-03:** Each service has a Compose `healthcheck:` block. Dependent services use `depends_on: { service: { condition: service_healthy } }` so `compose up` orders correctly.
- **D-04:** Named volumes for stateful services: `postgres_data`, `redis_data`, `minio_data`, `loki_data`, `tempo_data`, `mimir_data`, `grafana_data`. No bind mounts for state (operator opt-in only).
- **D-05:** Single internal Compose network `openwhispr_internal`; only Traefik exposes ports to the host (`80`, `443`, `8080` admin). Postgres / PgBouncer / Redis / MinIO / Loki / etc. are NOT host-published — accessed via Traefik or the API container only.
- **D-06:** `.env.example` ships at the repo root; every value is a placeholder. `bootstrap.sh` reads `.env.example`, generates strong random values for any unset secret, writes `.env` (gitignored). `bootstrap.sh` is idempotent.

### Refuse-to-start gate

- **D-07:** `bootstrap.sh` (or a Node entry-point invoked by it) walks `.env` and aborts with non-zero exit if any value matches a known-default deny-list: `changeme`, `password`, `admin`, `sk-1234`, `secret`, empty string. Deny-list lives in `tools/bootstrap/default-secrets.txt` (one per line, comments allowed) so it can be extended without code changes.
- **D-08:** Compose entrypoint of the API container ALSO performs the same check on startup (defense-in-depth in case operator bypasses bootstrap.sh). Refuses to start, logs offending key (not value), exits 1.
- **D-09:** Self-test `tests/self-tests/refuse-default-secrets.test.ts` — sets one of the deny-list values in a fixture `.env`, asserts bootstrap exits non-zero with the offending key in stderr.

### Secret generation

- **D-10:** `bootstrap.sh` uses `openssl rand -base64 32` (or Node `crypto.randomBytes(32).toString('base64url')` if openssl unavailable) for: Postgres password, PgBouncer admin password, Redis password, MinIO root password, Traefik admin password, KEK (Key Encryption Key for the DEK envelope), Better-Auth signing secret. Each is stored as a separate env var in `.env`.
- **D-11:** A single env var `MASTER_KEK` is the root key encryption key. Per-row Data Encryption Keys (DEKs) are generated at write time, encrypted with the KEK, and stored alongside the ciphertext. KEK rotation (Phase 2+) re-wraps DEKs without re-encrypting payload.
- **D-12:** KEK adapter pattern: interface `KeyProvider` with three v1 implementations: `EnvKeyProvider` (default), `VaultKeyProvider` (HashiCorp Vault — stub in v1, full impl deferred), `KmsKeyProvider` (AWS KMS — stub in v1). `OPENWHISPR_KEY_PROVIDER` env var selects the implementation.

### Drizzle + Postgres + RLS

- **D-13:** Drizzle ORM 0.x latest (verify pin during execution). Schema lives in `packages/data/src/schema/`. Each table is a separate file (`tenants.ts`, `users.ts`, `sessions.ts`, `audit_log.ts`, `usage_ledger.ts`, `virtual_keys.ts` — Phase 2/3 fills the table contents; Phase 1 ships migrations that CREATE TABLE with the constitutional minimum columns: `id` UUID, `tenant_id` UUID, `created_at`, `updated_at`).
- **D-14:** Migrations directory `packages/data/migrations/`. Drizzle-kit generates SQL; CI runs `pnpm drizzle-kit migrate` against a real Postgres (testcontainers) on every PR touching `migrations/`.
- **D-15:** **Two Postgres roles:**
  - `openwhispr_owner` — owns DDL, has BYPASSRLS (used by migration runner only).
  - `openwhispr_app` — used by the API and by tests; subject to RLS; NEVER has BYPASSRLS.
  PgBouncer connects as `openwhispr_app`. Migrations run as `openwhispr_owner` from a one-shot job.
- **D-16:** RLS pattern for every tenant-scoped table:
  ```sql
  ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
  CREATE POLICY foo_tenant_isolation ON foo
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  ```
  The `, true` argument silences errors when `app.tenant_id` is not set; in that case `current_setting` returns `''` and the cast fails — the policy denies. This is intentional fail-closed behavior.
- **D-17:** First migration (`0000_initial.sql`) creates: `tenants` (NOT tenant-scoped — root table, no RLS), `users`, `sessions`, `audit_log` (one row per audit event; tenant-scoped), `usage_ledger` (idempotent on `request_id`; tenant-scoped). Seeds the `default` tenant with a stable UUID `00000000-0000-0000-0000-000000000000`.

### Tenant-context middleware contract

- **D-18:** `packages/data/src/tenant-context.ts` exports a `withTenant<T>(tenantId, fn)` helper that opens a transaction, executes `SET LOCAL app.tenant_id = $1`, runs `fn`, commits. PgBouncer transaction-mode safe because `SET LOCAL` is scoped to the transaction.
- **D-19:** `apps/api/src/middleware/tenant.ts` — Fastify hook (`onRequest`) that extracts tenant from the bearer token (Phase 2 wires the actual extraction; Phase 1 reads from a `x-tenant-id` header for testing) and calls `withTenant`.
- **D-20:** A contract test interleaves 100 tenant-A and tenant-B queries through a real PgBouncer transaction-mode in front of a real Postgres (both in testcontainers) and asserts zero cross-tenant rows are observed.

### RLS-introspection lint

- **D-21:** `tools/lint-rls.ts` — connects to a fresh migrations-applied Postgres (testcontainers in CI; or a dev-mode local), introspects `pg_policies` and `pg_class.relrowsecurity`, and FAILS if:
  - Any table has a column named `tenant_id` AND `relrowsecurity = false`
  - Any table has RLS enabled but no policy
  - Any policy uses `bypass` or `permissive` without the `tenant_id = current_setting(...)` predicate
- **D-22:** CI step runs `pnpm lint:rls` on every PR touching `migrations/`. Self-test injects a migration that adds a `tenant_id` column without an RLS policy and asserts the lint exits non-zero.

### TEST-RLS-01 property tests

- **D-23:** `packages/data/src/__tests__/rls-property.test.ts` — uses fast-check (or Vitest's built-in property-based testing) to generate random tenant pairs (A, B), insert N rows under A's context, then attempt SELECT/UPDATE/DELETE under B's context, and assert zero rows touched. Runs against every queryable model auto-discovered from the Drizzle schema.

### Backup/restore

- **D-24:** `make backup` runs `pg_dump -Fc` against the running Postgres, encrypts the output with the MASTER_KEK using `age` (or Node `crypto.createCipheriv` with AES-256-GCM if `age` adds a heavy dep), writes to `backups/YYYY-MM-DDTHH-MM-SS.dump.age`. Both file and metadata (timestamp, schema version, KEK key id) recorded.
- **D-25:** `make restore BACKUP=path/to/file.dump.age` decrypts and `pg_restore`s into a target Postgres. Idempotent: errors clearly if target already has data.
- **D-26:** CI workflow runs forward-apply + rollback test: spin up Postgres in testcontainer, apply all migrations forward, run `pg_dump`, drop, restore, assert schema-equivalence. On `migrations/` change.

### MinIO per-tenant convention

- **D-27:** Documented in `docs/operations.md` and `docs/storage.md` (new): bucket name `openwhispr`, key prefix `tenants/<tenant-uuid>/<resource-type>/<id>`. No IAM enforcement in v1 (relies on app-tier checks); Phase 6+ adds MinIO policies.
- **D-28:** Single bucket created by the API on startup if missing (idempotent). Per-tenant prefixes auto-emerge from writes — no per-tenant bucket creation in v1.

### Observability stack baseline

- **D-29:** Phase 1 ships the LGTM stack containers + a single OTel Collector with a minimal config that accepts OTLP from the API container, batches, and forwards to Tempo (traces), Loki (logs), Mimir (metrics). No dashboards yet — Phase 6 ships those (OBS-02). Phase 1 deliverable is "the stack is up and accepts data without erroring."
- **D-30:** Grafana datasources auto-provisioned via `grafana/provisioning/datasources/*.yaml` so a fresh `compose up` lands on Grafana with all three sources pre-configured at `http://localhost:3000` (admin password generated by bootstrap).

### Traefik

- **D-31:** Traefik 3 with file-provider (no Docker provider in v1 — explicit routes are clearer for self-host). Routes: `/api/*` → API container (Phase 2 wires the API), `/grafana/*` → Grafana, `/minio-console/*` → MinIO admin. TLS via local self-signed cert in dev mode; cert-manager hooks deferred to Phase 9 Helm chart.

### Claude's Discretion

- Exact image pins (Postgres minor, PgBouncer minor, Valkey minor, etc.) — pick latest stable at execution time.
- Whether to use `age` for backup encryption or AES-256-GCM via Node `crypto` — pick whichever keeps deps lighter (probably `age` via the alpine package; bundled in the Postgres container's entrypoint).
- Whether `bootstrap.sh` is bash or a Node script — pick bash if it stays under ~80 lines, else Node.
- Specific Drizzle 0.x minor — pick latest stable.
- Whether the RLS lint script is TS (matches `tools/lint-english.ts`) or SQL — pick TS for consistency.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — constitutional rules
- `.planning/REQUIREMENTS.md` — DATA-01..07, TEST-MIGRATION-01, TEST-RLS-01, PROVIDER-02
- `.planning/ROADMAP.md` § Phase 1 — goal + 6 success criteria
- `.planning/research/STACK.md` — Postgres 17, PgBouncer transaction-mode, Drizzle, Valkey, Traefik 3
- `.planning/research/ARCHITECTURE.md` — RLS DDL sketch, sizing math at 1000 concurrent
- `.planning/research/PITFALLS.md` — multi-tenancy footguns (RLS bypass under PgBouncer transaction-mode, missing policies, cache key collisions, tenant context loss in jobs)

### Phase 0 outputs (CI substrate now in place)
- `apps/api/src/index.ts` — Fastify placeholder; Phase 1 adds the tenant middleware
- `packages/data/src/index.ts` — placeholder; Phase 1 fills with schema + migrations + tenant-context helper
- `packages/contract-tests/` — Phase 1 adds RLS-property tests
- `tools/lint-english.ts` — pattern for `tools/lint-rls.ts` (similar standalone TS script style)
- `vitest.config.ts` — coverage thresholds; Phase 1 inherits
- `Makefile` — extend with `migrate`, `migrate:rollback`, `backup`, `restore`, `lint:rls` targets

### External standards
- Postgres 17 docs § Row Security Policies — https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- PgBouncer transaction-mode + `SET LOCAL` — https://www.pgbouncer.org/features.html
- Drizzle ORM docs + drizzle-kit migrate — https://orm.drizzle.team/
- Compose Spec — https://compose-spec.io/
- Traefik 3 file provider — https://doc.traefik.io/traefik/providers/file/
- OTel Collector configuration — https://opentelemetry.io/docs/collector/configuration/

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/index.ts` — Fastify `buildApp()`; Phase 1 adds the tenant middleware via Fastify hook
- `packages/data/src/index.ts` — placeholder; replace with real schema + migrations
- `tools/lint-english.ts` — pattern to copy for `tools/lint-rls.ts` (TS, repo-rooted, exits non-zero on violations, has its own unit test)
- `tests/self-tests/` — pattern to copy for `tests/self-tests/refuse-default-secrets.test.ts` and `tests/self-tests/rls-introspection.test.ts`
- `Makefile` — extend with new targets; the stub-fail mechanism for unimplemented targets is in place

### Established Patterns (Phase 0)
- Conventional Commits + commitlint enforcement; pre-commit lefthook
- English-only source artifacts (DOCS-09 — applies to all migration SQL comments and Drizzle schema files)
- Vitest 4 coverage thresholds 85/80/80/85 — Phase 1 must not regress; new modules must come with tests
- pnpm workspace structure — Phase 1 grows `packages/data/` substantially

### Integration Points
- `docker-compose.yml` — Phase 0 ships a placeholder; Phase 1 expands to the full data plane
- `Makefile` — extend with new targets (migrate, backup, restore, lint:rls)
- `.github/workflows/ci.yml` — add jobs: `lint-rls`, `test-migration` (forward+rollback on real Postgres), and add `tests/self-tests/refuse-default-secrets.test.ts` to existing self-test job
- `scripts/branch-protection.json` — add `lint-rls` and `test-migration` to required contexts; the branch-protection-contexts self-test catches drift automatically
- `vitest.config.ts` — exclude `packages/data/migrations/**.sql` from coverage (SQL files, not TS); Phase 0 already excludes most of these via the broad `**/dist/**` rule

</code_context>

<specifics>
## Specific Ideas

- **PgBouncer transaction-mode is the load-bearing decision.** It's the only way we get to 1000 concurrent without hosing Postgres, and it's the source of the most subtle multi-tenancy footgun (`SET` instead of `SET LOCAL` leaks across pooled connections). The `SET LOCAL` discipline must be enforced via `withTenant()` helper — never invoked manually in app code.
- **RLS is fail-closed by design.** `current_setting('app.tenant_id', true)::uuid` returns empty on unset, cast fails, policy denies. A dev who forgets to call `withTenant()` gets zero rows back, not someone else's data. This is intentional and must be documented in `docs/operations.md`.
- **The `tenants` table is NOT tenant-scoped** — it's the root table that holds tenant identity. Migrations reference it; the app reads it (via `openwhispr_owner`) only during initial tenant resolution, then switches to `openwhispr_app` for every subsequent query.
- **Self-tests verify that the constitutional gates fire**, mirroring the Phase 0 pattern. Phase 1 adds:
  - `tests/self-tests/refuse-default-secrets.test.ts` — bootstrap aborts on `changeme`
  - `tests/self-tests/rls-introspection.test.ts` — `lint:rls` aborts on missing policy

</specifics>

<deferred>
## Deferred Ideas

- **HashiCorp Vault adapter (full implementation)** — v1 stubs the interface; Phase 9+ wires real Vault.
- **AWS KMS adapter (full implementation)** — same pattern; v1 stub only.
- **MinIO IAM policies for per-tenant isolation** — v1 relies on app-tier prefix discipline; Phase 6+ adds policies.
- **Encrypted backup to S3** — v1 ships local-disk encrypted dumps; Phase 9+ wires off-site backup.
- **Postgres failover / Patroni / CloudNativePG** — v1 single-node Postgres in compose; Helm chart in Phase 9 brings CNPG.
- **Dashboards in Grafana** — Phase 1 ships datasources only; OBS-02 in Phase 6 adds dashboards.
- **Docker provider for Traefik** — file provider in v1 for clarity; Helm chart may switch to k8s ingress provider.
- **Distributed tracing for Postgres queries** — v1 ships OTel Collector but no auto-instrumentation; Phase 6 adds it.

</deferred>

---

*Phase: 01-core-infra-multi-tenant-data*
*Context gathered: 2026-05-09 (auto mode — recommended defaults selected)*
