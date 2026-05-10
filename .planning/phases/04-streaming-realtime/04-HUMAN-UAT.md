---
status: partial
phase: 04-streaming-realtime
source: [04-VERIFICATION.md]
started: 2026-05-10T23:04:17Z
updated: 2026-05-10T23:04:17Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 65-min live WSS realtime soak
expected: First completed run of `.github/workflows/nightly-realtime-soak.yml` (scheduled cron OR pushed tag) produces a green job with the `realtime-soak-log` artifact showing zero `isOurs: true` entries (no ingress-attributable 1001/1011 closes before T+3600s) and p95 ping RTT < 1000ms over the full 65 minutes. Verify via:
  gh run list --workflow=nightly-realtime-soak.yml --limit 5
  gh run download <run-id> --name realtime-soak-log
  jq '[.[] | select(.isOurs == true)] | length' soak-log.ndjson  # → 0
  jq '[.[].pingRttMs] | sort | .[((length*0.95)|floor)]' soak-log.ndjson  # → < 1000
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
