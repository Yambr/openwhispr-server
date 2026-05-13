#!/usr/bin/env bash
# Install a minimal LGTM observability stack (Loki, Grafana, Tempo, Mimir)
# at cluster scope (A3 prerequisite for ServiceMonitor / OTel Collector).
# Greenfield script — operators with an existing LGTM stack should skip this.
#
# Single-replica everything; not HA. Suitable for OSS quickstart and CI.

set -euo pipefail

NAMESPACE="${NAMESPACE:-monitoring}"

helm repo add grafana https://grafana.github.io/helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update grafana prometheus-community

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# Loki — single-binary mode.
helm upgrade --install loki grafana/loki \
  --namespace "${NAMESPACE}" \
  --set deploymentMode=SingleBinary \
  --set singleBinary.replicas=1 \
  --set loki.commonConfig.replication_factor=1 \
  --set loki.storage.type=filesystem \
  --set loki.auth_enabled=false \
  --wait --timeout 5m

# Tempo — single binary.
helm upgrade --install tempo grafana/tempo \
  --namespace "${NAMESPACE}" \
  --wait --timeout 5m

# Mimir — distributor + ingester single replicas.
helm upgrade --install mimir grafana/mimir-distributed \
  --namespace "${NAMESPACE}" \
  --set mimir.structuredConfig.common.storage.backend=filesystem \
  --wait --timeout 5m

# Grafana — sees the three datasources auto-configured at first launch.
helm upgrade --install grafana grafana/grafana \
  --namespace "${NAMESPACE}" \
  --set adminPassword="${GRAFANA_ADMIN_PASSWORD:-admin}" \
  --wait --timeout 5m

echo "LGTM stack ready in namespace '${NAMESPACE}'."
echo "Grafana port-forward:"
echo "  kubectl --namespace ${NAMESPACE} port-forward svc/grafana 3000:80"
