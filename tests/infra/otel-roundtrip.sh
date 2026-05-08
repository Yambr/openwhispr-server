#!/usr/bin/env bash
# otel-roundtrip.sh — emit a single OTLP/HTTP trace at the OTel Collector
# (host-published only via the otel-collector container's exposed 4318? No —
# the Collector is internal-only on openwhispr_internal; this script invokes
# the emitter from inside the otel-collector network namespace via
# `docker compose run` against a transient Node container so we do not need
# to publish 4318 to the host).
#
# Then queries Tempo's /api/search via Grafana's Traefik route to confirm
# the span surfaced. Tempo, like the rest of the LGTM stack, is internal;
# we use the Traefik grafana.localhost route's tempo proxy via Grafana's
# datasource API.
#
# Exit: 0 success, 1 assertion failed, 2 dependency error.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "otel-roundtrip: docker CLI not found" >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "otel-roundtrip: curl not found" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "otel-roundtrip: jq not found" >&2
  exit 2
fi

echo "otel-roundtrip: emitting test span via transient node container on openwhispr_internal"
docker run --rm --network openwhispr_openwhispr_internal node:24-alpine sh -c '
  set -e
  npm i --silent --no-fund --no-audit \
    @opentelemetry/sdk-node@latest \
    @opentelemetry/exporter-trace-otlp-http@latest \
    @opentelemetry/api@latest >/dev/null
  node -e "
    const { NodeSDK } = require(\"@opentelemetry/sdk-node\");
    const { OTLPTraceExporter } = require(\"@opentelemetry/exporter-trace-otlp-http\");
    const { trace } = require(\"@opentelemetry/api\");
    const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter({ url: \"http://otel-collector:4318/v1/traces\" }) });
    sdk.start();
    trace.getTracer(\"roundtrip\").startSpan(\"probe\").end();
    setTimeout(() => sdk.shutdown().then(() => process.exit(0)), 2000);
  "
'

echo "otel-roundtrip: querying Tempo for spans (5s settle)"
sleep 5

# Query Tempo from a sidecar container on the same network.
result=$(docker run --rm --network openwhispr_openwhispr_internal curlimages/curl:latest \
  -fsS "http://tempo:3200/api/search?tags=service.name=unknown_service" || true)

if [ -z "$result" ]; then
  echo "otel-roundtrip: empty response from tempo" >&2
  exit 1
fi

if ! printf '%s' "$result" | jq -e '.traces | length > 0' >/dev/null; then
  echo "otel-roundtrip: tempo returned no traces" >&2
  printf '%s\n' "$result" >&2
  exit 1
fi

echo "otel-roundtrip: PASS"
exit 0
