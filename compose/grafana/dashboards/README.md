# k6 Prometheus Dashboard

`k6-prometheus.json` is dashboard ID **19665** ("k6 Prometheus") from
https://grafana.com/grafana/dashboards/19665, downloaded at
**phase 8 / plan 06 / 2026-05-12** via:

```
curl -fsSL "https://grafana.com/api/dashboards/19665/revisions/latest/download" \
  > compose/grafana/provisioning/dashboards/k6-prometheus.json
```

Post-download adjustments (so the existing `dashboards.yaml` provider
loads it without Grafana's import wizard prompting for a datasource):

1. `${DS_PROMETHEUS}` placeholders rewritten to the Mimir datasource UID
   (`mimir` — see `compose/grafana/provisioning/datasources/mimir.yaml`).
2. `__inputs` / `__elements` / `__requires` blocks removed.
3. Top-level `uid` set to `k6-prometheus-rw` so `GET /api/dashboards/uid/k6-prometheus-rw`
   is a stable lookup target.

The dashboard renders metrics emitted by k6's
`--out experimental-prometheus-rw` exporter, which the load-test
orchestrator (`tools/load-test/scripts/run.sh`) is wired to use
against the Mimir push endpoint at `127.0.0.1:9009/api/v1/push`.
