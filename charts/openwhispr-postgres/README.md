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
  --version 1.0.0 \
  -f charts/openwhispr-postgres/examples/values-helm-values.yaml \
  --set-string secrets.ownerPassword=$(openssl rand -base64 24) \
  --set-string secrets.appPassword=$(openssl rand -base64 24)
```

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
