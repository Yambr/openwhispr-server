# Security Posture & Threat-Model Registry

> Phase 10 / Plan 10-03 (DOCS-05). Public reference for the OpenWhispr
> Server security posture, the SSRF gate, secret-loading conventions,
> log-scrubbing policy, rate-limit topology, the audit-log threat
> model, and the consolidated threat-ID registry across all phases.
>
> Reporting a vulnerability: see [`../SECURITY.md`](../SECURITY.md)
> (top-level repo file is the public report channel; this document is
> the engineering posture reference).

OpenWhispr Server is built to enterprise self-host bar: HTTPS-only,
default-deny outbound, secret-loading conventions, structured
log-scrubbing, per-tenant rate limits, immutable audit log with FORCE
RLS, and a constitutional English-only source rule. This document is
the consolidated map of those controls and the threat IDs they
mitigate.

---

## 1. Posture summary

| Control                                         | Status                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| HTTPS only externally                           | constitutional; Traefik :443 + :8443; no plaintext HTTP entrypoint |
| FSL-1.1-ALv2 license (Apache-2.0 future conversion) | `LICENSE`, `NOTICE`, `docs/adrs/0013-fsl-relicense.md`        |
| English-only source artifacts                   | `tools/lint-english.ts` + lefthook + CI gate                      |
| Default-deny outbound (SSRF gate)               | `apps/api/src/lib/ssrf-dispatcher.ts` + per-env allow-list        |
| Secret loading from env (v1)                    | `.env` (single-host) / Kubernetes Secret (Helm) / ESO (option)    |
| Pino redact for logs                            | `packages/observability/src/redact.ts` (shared api + worker)      |
| FORCE RLS on every tenant-scoped table          | `tools/lint-rls.ts` enforces; CI gate                             |
| Audit log immutable + Cyrillic-guarded          | `apps/api/src/lib/audit.ts` (`assertEnglishOnly`)                 |
| Container-image SBOM + Trivy scan               | `.github/workflows/security.yml` + `trivy-fs`                     |
| Dependency scan + license scan                  | gitleaks + `license-scan` workflow                                |
| Mutation testing on auth + multi-tenancy        | Stryker quick set, gated in CI                                    |

Compliance posture: OpenWhispr Server is not certified for any
specific compliance standard (SOC 2, ISO 27001, HIPAA, GDPR) in v1.
The controls above are designed to make those certifications
straightforward for an operator who needs them, but the certification
work itself is operator scope.

---

## 2. SSRF gate (outbound-request allow-list)

The SSRF gate prevents the api process from being weaponized into a
proxy that fetches arbitrary intranet URLs. It is a process-wide
Node.js `undici` dispatcher installed at boot in
`apps/api/src/bootstrap.ts` via `installGlobalSSRF()`. Every outbound
HTTP call from the api goes through it; bypass requires a direct
socket(2) call which the code base does not contain.

### 2.1 Configuration

| Env var                            | Purpose                                                                                  | Default                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `OUTBOUND_ALLOWED_HOSTS`           | comma-separated allow-list of public hosts; `*.foo.bar` matches one-or-more left labels   | `""` (deny everything)  |
| `OUTBOUND_PRIVATE_HOST_ALLOWLIST`  | docker-compose / k8s service names permitted to resolve to RFC1918 (e.g. `litellm,valkey`) | `""`                  |
| `OUTBOUND_ALLOW_LOOPBACK`          | `1` permits 127/8 + ::1 ONLY when `NODE_ENV != "production"`                              | `0`                     |
| `OUTBOUND_SSRF_MODE`               | `enforce` (default) or `warn` (audit-only)                                                | `enforce`               |

Configuration is parsed once at boot in `apps/api/src/config/ssrf.ts`
and frozen. Subsequent calls validate against the frozen config.

### 2.2 Enforcement points

1. **Hostname allow-list check** — exact match or `*.suffix` match.
   Hosts not on the list are rejected with `event=ssrf.denied,
   reason=host_not_allowed`.
2. **DNS A/AAAA resolution** — if the resolved IP is RFC1918 (private)
   or RFC6890 special-use, and the hostname is not in
   `OUTBOUND_PRIVATE_HOST_ALLOWLIST`, the request is rejected. This
   defeats DNS-rebinding attacks because the dispatcher binds to the
   resolved IP for the lifetime of the request.
3. **Loopback check** — 127/8 and ::1 are rejected unless
   `OUTBOUND_ALLOW_LOOPBACK=1` AND `NODE_ENV != "production"`.
4. **Audit row** — every denial writes an `audit_log` row with action
   `ssrf_denied` and a sanitized payload (the URL host only; never
   the path or query).

### 2.3 Test invariants

`apps/api/src/lib/ssrf-dispatcher.test.ts` asserts:

- a request to `127.0.0.1` is denied in `NODE_ENV=production`;
- a request to a public host NOT on the allow-list is denied;
- a request to `litellm` (private host on the allow-list) is allowed;
- a hostname that resolves to RFC1918 is denied even if the hostname
  itself is on `OUTBOUND_ALLOWED_HOSTS` (DNS-rebinding scenario).

### 2.4 Threat IDs mitigated

- **T-SSRF-01** — SSRF via user-controlled URL.
- **T-DNS-REBIND** — DNS rebinding to escape allow-list.

---

## 3. Secret-loading conventions

### 3.1 v1 model: env-only

Every secret is supplied via process env. The `.env` file (or
docker-compose `env_file` or Kubernetes Secret) is the operator's
single source. The api refuses to start if any constitutional secret
is missing OR matches a deny-listed placeholder string.

The deny-list lives in `tools/bootstrap/default-secrets.txt` and is
enforced by `apps/api/scripts/check-default-secrets.ts`, which runs as
a container `command` ahead of the api process. Sample deny-listed
values:

- `changeme`
- `sk-1234`
- `replace-with-strong-secret`
- `password`
- empty string

If any required secret is unset or deny-listed, the container exits
with a structured error log naming the offending key.

### 3.2 SOPS-encrypted .env (operator option)

For single-host docker-compose deployments where storing plaintext
secrets in `.env` is unacceptable, operators can encrypt `.env` with
SOPS (`age` recipient) and decrypt at boot via the
`tools/bootstrap/decrypt-env.sh` helper. The repo does not bundle the
age key; operators manage it via their existing secret tooling.

### 3.3 External Secrets Operator (Helm option)

The Helm chart at `charts/openwhispr/` supports two secret modes:

- `secrets.mode=values` (default for testing) — secrets supplied via
  Helm `values.yaml` and rendered into a `Secret` resource.
- `secrets.mode=eso` — operator deploys an `ExternalSecret` /
  `SecretStore` pointing at AWS Secrets Manager / Vault / GCP Secret
  Manager / Azure Key Vault. An init container `secret-presence-probe`
  waits for ESO to materialize the Secret before the api pod starts.

The chart `values.schema.json` rejects placeholder secrets at
`helm install` time; the render-time `fail` gate catches them before
the cluster gets a chance to crashloop.

### 3.4 Never log secrets — pino redact (see §4)

The shared pino redact policy guarantees secrets never reach the
structured log stream. The audit-log Cyrillic guard ensures
forensic logs ingest a single language regardless of user locale.

---

## 4. Log scrubbing (pino redact)

`packages/observability/src/redact.ts` is the single redact policy
shared by api and worker. The set covers explicit header paths,
wildcard one-level-deep token-shaped keys, OAuth callback query
params, and root-level entries to close the `*.foo` gap for top-level
keys.

| Category                              | Sample paths                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Headers (req / res)                   | `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-auth-token"]`           |
| Wildcards (`*.foo`)                   | `*.token`, `*.secret`, `*.password`, `*.apiKey`, `*.api_key`, `*.virtualKey`, `*.client_secret` |
| OAuth callback / auth body            | `req.body.password`, `req.body.token`, `req.body.virtual_key`, `req.query.code`, `req.query.state` |
| Root-level (closes `*.foo` gap)       | `token`, `secret`, `password`, `apiKey`                                                      |

Censor format is `[REDACTED]`. The sentinel test
(`packages/observability/src/__tests__/redact.test.ts`) sweeps a
constructed log object across every path and asserts the redaction
landed.

### 4.1 Language-agnostic redaction

The redact policy is **key-based**, not value-based. It looks at JSON
paths regardless of what string the value contains. This means:

- A Cyrillic-language token value at `req.headers.authorization` is
  still redacted (the path matches, the language of the value is
  irrelevant).
- A non-secret Cyrillic-language string at a non-redacted path passes
  through unchanged.

Concretely: pino redact does not bypass under any locale. Adding new
locales to the i18n surface does not weaken the redact policy.

### 4.2 Threat IDs mitigated

- **T-LOG-LEAK-01** — credentials in headers.
- **T-LOG-LEAK-02** — secrets in request bodies.
- **T-LOG-LEAK-03** — OAuth code / state leakage to logs.

---

## 5. Rate-limit topology

OpenWhispr Server enforces rate limits at three layers:

1. **Per-IP at the api entry** — implemented in
   `apps/api/src/middleware/rate-limit-ip.ts`; backed by Valkey. The
   default is 60 requests / minute / IP across all `POST /api/*`
   surfaces. Bypassable only via the constitutional opt-out flag on
   `/api/health` (`rateLimit: false`).
2. **Per-tenant on resource-heavy routes** — `/api/transcribe`,
   `/api/reason`, `WSS /v1/realtime`. Default is 600 requests / minute
   / tenant for transcribe and reason; 10 concurrent open WSS per
   tenant for realtime. Limits are tunable via the
   `tenant_settings.rate_limits` JSONB column.
3. **Per-user on auth endpoints** — `/api/auth/sign-in`,
   `/api/auth/sign-up`, `/api/auth/verify-email` are gated by Better
   Auth's built-in rate limiter (10 attempts / 15 minutes / email).

There is **no bypass token** in v1. Internal monitoring agents that
hit `/api/health` are exempt by route configuration, not by a header.

Threat IDs mitigated: **T-DOS-01** (volumetric per-IP), **T-DOS-02**
(per-tenant fairness), **T-AUTH-BRUTE-01** (sign-in brute force).

---

## 6. Audit-log threat model

The `audit_log` table is the forensic record of every
security-relevant action: sign-in, sign-up, password reset, key
issuance, SSRF denial, RLS bypass attempt, virtual-key rotation,
account deletion, and 10 more (see
`packages/data/src/schema/audit_log.ts` for the full 18-action enum).
The table is partitioned by `created_at` (monthly), force-RLS-isolated
per tenant, and has the `pg_partman` background worker maintaining
retention.

### 6.1 Threats

| Threat ID              | Description                                                                                | Mitigation                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T-AUDIT-LOSS           | Audit row not written due to transaction rollback                                          | Audit writes happen in a separate `SAVEPOINT` so a failed business transaction still emits the audit row. Tested in `apps/api/src/lib/audit.test.ts`. |
| T-BEARER-LEAK          | Bearer token surfaces in an audit payload                                                  | The payload schema (Zod) forbids `token`, `secret`, `password` keys; the audit hook strips Bearer headers before serialization.            |
| T-CYRILLIC-INJECTION   | Adversary submits Cyrillic payload (e.g. user-controlled note title) to corrupt SIEM ingest | `assertEnglishOnly()` fail-loud guard rejects the INSERT and the route returns 500. The guard is constitutional per CLAUDE.md.            |
| T-AUDIT-TAMPER         | Operator with DB access mutates a historical row                                           | Audit rows are insert-only; the `openwhispr_app` role lacks UPDATE/DELETE on the table. Operator must use a separate `audit_admin` role.   |
| T-AUDIT-CROSS-TENANT   | Tenant A's audit row visible to Tenant B                                                   | FORCE RLS on `audit_log`; same per-tenant policy as the rest of the schema.                                                               |
| T-PARTMAN-LOSS         | Partman retention drops a partition before archive                                         | The Phase 6 `audit-archive` BullMQ job copies the oldest partition to MinIO before Partman drops it. Job failure halts the drop.          |

The Cyrillic guard is the most operator-visible piece of this model.
It is a fail-loud guard: any non-ASCII Latin-1 byte in an audit_log
payload triggers `AuditCyrillicError` which the centralized error
handler maps to **HTTP 500** with the localized envelope. The
intentional UX is "the audit row never lies about the language" —
downstream SIEM tooling, regex queries, and tabletop incident drills
all assume English bytes.

User-visible content (note titles, conversation messages) lives in
their own tenant-scoped tables and is allowed to be any language.
Those tables do not feed the audit_log.

### 6.2 Cross-link

See [`i18n.md`](./i18n.md) §7.1 for the operator-facing explanation
of the audit_log English-only rule and the recommended pattern when a
future audit surface needs to capture user-typed content.

---

## 7. Phase 6 audit summary (security)

Phase 6 ("Operational Substrate") did the heavy lifting on the
security plane:

- SSRF gate (SCALE-04) — `apps/api/src/lib/ssrf-dispatcher.ts`.
- Default-secret deny-list (PROVIDER-04) —
  `apps/api/scripts/check-default-secrets.ts`.
- Pino redact policy (D-T4) — shared in
  `packages/observability/src/redact.ts`.
- Token rotation overlap (AUTH-06) —
  `apps/api/src/lib/token-rotation.ts`.
- Audit-log partition + retention — `pg_partman` + the BullMQ
  `partman-maintenance` and `audit-archive` queues.
- Mutation testing on auth + multi-tenancy — Stryker config in
  `stryker.conf.json`.

The Phase 6 UAT (`phases/06-uat`) is the verification artifact; it
exercises every control above against a live `docker compose` stack
and asserts the audit row + structured log shape.

---

## 8. Reporting a vulnerability

Public report channel: [`../SECURITY.md`](../SECURITY.md). That file
is the only document that should change when the project gains a
GPG key, a security@ inbox, or a HackerOne page; this document is
the engineering posture reference and does not need to mirror the
contact channel.

Embargo policy (v1): the project does not yet operate a coordinated
disclosure window. Reports go to the project maintainers via the
channel in `SECURITY.md`; a patch lands as soon as the fix is ready
and is announced in the release notes.

---

## 9. Threat-model registry (consolidated)

Every threat ID raised across phases is consolidated here for ease of
reference. Each phase's plans carry their own `<threat_model>`; the
verifier agent uses this section as the index.

| Threat ID            | Phase / Plan          | Status      | Mitigation reference                                                  |
| -------------------- | --------------------- | ----------- | --------------------------------------------------------------------- |
| T-SSRF-01            | Phase 6 / SCALE-04    | mitigated   | §2 + `apps/api/src/lib/ssrf-dispatcher.ts`                            |
| T-DNS-REBIND         | Phase 6 / SCALE-04    | mitigated   | §2.2 (post-resolution IP check + IP-bound dispatcher)                 |
| T-LOG-LEAK-01        | Phase 6 / Plan 03     | mitigated   | §4 + `packages/observability/src/redact.ts`                           |
| T-LOG-LEAK-02        | Phase 6 / Plan 03     | mitigated   | §4 + redact body paths                                                |
| T-LOG-LEAK-03        | Phase 6 / Plan 03     | mitigated   | §4 + redact query paths (`code`, `state`)                             |
| T-DOS-01             | Phase 6               | mitigated   | §5 + per-IP rate limiter                                              |
| T-DOS-02             | Phase 6               | mitigated   | §5 + per-tenant rate limiter                                          |
| T-AUTH-BRUTE-01      | Phase 2 / AUTH-01     | mitigated   | §5 + Better Auth built-in rate limiter on auth endpoints              |
| T-AUDIT-LOSS         | Phase 6               | mitigated   | §6 + SAVEPOINT-isolated audit writes                                  |
| T-BEARER-LEAK        | Phase 6               | mitigated   | §6 + Zod-rejected token-shaped payload keys                           |
| T-CYRILLIC-INJECTION | Phase 10 / 10-01d     | mitigated   | §6 + `apps/api/src/lib/audit.ts` `assertEnglishOnly()` guard          |
| T-AUDIT-TAMPER       | Phase 1               | mitigated   | §6 + `openwhispr_app` lacks UPDATE/DELETE on `audit_log`              |
| T-AUDIT-CROSS-TENANT | Phase 1               | mitigated   | §6 + FORCE RLS on `audit_log`                                         |
| T-PARTMAN-LOSS       | Phase 6 / Plan 06-08  | mitigated   | §6 + audit-archive BullMQ job archives before Partman drops           |
| T-OAUTH-CSRF         | Phase 2 / AUTH-02     | mitigated   | PKCE + `oauth_state` row + atomic compare-and-set in callback         |
| T-CHANNEL-SCHEME     | Phase 2 / AUTH-02     | mitigated   | Channel-scheme allow-list; rejected schemes 400 (no redirect)         |
| T-COOKIE-ESCAPE      | Phase 2 / AUTH-07     | mitigated   | Cookie eTLD+1 scoping in `apps/api/src/lib/cookie-domain.ts`          |
| T-VKEY-LEAK          | Phase 6               | mitigated   | Virtual keys hashed with Argon2id at issuance; raw key returned once  |
| T-OUT-OF-SCOPE-LEAK  | Phase 2 / D-35        | mitigated   | `setNotFoundHandler` returns canonical envelope for v2-deferred routes|

The registry grows with each phase. New entries are appended in
plan-order. The verifier agent's `gaps_found` heuristic checks that
every `<threat_model>` block in every plan resolves to a row here OR
to an explicit `deferred` row with a remediation phase.

---

## 11. RLS posture (Phase 32)

Closes review finding CR-7 (`.planning/review/data.md` CR-01 + HI-04).

**Before Phase 32 — FAIL-OPEN.** Migration `0003_better_auth_tenant_defaults.sql:43-57` bound `app.tenant_id` to the placeholder default tenant at the `openwhispr_app` role level (rolconfig) AND added GUC-bound column DEFAULTs on the four Better Auth tables (`users`, `sessions`, `account`, `verification`). Every PgBouncer-leased connection inherited the default-tenant binding at backend-connect time; any query escaping `withTenant()` silently bound to that default tenant — including writes. This violated the constitutional "no row from tenant A is ever visible to a request running under tenant B" invariant for any code path that forgot to wrap a query in `withTenant()`.

**After Phase 32 — FAIL-CLOSED.** Migration `0018_rls_fail_closed.sql` does three things atomically:

1. `ALTER ROLE openwhispr_app RESET app.tenant_id` — the role no longer pre-binds the GUC at backend-connect time.
2. `ALTER COLUMN tenant_id DROP DEFAULT` on `users`, `sessions`, `account`, `verification` — the GUC-bound column DEFAULTs are removed.
3. Every tenant-scoped table's RLS policy USING and WITH CHECK bodies are rewritten to `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`. When the GUC is unset, `NULLIF('', '')` returns `NULL`, the cast yields `NULL`, and the comparison evaluates to `NULL` (treated as false for both USING and WITH CHECK).

Semantics per (op, context) cell after migration 0018:

| op     | with-context (correct UUID) | without-context (GUC unset or empty)       |
| ------ | --------------------------- | ------------------------------------------ |
| SELECT | returns matching rows       | returns 0 rows (**silent deny-read**)      |
| INSERT | row admitted iff WITH CHECK passes | raises PG `42501` (**raise on write**) |
| UPDATE | rowCount === N              | rowCount === 0 (USING reduces target to ∅) |
| DELETE | rowCount === N              | rowCount === 0 (USING reduces target to ∅) |

**Why silent-deny-read rather than raise-everywhere.** Variant (b) `missing_ok=false` would surface dozens of pre-existing routes that legitimately read empty result sets (e.g., a public bootstrap endpoint querying its own tenant before the tenant context is established). The route-level audit is Phase 41 content; Phase 32 keeps the multi-tenant invariant strict without holding the migration hostage to that route inventory.

**Coverage.** The 16-table × 4-op × 2-context = **128-case** property test on a real Postgres testcontainer is at `packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts`. The migration test at `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts` proves the role-default is cleared, the four column DEFAULTs are dropped, every policy body contains a `NULLIF(current_setting(...)` cast, and squawk lint exits 0.

**Operator note.** `withTenant()` (`packages/data/src/tenant-context.ts`) is the only sanctioned entry into a tenant-scoped query. System jobs that legitimately need to span tenants set a transaction-scoped **`app.bypass` claim** via `withSystemBypass()` / `withSystemBypassClient()` (see §11.2 below) — a single NOBYPASSRLS role suffices. The `openwhispr_owner` role's `BYPASSRLS` attribute is **no longer required** as of the claim-driven posture (migration `0033`).

**Threat IDs closed.** TM-RLS-DEFAULT (default-tenant leakage). Registry entry in section 9.

### 11.1 Row-Level Security posture (v1) — Better Auth fail-open caveat (data:CR-02)

The Phase 32 fail-closed posture above is **not uniform** across all 16 tenant-scoped tables in the shipped v1 codebase. Migration `0024_better_auth_tenant_id_defaults.sql` re-installed — _after_ Phase 32 — both the `ALTER ROLE openwhispr_app SET app.tenant_id` rolconfig and the GUC-bound `tenant_id` column DEFAULTs on the four Better Auth identity tables. The data-layer adversarial review flagged this as **data:CR-02**. Phase 57 Track B resolves it via **D2 — document the debt honestly + property-test the documented posture** (no migration change). The honest, accurate posture as shipped:

**The 12 application tables enforce fail-closed RLS.** `audit_log`, `usage_ledger`, `oauth_state`, `tenant_settings`, `user_settings`, `notes`, `folders`, `conversations`, `messages`, `transcriptions`, `api_keys`, `usage_rollup_daily` have **no** `tenant_id` column DEFAULT. A query without tenant context returns zero rows on SELECT and a bare INSERT is refused (`42501` RLS deny, or `23502` NOT NULL). Phase 32's guarantee holds intact for these tables.

**The 4 Better Auth identity tables fail open to the default tenant.** `users`, `sessions`, `account`, `verification` currently resolve to the default tenant when no `withTenant()` context is set. This is because Better Auth's `drizzleAdapter` is a module-singleton that issues bare `INSERT INTO <table> (tenant_id, ...) VALUES (default, ...)` statements — it relies entirely on the migration-0024 column DEFAULTs (`tenant_id DEFAULT current_setting('app.tenant_id', true)::uuid`) plus the rolconfig-bound GUC to fill `tenant_id`. A bare `openwhispr_app` connection therefore (a) reads default-tenant rows without `withTenant()`, and (b) writes that succeed and bind to the default tenant.

**Why this is not a live exposure in v1.** v1 is single-installation-single-tenant: there is exactly one tenant (the default tenant). With one tenant there is no other tenant's data to leak — the fail-open path resolves to the only tenant that exists. It is nonetheless tracked **security debt**, not an accepted permanent design.

**The durable fix is a named v2-blocker.** The proper resolution — "D3" — is a request-scoped, per-request Better Auth adapter, each bound to a connection that has `set_config('app.tenant_id', <resolved-tenant>, true)` already applied, replacing the current module-singleton `betterAuth({...})` adapter binding. D3 makes the Better Auth surface genuinely fail-closed and multi-tenant-ready. It is a Better Auth integration rewrite, deferred to v2; tracked in `.planning/deferred-items.md` (the "Phase 57 — data:CR-02" entry).

**Coverage.** The cohort boundary is pinned by the property test at `packages/data/tests/unit/__tests__/rls-posture-boundary.test.ts` (real Postgres testcontainer). It asserts the 12 application tables refuse a bare INSERT and the 4 Better Auth tables admit one bound to the default tenant — and is structured to fail loudly on _either_ half of a partial regression (an app table gaining a fail-open DEFAULT, or a Better Auth table losing its DEFAULT without the D3 adapter fix landing alongside).

### 11.2 Claim-driven privileged bypass — single NOBYPASSRLS role (quick 260602-j9z)

**Why.** Corporate managed Postgres (AWS RDS, GCP Cloud SQL, Azure, on-prem managed) typically issues exactly ONE application role (`svcdb_*`) that is `NOBYPASSRLS` and non-superuser; the security team will not grant `BYPASSRLS`. The privileged/cross-tenant path (first-tenant bootstrap + the worker's spend-ingest / reconciliation / usage-rollup-dispatcher jobs) previously relied on the `openwhispr_owner` role's `BYPASSRLS` attribute, so it could not run there.

**The posture.** Migration `0033_rls_claim_driven_bypass.sql` reshapes all 16 tenant-table RLS policies to a Supabase `service_role`-style claim:

```
USING / WITH CHECK (
  current_setting('app.bypass', true) = 'on'
  OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
```

A privileged caller opens a transaction and sets `set_config('app.bypass', 'on', true)` (transaction-scoped) before its cross-tenant query, via the data-package helpers `withSystemBypass(db, fn)` (Drizzle) / `withSystemBypassClient(pool, fn)` (raw `pg.Pool`). **`BYPASSRLS` is no longer required** — a single `NOBYPASSRLS` role runs every path. `makeOwnerDb()` / the owner pool stay; on a single-role deploy `DATABASE_URL_OWNER` and `DATABASE_URL` point at the same `svcdb_*` role, and the bypass now comes from the **claim**, not the role attribute.

**Isolation is preserved.** A normal request flows through `withTenant()`, which sets ONLY `app.tenant_id` and NEVER `app.bypass` — so the policy's left OR-arm is false and tenant isolation is unchanged. `app.bypass` is only ever set by `withSystemBypass[Client]`, which is called solely from system jobs + bootstrap, never a request-hot-path. `set_config(..., true)` is transaction-scoped, so the claim is released at COMMIT/ROLLBACK and cannot leak across PgBouncer connection reuse.

**Coverage.** The 16-table × {bypass-works, isolation-preserved, fail-closed-preserved} property test on a real Postgres testcontainer with a `NOBYPASSRLS` role (proving the CLAIM, not the role attribute, grants access) is at `packages/data/tests/unit/__tests__/rls-claim-bypass.property.test.ts` (81 cases). The pre-existing fail-closed 128-case proof (`rls-fail-closed.property.test.ts`) still passes intact — the OR-arm adds no fail-open path when `app.bypass` is unset.

**Role-name independence.** In-migration GRANTs target the literal role `openwhispr_app`. When the operator runs on a custom-named role, set `DATABASE_APP_ROLE` (and `DATABASE_OWNER_ROLE`); the migrate runner then handles BOTH halves of the renamed-role contract: (1) `GRANT openwhispr_app TO <role>` so the custom role inherits the full canonical GRANT chain in one statement (`packages/data/src/migrate.ts grantAppRoleMembership`, idempotent + skipped when either role is absent); AND (2) `ALTER ROLE <role> SET app.tenant_id TO '<default tenant>'` so the custom role lands every backend connection with the default-tenant GUC pre-bound (`bindAppRoleTenantDefault`, same guards). Step (2) is necessary because migrations `0003`/`0024` apply that rolconfig only under `IF EXISTS … 'openwhispr_app'` — without it, a renamed role's connections have `app.tenant_id` unset and Better Auth's pre-auth `verification` INSERT (whose `tenant_id` column DEFAULT resolves from the GUC) lands NULL → FORCE RLS WITH CHECK violation → 500 on sign-in (upstream #7). `DATABASE_APP_ROLE` MUST name the **LOGIN** role the app actually connects as — a rolconfig on a NOLOGIN group role is recorded but never takes effect (and that role would already fail the GRANT-inheritance design too).

**Migration replay under a NOBYPASSRLS role (quick 260602-x6z).** The claim arm in migration `0033` is a retrofit on the *final* policy state, so it does not help when the migration history is replayed on a *fresh* DB: the seed/backfill DML in earlier migrations (e.g. `0006`'s `INSERT INTO tenant_settings`) runs under FORCE RLS *before* `0033` re-creates the policy with the bypass arm. Under a single NOBYPASSRLS owner role that `INSERT` would raise `42501`. Two defence-in-depth fixes make a fresh `migrate` succeed on one NOBYPASSRLS role: (a) the policies in `0006` are bypass-aware at creation (the `app.bypass` arm + the fail-closed `NULLIF` form, not just retrofitted in `0018`/`0033`); and (b) the migrate runner builds its pool with `MIGRATE_SESSION_OPTIONS = "-c app.bypass=on -c app.tenant_id=<default tenant>"` (`packages/data/src/migrate.ts`). `app.bypass=on` satisfies post-`0033` policies during replay; `app.tenant_id=<default tenant>` satisfies the pre-`0033` policy WITH CHECK on the default-tenant seed rows. These libpq GUCs are scoped to the **migrate pool only** — the app pool (`makeAppDb` / `DATABASE_URL`) never carries them, so RLS stays full-force for application traffic (pinned by a unit test asserting the app pool config has no `app.bypass`). `BYPASSRLS` on the owner role is therefore not required for migrate either.

---

## 12. Encryption at rest (envelope encryption for credential columns)

**Source:** Phase 33 (CRIT-FIX-02 closure). Phase 33's `tools/lint-no-plaintext-secret-columns.ts` (LOCKER-PLAINTEXT-COLS / DISCIPLINE Rule 15) refuses any reintroduction of plaintext credential columns from the schema side; this section is the operator-facing companion.

### 12.1 Scope — what is encrypted

The 8 Better Auth + OAuth credential columns are envelope-encrypted at rest via AES-256-GCM with a per-row data-encryption key (DEK) wrapped under the deploy's master key-encryption key (KEK):

| Table | Column | Sensitivity |
|---|---|---|
| `account` | `access_token` | OAuth-issued bearer for the upstream IdP |
| `account` | `refresh_token` | Long-lived OAuth refresh credential |
| `account` | `id_token` | OIDC ID token (claims about the user) |
| `account` | `password` | Hashed credential password (Better Auth-managed) |
| `verification` | `value` | Email-verification + password-reset short-lived tokens |
| `sessions` | `token` | Active session bearer (channel-scheme echoed back to client) |
| `sessions` | `previous_token` | AUTH-04 5-minute rotation overlap bearer |
| `oauth_state` | `code_verifier` | PKCE code_verifier for in-flight OAuth handshakes |

Each column maps to 6 nullable `bytea` sidecar columns (the `EncryptedRow` shape declared in `packages/data/src/encryption/envelope.ts`):

- `<col>_dek_wrapped` — AES-256-GCM(KEK, DEK)
- `<col>_dek_iv` — 12-byte IV used to wrap the DEK
- `<col>_dek_auth_tag` — 16-byte GCM tag over `dek_wrapped`
- `<col>_value_iv` — 12-byte IV used to encrypt plaintext
- `<col>_value_auth_tag` — 16-byte GCM tag over `value_ciphertext`
- `<col>_value_ciphertext` — AES-256-GCM(DEK, plaintext)

`sessions.token` and `sessions.previous_token` additionally carry a SHA-256 fingerprint sidecar (`token_fp` NOT NULL, full UNIQUE INDEX; `previous_token_fp` nullable, partial INDEX for the AUTH-04 5-minute overlap window) so lookup-by-token remains O(log N) without ciphertext-side scanning.

The lens that round-trips plaintext ↔ ciphertext at the Drizzle adapter layer lives at `packages/data/src/encryption/lens.ts`; the OAuth-state codec for the three raw-`sql` fragment sites lives at `packages/data/src/encryption/oauth-state-codec.ts`. Boot-time validation is at `packages/data/src/encryption/validate-boot.ts` and runs from both `apps/api/src/index.ts` and `apps/worker/src/index.ts` — process exits `78` (BSD `EX_CONFIG`) on missing/short `MASTER_KEK` or unsupported `OPENWHISPR_KEY_PROVIDER`.

### 12.1.1 Key-provider selection — v1 supports `env` only

`OPENWHISPR_KEY_PROVIDER` selects how the master KEK is sourced. **In v1 the only supported value is `env`** (the default): the KEK is read as raw bytes from the `MASTER_KEK` environment variable. `validateKeyProviderSelection()` (`packages/data/src/encryption/boot.ts`) **refuses boot** (exit `78`) for any other value.

`vault` and `kms` are reserved provider names whose implementations (`VaultKeyProvider`, `KmsKeyProvider`) are **v1 stubs** — every method throws `NOT_IMPLEMENTED`. They are a documented **v2 roadmap item**, are deliberately NOT exported from the `@openwhispr/data` / `@openwhispr/data/encryption` public barrel, and cannot be selected at boot. Do NOT set `OPENWHISPR_KEY_PROVIDER=vault` or `=kms` — the process will exit `78`.

Sourcing the `MASTER_KEK` *value* from a managed KMS is fully supported in v1 — see §12.5 — but that is done via the `env` provider (the operator fetches the bytes from the KMS at deploy time and exports them as `MASTER_KEK`). The KMS integration is in the deploy tooling, not in a `kms` key-provider.

### 12.2 `MASTER_KEK` env — setup

`MASTER_KEK` is 32 raw bytes encoded as base64. **Never log it**, never commit it, never bake it into images. The value MUST be present at boot for both `api` and `worker` containers; absence or wrong length causes immediate exit-78.

```bash
# Generate locally (DEV/test only — production KEK MUST come from KMS, see 12.5):
openssl rand -base64 32
# 32-byte base64 string, exactly 44 chars including trailing '='
```

Provision via your secret store (Kubernetes Secret, docker-compose `.env` mounted as a file, AWS Secrets Manager, etc.).

```yaml
# docker-compose.yml fragment (self-host single-VM quickstart)
services:
  api:
    environment:
      OPENWHISPR_KEY_PROVIDER: env
      MASTER_KEK: ${MASTER_KEK}
  worker:
    environment:
      OPENWHISPR_KEY_PROVIDER: env
      MASTER_KEK: ${MASTER_KEK}
```

```yaml
# Helm values fragment (K8s production)
api:
  extraEnv:
    - name: OPENWHISPR_KEY_PROVIDER
      value: env
    - name: MASTER_KEK
      valueFrom:
        secretKeyRef:
          name: openwhispr-master-kek
          key: master-kek-b64
```

### 12.3 KEK rotation runbook

KEK rotation is performed via an overlap window. The current v1 implementation supports a single-key `env` provider; the overlap pattern below documents the operator procedure once the `MASTER_KEK_PREVIOUS` env support lands (tracked as future work — landing-phase deferred per Phase 33 / Plan 33-05 § "Out of scope").

1. Generate the new KEK material (`openssl rand -base64 32` or KMS — see 12.5).
2. Deploy `api` + `worker` with both `MASTER_KEK_CURRENT` (new) AND `MASTER_KEK_PREVIOUS` (old) set. Read paths try `MASTER_KEK_CURRENT` first and fall back to `MASTER_KEK_PREVIOUS`; write paths always wrap under `MASTER_KEK_CURRENT`.
3. Run the re-wrap migrator (`pnpm --filter @openwhispr/data exec tsx src/encryption/rewrap-migrator.ts` — future work) until every `<col>_dek_wrapped` value has been re-wrapped under the new KEK. The migrator is idempotent.
4. Once the migrator reports zero rows remaining under `MASTER_KEK_PREVIOUS`, redeploy with `MASTER_KEK_PREVIOUS` unset and `MASTER_KEK = MASTER_KEK_CURRENT` (back to single-key shape).

During the overlap window, the boot validator accepts either env name; outside the window, only `MASTER_KEK` is honored.

### 12.4 Rollback rescue procedure

Migration `0020_envelope_encrypt_secret_columns_drop_plaintext.sql` is forward-only. The companion `.down.sql` (NOT in the drizzle journal — mirrors 0018/0019 rescue precedent) restores the plaintext-column **shape** but CANNOT recover plaintext data (it has been dropped from disk). To restore plaintext content during an emergency rollback:

1. Stop all writers (api + worker scaled to 0).
2. Run the reverse-backfill (`pnpm --filter @openwhispr/data exec tsx src/encryption/reverse-backfill.ts` — future work) which decrypts every row's ciphertext and writes the plaintext to a temporary staging table.
3. Apply the rescue `0020.down.sql`.
4. Copy plaintext values from the staging table into the restored plaintext columns.
5. Drop the staging table.

In v1, steps 2 and 4 are operator scripts; automating them is out of scope for Phase 33.

### 12.5 KMS provisioning recipes

`env` is the **only** v1 key provider (see §12.1.1). The recipes below do NOT enable a `kms`/`vault` *provider* — they show how to source the `MASTER_KEK` *bytes* from a managed KMS and hand them to the `env` provider: the operator fetches the raw bytes once at deploy time and exports them via the `MASTER_KEK` env var. A native `kms`/`vault` key provider is a v2 roadmap item.

**AWS KMS** (`generate-data-key` with `AES_256`):

```bash
aws kms generate-data-key \
  --key-id arn:aws:kms:eu-west-1:123456789012:key/<kms-key-arn> \
  --key-spec AES_256 \
  --query 'Plaintext' --output text \
  > master-kek-b64.txt
```

**GCP KMS** (`decrypt` a customer-managed key-protected secret):

```bash
gcloud kms decrypt \
  --location europe-west1 \
  --keyring openwhispr-prod \
  --key master-kek-v1 \
  --ciphertext-file master-kek.enc \
  --plaintext-file - \
  | base64 > master-kek-b64.txt
```

**Azure Key Vault** (named secret stores the base64 plaintext directly):

```bash
az keyvault secret show \
  --vault-name openwhispr-prod-kv \
  --name master-kek-b64 \
  --query 'value' --output tsv \
  > master-kek-b64.txt
```

**HashiCorp Vault** (KV v2):

```bash
vault kv get -field=plaintext secret/openwhispr/master-kek \
  > master-kek-b64.txt
```

In every case, the deploy harness reads `master-kek-b64.txt` and exports `MASTER_KEK=$(cat master-kek-b64.txt)` to the container env. The file MUST be `chmod 600` and deleted from the host after deploy.

### 12.6 Defence-in-depth — LOCKER-PLAINTEXT-COLS

The `tools/lint-no-plaintext-secret-columns.ts` linter (LOCKER-PLAINTEXT-COLS / DISCIPLINE Rule 15) scans `packages/data/src/schema/**/*.ts` via the TypeScript Compiler API and REFUSES (exit 1, BLOCKING from day one — no `--warn-only`, no allowlist) any `text(...)` / `varchar(...)` / `char(...)` declaration whose first argument matches the 8 credential names above. This catches:

- An accidental `drizzle-kit generate` regeneration that re-emits a plaintext column declaration alongside the bytea sidecars.
- A copy-pasted route that adds a new credential column without going through envelope encryption.
- A future contributor unfamiliar with this section who attempts to "simplify" the schema.

The linter runs in lefthook pre-commit, CI `lint-english` job, and the nightly `lockers-nightly` job — every commit, every PR, every night. Any future legitimate exception requires a DISCIPLINE amendment, not a flag flip.

---

## 13. LiteLLM boot guard

The api refuses to boot when `NODE_ENV=production` and any of the following holds:

1. `LITELLM_MASTER_KEY` is unset or empty.
2. `LITELLM_MASTER_KEY === "sk-dev-master-key-do-not-use-in-prod"` — the dev-tools overlay default. Anti-footgun: an operator who copy-pastes the dev `.env` into production must not silently end up with a routable proxy.

Behavior: `validateLitellmBoot()` writes a `FATAL litellm-boot: …` line to stderr and exits with status code 78 (`EX_CONFIG`, matching `validateAuthBoot` in §3 and `validateEncryptionBoot` in §12).

Without this guard, the api would catch `loadLitellmConfigFromEnv()`'s throw, log a single `litellm.client.unavailable` line at warn level, and silently skip registering the four LiteLLM-backed routes (`/api/transcribe`, `/api/reason`, `/v1/audio/diarization`, `/v1/realtime`). `/api/health` would still return `{"status":"ok"}` — the breakage is invisible until an operator hits a 404.

In `NODE_ENV=development` or `NODE_ENV=test` the guard is permissive (the dev-tools overlay seeds the default key; vitest never wires the var). The catch-and-warn path remains for those environments so a developer running without a real key sees the 404 envelope on those routes (the right operator UX, distinct from a transient-looking 503 on a registered-but-dead route).

Source: `apps/api/src/config/litellm.ts`. Tests: `apps/api/tests/unit/config/litellm.test.ts`.

### 13.1 Threat IDs mitigated

- T-PROD-001 — production deploy with silently-dropped LiteLLM surface.
- T-PROD-002 — operator copy-paste of dev `.env` shipping the well-known dev master key to a public deployment.

---

## 10. Related documentation

- [`architecture.md`](./architecture.md) — components, request hot
  paths, tenant-isolation chokepoint diagram.
- [`auth.md`](./auth.md) — Better Auth dual-auth, channel-scheme
  echo, token rotation overlap.
- [`operations.md`](./operations.md) — operator runbooks for
  upgrade / scale / restore + i18n volume mount.
- [`observability.md`](./observability.md) — metric / span / log
  catalogues that the SLO dashboards consume.
- [`i18n.md`](./i18n.md) — locale negotiation, LOCALES_DIR override,
  audit-log English-only rule rationale.
- [`wire-contract.md`](./wire-contract.md) — v1 wire surface and the
  v2-deferred routes (404 + canonical envelope is the right UX).
- [`../SECURITY.md`](../SECURITY.md) — public vulnerability report
  channel.
