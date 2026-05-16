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
| Apache-2.0 license (with explicit patent grant) | `LICENSE`, `NOTICE`                                               |
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

**Operator note.** `withTenant()` (`packages/data/src/tenant-context.ts`) is the only sanctioned entry into a tenant-scoped query. System jobs that legitimately need to span tenants connect via the `openwhispr_owner` role (BYPASSRLS); see `packages/data/src/system-context.ts` and the BullMQ `withSystemContext()` wrapper for the codified pattern.

**Threat IDs closed.** TM-RLS-DEFAULT (default-tenant leakage). Registry entry in section 9.

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
