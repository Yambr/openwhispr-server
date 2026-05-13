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

echo "CloudNativePG operator ready. Verify CRDs:"
kubectl get crd | grep cloudnative-pg.io
