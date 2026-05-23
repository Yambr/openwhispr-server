#!/usr/bin/env bash
# Install the CloudNativePG operator at cluster scope (A2 prerequisite).
# Idempotent: re-running upgrades to the same chart version.
#
# Verified against CNPG 1.29 (STACK.md pin). Bump CNPG_VERSION when the
# operator publishes a new compatible release.

set -euo pipefail

CNPG_VERSION="${CNPG_VERSION:-0.24.0}"

helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system \
  --create-namespace \
  --version "${CNPG_VERSION}" \
  --wait \
  --timeout 5m

kubectl wait --for=condition=Available \
  --namespace cnpg-system \
  --timeout=300s \
  deployment/cnpg-cloudnative-pg

# Wait for the CRD to register — the operator pod can be Available
# before `kubectl get crd` shows the cloudnative-pg.io group.
kubectl wait --for=condition=Established \
  --timeout=120s \
  crd/clusters.postgresql.cnpg.io

echo "CloudNativePG operator ready. CRDs:"
# `|| true` — informational print, do not fail the install script if
# grep finds no match (the Established wait above is the real signal).
kubectl get crd 2>&1 | grep cloudnative-pg.io || true
