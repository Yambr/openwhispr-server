---
phase: 09
plan: 10
subsystem: helm-chart
tags: [helm, otel, observability, daemonset, rbac, deploy-02]
requires:
  - 09-06 # api/worker Deployments (existing api-servicemonitor wire-up survives)
provides:
  - otel-collector-daemonset
  - otel-collector-rbac
  - otel-collector-configmap-k8s
affects:
  - tools/compose-chart-parity.allowlist.json
  - tools/lint-compose-chart-parity.ts
tech-stack:
  added:
    - otel/opentelemetry-collector-contrib:0.115.0
    - kubeletstats + hostmetrics + k8sattributes receivers/processors
  patterns:
    - per-node DaemonSet with hostNetwork + hostPath for /proc + /sys
    - single otlphttp exporter (LGTM gateway demultiplexes by signal)
    - cluster-scoped read-only RBAC
key-files:
  created:
    - charts/openwhispr/templates/otel-collector-daemonset.yaml
    - charts/openwhispr/templates/otel-collector-configmap.yaml
    - charts/openwhispr/templates/otel-collector-serviceaccount.yaml
    - charts/openwhispr/templates/otel-collector-clusterrole.yaml
    - charts/openwhispr/templates/otel-collector-clusterrolebinding.yaml
    - charts/openwhispr/tests/otel_test.yaml
  modified:
    - charts/openwhispr/values.yaml
    - charts/openwhispr/values.schema.json
    - tools/compose-chart-parity.allowlist.json
    - tools/lint-compose-chart-parity.ts
decisions:
  - 'hostNetwork=true + hostPath /proc /sys — required for hostmetrics receiver (pitfall #12)'
  - 'single otlphttp exporter to values.observability.lgtm.endpoint replaces compose per-signal exporters'
  - 'kubeletstats replaces compose docker_stats receiver (K8s-native pod/container metrics)'
  - 'collector group gated on observability.collector.enabled (default false) — values-ci keeps it off, parity lint flips it on'
  - 'cluster-prereq allowlist: otel-collector removed (chart-rendered); LGTM ingest stays prerequisite per A3'
metrics:
  duration: ~20min
  completed: 2026-05-13
  tasks: 2
  commits: 2
---

# Phase 09 Plan 10: OTel Collector DaemonSet Summary

Ported the Phase 06 compose OTel Collector config to a Helm-rendered DaemonSet with least-privilege RBAC, one pod per node, hostNetwork + hostPath mounts so the hostmetrics + kubeletstats receivers work. A3 holds: chart ships **collector + ServiceMonitors only** — the LGTM ingest (Loki/Tempo/Mimir/Grafana/Prometheus) remains a cluster prerequisite.

## Commits

| Task | Commit  | Description |
| ---- | ------- | ----------- |
| 1    | 19a66c7 | ConfigMap + ServiceAccount + ClusterRole + ClusterRoleBinding + values + schema |
| 2    | ebec5cd | DaemonSet + otel_test (7 assertions) + parity allowlist trim + parity-lint helm args |

## Verification

- helm unittest: **99/99** (+7 from otel_test.yaml)
- vitest (parity): **29/29**
- parity CLI (`pnpm exec tsx tools/lint-compose-chart-parity.ts`): **PASS** — every compose service now has a chart resource or allowlist entry
- otel-collector resources rendered against ci values + `--set collector.enabled=true`: 5 (SA, ClusterRole, ClusterRoleBinding, ConfigMap, DaemonSet)

## Topology

| Receiver       | Source                                  | Notes                                                       |
| -------------- | --------------------------------------- | ----------------------------------------------------------- |
| otlp           | api/worker pushes (gRPC :4317, HTTP :4318) | Direct port-of compose otlp receiver                       |
| hostmetrics    | /hostfs/proc + /hostfs/sys              | Node-level CPU/mem/disk/network (requires hostNetwork)      |
| kubeletstats   | https://${K8S_NODE_NAME}:10250          | Pod/container metrics — replaces compose docker_stats       |
| prometheus     | 127.0.0.1:8888                          | Collector self-monitoring                                   |

Single exporter `otlphttp` -> `values.observability.lgtm.endpoint`. LGTM ingest demultiplexes by OTLP signal type (replaces compose's per-signal otlp/tempo, otlphttp/loki, prometheusremotewrite).

## Pitfall #12 mitigation

- DaemonSet uses `hostNetwork: true` + `dnsPolicy: ClusterFirstWithHostNet` so cluster DNS keeps working for the lgtm.endpoint resolution.
- Documented in template comment: release namespace MUST accept hostNetwork pods (PSA `privileged` label or a permissive PSP on legacy clusters). Operators on hardened namespaces should provision a dedicated `openwhispr-observability` namespace with the relaxed label.

## Compose-parity progress

| Service          | Status before Wave 3 | After Wave 3                                   |
| ---------------- | -------------------- | ---------------------------------------------- |
| `otel-collector` | allowlisted (cluster-prereq) | chart-rendered DaemonSet                |
| `traefik`        | allowlisted (cluster-prereq) | still allowlisted — chart ships only the **CRDs** (IngressRoute/Middleware/ServersTransport); Traefik itself stays an out-of-band install per examples/traefik-values.yaml |

`cluster-prereq` allowlist now contains only the LGTM ingest backends (`loki`, `tempo`, `mimir`, `grafana`, `prometheus`) plus `traefik`.

## Deviations from Plan

None — plan executed exactly as written. Biome flagged a pre-existing `optional-chain` style hint in `tools/lint-compose-chart-parity.ts:101` (untouched line); not in scope of this plan, deferred.

## Threat Flags

| Flag                         | File                                      | Description                                                                                          |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| threat_flag: privilege-scope | charts/openwhispr/templates/otel-collector-daemonset.yaml | DaemonSet runs `runAsUser: 0` + `hostNetwork: true` to access /proc + /sys; capabilities drop ALL and root filesystem is read-only, but the privilege footprint is wider than other workloads. ClusterRole is get/list/watch only (no secrets, no mutating verbs). |

## Self-Check: PASSED

- All 6 created files exist on disk.
- Commits 19a66c7, ebec5cd present in `git log`.
- helm unittest 99/99 green.
- parity CLI PASS; vitest 29/29.
