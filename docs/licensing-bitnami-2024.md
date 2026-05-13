# Bitnami Sub-Chart Licensing (2024 Change) and Corporate-Override Path

OpenWhispr Server's Helm chart (Phase 09) vendors two Bitnami sub-charts as
dependencies (decision A5 in `.planning/phases/09-helm-chart-and-cloud-deploy/09-DISCUSS-BLOCKERS.md`):

| Sub-chart | Pinned version | Repository |
|-----------|----------------|------------|
| `valkey`  | 5.6.5  | `oci://registry-1.docker.io/bitnamicharts` |
| `minio`   | 17.0.21 | `oci://registry-1.docker.io/bitnamicharts` |

In August 2025, Broadcom-owned Bitnami announced a [licensing change to its
container catalog](https://github.com/bitnami/containers/issues/83267): hardened
images, long-LTS variants, FIPS images, and the broader stable image stream
moved behind a paid **Bitnami Secure Images** subscription. Free-tier images
remain available, but at a reduced refresh cadence and without enterprise-grade
support guarantees.

## What this means for OpenWhispr Server operators

1. **The Helm charts themselves remain Apache 2.0.** The 2024/2025 change
   covers the **container images** the charts reference, not the chart source.
   We can keep vendoring the chart Y-files via `helm dependency update`
   indefinitely without license cost.

2. **The default container images the charts pull may rotate or fall behind.**
   The free-tier `bitnami/valkey` and `bitnami/minio` images still ship, but
   their hardened/FIPS variants do not, and Bitnami may EOL the free images
   without long warning. Production operators planning multi-year deployments
   should not rely on free Bitnami images as a forever-stable supply chain.

3. **Corporate override is supported and recommended at scale.** The chart's
   sub-chart values trees expose `image.registry`, `image.repository`, and
   `image.tag` overrides for both Valkey and MinIO. Corporate operators can
   override these to point at:

   - A subscribed `bitnamisecure/*` image stream (paid Bitnami Secure Images).
   - An internal registry that mirrors a vetted upstream Valkey / MinIO build
     (e.g., the upstream `valkey/valkey:8.x` from valkey.io and
     `minio/minio:RELEASE.YYYY-MM-DD…` from min.io).
   - A self-built image that follows the corporate base-image policy.

   Example overlay (`charts/openwhispr/examples/values-corporate-litellm.yaml`
   already uses this pattern for LiteLLM; see the same shape for valkey/minio):

   ```yaml
   valkey:
     image:
       registry: registry.corp.example.com
       repository: vetted/valkey
       tag: "8.0.2-corp1"
   minio:
     image:
       registry: registry.corp.example.com
       repository: vetted/minio
       tag: "RELEASE.2026-01-15T00-00-00Z-corp1"
   ```

## Option B: switch from sub-charts to operators (deferred)

A future enhancement (not implemented in Wave 1) is to allow operators to opt
out of the Bitnami sub-charts entirely and instead deploy via Kubernetes
operators they already run:

- **Valkey:** the [Valkey Operator](https://github.com/hyperspike/valkey-operator)
  or Redis Operator (KubeBlocks) creates `Cluster` CRs out-of-band; the chart
  would render a `Service` aliasing into the operator-managed instance.
- **MinIO:** the [MinIO Operator](https://github.com/minio/operator) handles
  the Tenant CR and the chart would create a TLS Secret and connection ConfigMap.

Operator-mode example overlays (deferred to a later plan):

- `charts/openwhispr/examples/values-cloud-redis-operator.yaml`
- `charts/openwhispr/examples/values-cloud-minio-operator.yaml`

Filing this in this doc rather than the chart README ensures the corporate
override path is one search away when an operator audits the supply chain.

## Citation

- Bitnami Containers maintainers, "Notice: Bitnami's Catalog Changes",
  GitHub Issue [bitnami/containers#83267](https://github.com/bitnami/containers/issues/83267)
  (announced August 2025, effective August 28th, 2025).
- Bitnami Helm Charts repository:
  [github.com/bitnami/charts](https://github.com/bitnami/charts) — license:
  Apache 2.0.
- Pinned versions in this repo: `charts/openwhispr/Chart.lock`.

Last reviewed: 2026-05-13.
