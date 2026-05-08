#!/usr/bin/env bash
# loki-roundtrip.sh — emit an OTLP log at the Collector and query Loki
# /loki/api/v1/query_range to confirm ingest. Uses the same in-network
# transient containers as otel-roundtrip.sh.
#
# Exit: 0 success, 1 assertion failed, 2 dependency error.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "loki-roundtrip: docker CLI not found" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "loki-roundtrip: jq not found" >&2
  exit 2
fi

PROBE_LABEL="loki_roundtrip_$(date +%s)"

echo "loki-roundtrip: emitting OTLP log via transient node container"
docker run --rm \
  --network openwhispr_openwhispr_internal \
  -e PROBE_LABEL="${PROBE_LABEL}" \
  node:24-alpine sh -c '
  set -e
  npm i --silent --no-fund --no-audit \
    @opentelemetry/sdk-logs@latest \
    @opentelemetry/api-logs@latest \
    @opentelemetry/exporter-logs-otlp-http@latest \
    @opentelemetry/resources@latest >/dev/null
  node -e "
    const { LoggerProvider, BatchLogRecordProcessor } = require(\"@opentelemetry/sdk-logs\");
    const { OTLPLogExporter } = require(\"@opentelemetry/exporter-logs-otlp-http\");
    const { logs } = require(\"@opentelemetry/api-logs\");
    const provider = new LoggerProvider();
    provider.addLogRecordProcessor(new BatchLogRecordProcessor(new OTLPLogExporter({ url: \"http://otel-collector:4318/v1/logs\" })));
    logs.setGlobalLoggerProvider(provider);
    logs.getLogger(\"roundtrip\").emit({ body: process.env.PROBE_LABEL, severityText: \"INFO\" });
    setTimeout(() => provider.shutdown().then(() => process.exit(0)), 2000);
  "
'

echo "loki-roundtrip: querying Loki for the probe label (5s settle)"
sleep 5

end_ns=$(date +%s)000000000
start_ns=$(( end_ns - 60000000000 ))

result=$(docker run --rm --network openwhispr_openwhispr_internal curlimages/curl:latest \
  -fsS --get \
  --data-urlencode 'query={job="otel-collector"}' \
  --data-urlencode "start=${start_ns}" \
  --data-urlencode "end=${end_ns}" \
  "http://loki:3100/loki/api/v1/query_range" || true)

if [ -z "$result" ]; then
  echo "loki-roundtrip: empty response from loki" >&2
  exit 1
fi

if ! printf '%s' "$result" | jq -e '.data.result | length > 0' >/dev/null; then
  echo "loki-roundtrip: loki returned no log streams" >&2
  printf '%s\n' "$result" >&2
  exit 1
fi

echo "loki-roundtrip: PASS"
exit 0
