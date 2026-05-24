# openwhispr-postgres

CloudNativePG (CNPG) Cluster + transaction-mode Pooler for the OpenWhispr
server. Install ONLY when the operator does not already run Postgres for
OpenWhispr — otherwise the `openwhispr-server` chart supports BYOK
Postgres via `database.host` / `database.passwordSecretRef`.

## Prerequisites

- Kubernetes 1.28+
- CloudNativePG operator 1.29+ installed cluster-wide
  (`https://cloudnative-pg.io/documentation/`)

## Install

```bash
helm install ow-postgres oci://ghcr.io/yambr/charts/openwhispr-postgres \
  --version 1.1.0 \
  -f charts/openwhispr-postgres/examples/values-helm-values.yaml \
  --set-string secrets.ownerPassword=$(openssl rand -base64 24) \
  --set-string secrets.appPassword=$(openssl rand -base64 24)
```

## Chart 1.1.0 — `app.tenant_id` rolconfig fix

Chart 1.1.0 adds one line to CNPG `postInitApplicationSQL`:

```sql
ALTER ROLE <appRole> SET app.tenant_id = '00000000-0000-0000-0000-000000000000';
```

**Why:** Better Auth's `drizzleAdapter` is a module singleton
constructed once at api boot and reused for every auth request — it
does not call `set_config('app.tenant_id', ...)` per request. Bare
INSERTs into the 4 identity tables (`users`, `sessions`, `account`,
`verification`) therefore need the GUC pre-bound on the application
role or `tenant_id` resolves to NULL and violates the NOT NULL
constraint.

Without this fix, fresh installs of `openwhispr-server` chart 1.0.5 +
image v1.0.3 failed sign-up with `users.tenant_id NULL constraint
violation`, requiring manual `kubectl exec ... ALTER ROLE` correction
on every Cluster.

Coverage: chart 1.1.0 fires automatically on NEW CNPG Clusters.
Existing Clusters (operators already on chart 1.0.0) are NOT affected
by `helm upgrade` because `postInitApplicationSQL` only runs at
Cluster bootstrap — but those operators already applied the manual
ALTER ROLE during the chart 1.0.5 incident, so the upgrade is a no-op
for them.

**BYOK Postgres (NOT using openwhispr-postgres chart):** operators
running managed Postgres (RDS, Aurora, Cloud SQL, on-prem) must run
the one-liner themselves before first install — see the
openwhispr-server chart README "BYOK Postgres operators" section.

This is accepted v1 single-installation-single-tenant debt per
CLAUDE.md Constraint 16 (RLS posture ledger); v2 fix (request-scoped
per-request Better Auth adapter, "D3") in
`.planning/deferred-items.md` removes this need entirely.

## Secrets modes

| Mode               | What the chart renders                                                                     |
|--------------------|--------------------------------------------------------------------------------------------|
| `helm-values`      | Owner + app Secret inline. Operator supplies passwords via `--set-string` or values file.  |
| `eso`              | Nothing — operator brings ExternalSecret manifests pointing at SecretStore.                |
| `external-managed` | Nothing — operator brings the Secrets via SealedSecrets / Vault / etc.                     |

When `secrets.cnpgManaged: true`, the chart skips its inline Secret
render even in `helm-values` mode and lets CNPG auto-generate the
bootstrap + app passwords. CNPG emits `<cluster>-superuser` and
`<cluster>-app` Secrets. The openwhispr-server chart's
`database.passwordSecretRef` should then point at the CNPG-managed
`<cluster>-app` Secret.

### Two CNPG password paths

| Path                                  | When                                              | Server chart `database.passwordSecretRef.name`         |
|---------------------------------------|---------------------------------------------------|--------------------------------------------------------|
| Chart-rendered (default)              | `secrets.mode=helm-values`, `cnpgManaged: false`  | `<release>-pg-app` (default)                           |
| CNPG-managed bootstrap                | `secrets.cnpgManaged: true`                       | `<release>-pg-app` (the CNPG-emitted Secret)           |
| Operator-managed (ESO / SealedSecret) | `secrets.mode=eso` or `external-managed`          | `<release>-pg-app` (operator-supplied, same name)      |

In all 3 cases the openwhispr-server chart's default
`database.passwordSecretRef` resolves to `<release>-pg-app` — only the
*source* of the Secret changes.

## Release-name convention

The openwhispr-server chart's `database.host` default resolves to
`<release>-pg-pooler` after stripping the `-server` suffix. Convention:
install this chart as `<prefix>-postgres` and the server chart as
`<prefix>-server` (sharing the `<prefix>` token).

If your release name lacks the `-server` suffix the server chart's
default becomes `<server-release-name>-pg-pooler` (the `trimSuffix`
is a no-op). Override `database.host` explicitly on the server chart
to point at this chart's Pooler Service name.

## Values reference

See `values.yaml` for full inline docs. Key knobs:

| Key                              | Default                                                                    | Purpose                                                            |
|----------------------------------|----------------------------------------------------------------------------|--------------------------------------------------------------------|
| `postgres.imageName`             | `ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman:17.6-1.0.1`           | CNPG image; MUST pin PG 17 (schema-enforced).                      |
| `postgres.replicas`              | `3`                                                                        | CNPG instances; set to 1 for single-node.                          |
| `postgres.storageSize`           | `20Gi`                                                                     | Per-instance PVC size.                                             |
| `postgres.databaseName`          | `openwhispr`                                                               | Application database created at initdb.                            |
| `postgres.litellmDatabaseName`   | `litellm`                                                                  | Dedicated DB for the embedded LiteLLM chart (harmless if not used).|
| `postgres.backup.enabled`        | `false`                                                                    | Flip to enable barmanObjectStore S3 archival.                      |
| `pooler.enabled`                 | `true`                                                                     | CNPG Pooler CRD (transaction-mode).                                |
| `pooler.instances`               | `2`                                                                        | Pooler replicas.                                                   |
| `secrets.mode`                   | `helm-values`                                                              | One of `helm-values` / `eso` / `external-managed`.                 |
| `secrets.cnpgManaged`            | `false`                                                                    | When true, CNPG mints passwords; chart renders no Secret.          |
