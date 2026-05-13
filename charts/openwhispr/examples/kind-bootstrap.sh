#!/usr/bin/env bash
# Phase 09.1 — bootstrap a local kind cluster with every cluster-scoped
# prerequisite the chart requires:
#
#   * kind v0.31+      — multi-node cluster from kind-config.yaml
#   * cert-manager     — Issuer + Certificate CRDs (chart ships Certificate
#                        templates that target a self-signed ClusterIssuer
#                        bootstrapped here for the kind path)
#   * Traefik 3        — IngressRoute / Middleware CRDs + reverse proxy
#                        that the chart's IngressRoute templates target
#   * CNPG operator    — Cluster + Pooler CRDs that the chart's
#                        postgres-cluster.yaml + pooler.yaml depend on
#   * metrics-server   — HPA targets cpu/memory metrics; without this the
#                        HPA would never scale
#
# All steps are idempotent — running the script twice on the same cluster
# is a no-op upgrade. The script does NOT install Bitnami sub-charts;
# `helm install openwhispr` pulls those via Chart.lock.
#
# Exit codes:
#   0 — cluster ready, all CRDs Established, all operator pods Available
#   non-zero — pinpoint failure with kubectl event log
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-openwhispr}"
KIND_CONFIG="${KIND_CONFIG:-$(dirname "$0")/kind-config.yaml}"
CNPG_VERSION="${CNPG_VERSION:-0.24.0}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.16.2}"
TRAEFIK_VERSION="${TRAEFIK_VERSION:-33.2.1}"
METRICS_SERVER_VERSION="${METRICS_SERVER_VERSION:-3.12.2}"

log() { printf '\033[1;36m[kind-bootstrap]\033[0m %s\n' "$*"; }

# 1. kind cluster (idempotent — skip if already exists)
if kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  log "kind cluster '${CLUSTER_NAME}' already exists — reusing"
else
  log "creating kind cluster '${CLUSTER_NAME}' from ${KIND_CONFIG}"
  kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG}" --wait 5m
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}"

# 2. cert-manager (provides Issuer/Certificate CRDs)
log "installing cert-manager ${CERT_MANAGER_VERSION}"
helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo update jetstack >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version "${CERT_MANAGER_VERSION}" \
  --set crds.enabled=true \
  --wait --timeout 5m

# 2a. self-signed ClusterIssuer for the kind path (Certificate templates
#     in the chart default to ClusterIssuer name = "selfsigned-cluster-issuer")
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-cluster-issuer
spec:
  selfSigned: {}
EOF

# 3. Traefik 3 (provides IngressRoute/Middleware CRDs + reverse proxy)
log "installing Traefik ${TRAEFIK_VERSION}"
helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo update traefik >/dev/null
# Finding 09.1-F2 — entrypoint name must be ≤15 chars to satisfy the
# kubernetes ContainerPort.name IANA service-name spec, so the realtime
# entrypoint ships as `wsrealtime` (10 chars). The chart's
# `ingress.realtimeEntrypointName` default matches.
helm upgrade --install traefik traefik/traefik \
  --namespace traefik \
  --create-namespace \
  --version "${TRAEFIK_VERSION}" \
  --set 'ports.web.exposedPort=8080' \
  --set 'ports.websecure.exposedPort=8443' \
  --set 'ports.wsrealtime.port=8444' \
  --set 'ports.wsrealtime.exposedPort=8444' \
  --set 'ports.wsrealtime.protocol=TCP' \
  --set 'service.type=NodePort' \
  --set 'service.nodePorts.web=30080' \
  --set 'service.nodePorts.websecure=30443' \
  --set 'service.nodePorts.wsrealtime=30444' \
  --wait --timeout 5m

# 4. CloudNativePG operator (provides Cluster + Pooler CRDs)
log "installing CNPG operator ${CNPG_VERSION}"
helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
helm repo update cnpg >/dev/null
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system \
  --create-namespace \
  --version "${CNPG_VERSION}" \
  --wait --timeout 5m

# 5. metrics-server (HPA dependency; kind requires --kubelet-insecure-tls)
log "installing metrics-server ${METRICS_SERVER_VERSION}"
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ >/dev/null 2>&1 || true
helm repo update metrics-server >/dev/null
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --version "${METRICS_SERVER_VERSION}" \
  --set 'args[0]=--kubelet-insecure-tls' \
  --set 'args[1]=--kubelet-preferred-address-types=InternalIP\,ExternalIP\,Hostname' \
  --wait --timeout 5m

# 6. Verify CRDs are Established
log "verifying CRDs"
required_crds=(
  "certificates.cert-manager.io"
  "clusterissuers.cert-manager.io"
  "ingressroutes.traefik.io"
  "middlewares.traefik.io"
  "clusters.postgresql.cnpg.io"
  "poolers.postgresql.cnpg.io"
)
for crd in "${required_crds[@]}"; do
  kubectl wait --for=condition=Established crd/"${crd}" --timeout=120s
done

log "kind cluster bootstrap complete"
kubectl get nodes
kubectl get pods -A --field-selector=status.phase!=Running 2>/dev/null | head -20
