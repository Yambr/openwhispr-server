#!/usr/bin/env bash
# mimir-roundtrip.sh — emit an OTLP metric at the Collector and query Mimir
# /prometheus/api/v1/query to confirm ingest. Sets X-Scope-OrgID since Mimir
# requires the multi-tenancy header even in single-tenant mode.
#
# Exit: 0 success, 1 assertion failed, 2 dependency error.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "mimir-roundtrip: docker CLI not found" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "mimir-roundtrip: jq not found" >&2
  exit 2
fi

# X-Scope-OrgID is required by Mimir for every read query as well as the
# Collector's prometheusremotewrite exporter on the write path.
ORG_ID="openwhispr"

echo "mimir-roundtrip: emitting OTLP metric via transient node container"
docker run --rm \
  --network openwhispr_openwhispr_internal \
  node:24-alpine sh -c '
  set -e
  npm i --silent --no-fund --no-audit \
    @opentelemetry/sdk-metrics@latest \
    @opentelemetry/exporter-metrics-otlp-http@latest \
    @opentelemetry/api@latest >/dev/null
  node -e "
    const { MeterProvider, PeriodicExportingMetricReader } = require(\"@opentelemetry/sdk-metrics\");
    const { OTLPMetricExporter } = require(\"@opentelemetry/exporter-metrics-otlp-http\");
    const provider = new MeterProvider({
      readers: [ new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: \"http://otel-collector:4318/v1/metrics\" }),
        exportIntervalMillis: 1000,
      }) ],
    });
    const meter = provider.getMeter(\"roundtrip\");
    const counter = meter.createCounter(\"openwhispr_roundtrip_probe\");
    counter.add(1);
    setTimeout(() => provider.shutdown().then(() => process.exit(0)), 3000);
  "
'

echo "mimir-roundtrip: querying Mimir for the probe metric (5s settle)"
sleep 5

result=$(docker run --rm --network openwhispr_openwhispr_internal curlimages/curl:latest \
  -fsS -H "X-Scope-OrgID: ${ORG_ID}" \
  --get --data-urlencode 'query=openwhispr_roundtrip_probe' \
  "http://mimir:9009/prometheus/api/v1/query" || true)

if [ -z "$result" ]; then
  echo "mimir-roundtrip: empty response from mimir" >&2
  exit 1
fi

if ! printf '%s' "$result" | jq -e '.data.result | length > 0' >/dev/null; then
  echo "mimir-roundtrip: mimir returned no metric series" >&2
  printf '%s\n' "$result" >&2
  exit 1
fi

echo "mimir-roundtrip: PASS"
exit 0
