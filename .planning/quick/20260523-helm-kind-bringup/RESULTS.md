# Helm kind cluster bring-up — RESULTS

**Date:** 2026-05-23
**Branch:** main (chart fixes committed atomically)
**Base SHA at start:** `60e0e04b`
**Final HEAD:** `bfe3eed8`

## VERDICT: 🟢 GREEN — R20 fix proven live through kind cluster

Full sign-up → sign-in → get-session → notes-list (Bearer) → notes-create
cloud journey verified through a live kind cluster running the
`charts/openwhispr` Helm chart with `examples/values-kind.yaml` overlay.

```
✅ healthcheck       = 200
✅ sign-up           = 200  (user kind-r20@example.com created, token returned)
✅ sign-in           = 200  (bearer token=PJNUUVm1...)
✅ get-session       = 200  (bearer extracted from session)
✅ notes-list bearer = 200  ← R20 FIX LIVE-VERIFIED  ({"notes":[]})
✅ notes-create      = 201  (note id=6699dfa1-0621-4573-8019-a72d0dd61d2b)
```

R20 (the BLOCKER from the client-side audit — Bearer session.token
returning 401 on every sync route) is provably resolved in a real
Kubernetes cluster, not just unit/integration tests.

## Live pod state at moment of E2E success

```
NAME                                       READY   STATUS      AGE
openwhispr-api-559446484d-rch4l            1/1     Running     19m
openwhispr-litellm-89f9bc5bf-57lps         1/1     Running     79m
openwhispr-migrate-15-...                  0/1     Completed   2m
openwhispr-minio-5755767d8b-bbrz9          1/1     Running     19m
openwhispr-minio-console-6c86dfd8d-c6875   1/1     Running     19m
openwhispr-pg-1                            1/1     Running     79m
openwhispr-pg-pooler-...                   1/1     Running     2m  (2 replicas)
openwhispr-valkey-primary-0                1/1     Running     79m
openwhispr-web-857f4fd8b9-4j4tx            1/1     Running     79m
openwhispr-worker-...                      0/1     CrashLoopBackOff (server bug — deferred)
```

## Chart fixes committed during bringup (on local main)

| SHA | Subject |
|-----|---------|
| `360e740c` | fix(chart): surface INGRESS_BASE_URL + LITELLM_RETRY_* in api Deployment |
| `c80e8a20` | fix(chart): set S3_ENDPOINT for byok-guard boot check on api+worker |
| `eaf9515f` | fix(chart): wire S3 partner keys + OTLP-disabled sentinel for byok-guard |
| `bfe3eed8` | fix(chart): close remaining byok-guard kind bringup gaps |

## Net drift findings closed (11 distinct kind-bringup blockers)

The chart was last comprehensively verified in Phase 09.1/09.2. Drift
between then and 2026-05-23 introduced these gaps, all now closed:

1. `INGRESS_BASE_URL` missing from api Deployment env (R20 canonical knob)
2. `LITELLM_RETRY_*` knobs (A4) not exposed via values.yaml
3. `S3_ENDPOINT` not bound when `storage.enabled=true` (byok-guard wire-schema name vs MINIO_ENDPOINT legacy alias)
4. `S3_ACCESS_KEY/SECRET_KEY/BUCKET` partner-key triad missing (byok-guard demands when S3_ENDPOINT set)
5. `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` sentinel missing when observability sub-chart off
6. `INGRESS_TLS_CERT_PATH` byok-guard demand on `https://` INGRESS_BASE_URL — kind smoke needs `http://` override
7. `NODE_ENV=production` triggers SMTP_HOST demand — kind needs `development` (api + worker)
8. Worker Deployment missing INGRESS_BASE_URL env binding (api had it, worker also imports byok-guard)
9. `storage.enabled=false` chart default + byok-guard's unconditional S3_ENDPOINT demand → conflict; kind needs `storage.enabled=true`
10. `pooler.enabled=false` chart default → api template hardcodes `<fullname>-pg-pooler` hostname → ENOTFOUND at runtime; kind needs `pooler.enabled=true`
11. Duplicate `worker:` YAML key in values-kind.yaml silently nuking nodeEnv override; merged + image overrides added for kind-local images (api, worker, web, migrate)

## Known-deferred (NOT chart bugs)

- **Worker bundle: `resolveLocalesDir` TypeError [ERR_INVALID_ARG_TYPE]** —
  `path` arg `undefined` in `apps/worker/dist/index.cjs:15488`. Real
  server-side bug, NOT byok-guard, NOT a chart wiring issue. Per hard
  rule "never edit production code only to make a test pass", deferred
  to a separate diagnostic phase. Worker is BullMQ consumer for
  transcriptions — does NOT block sign-up / notes journey.
- **`pooler.enabled=false` + `<fullname>-pg-pooler` hardcoded helper** —
  chart logical gap: when pooler is off, the DATABASE_URL helper should
  fall back to `<fullname>-pg-rw`, not produce an ENOTFOUND hostname.
  Worked around in kind by enabling pooler. Tracked as a future chart
  fix (helper conditional, not a bringup-blocker for kind).
- **Migrate image is `ghcr.io/openwhispr/openwhispr-migrate:0.9.0-rc1`
  but image is not publicly published** — worked around in kind by
  reusing the api image (bundles `/app/packages/data/dist/migrate.cjs`).
  Production overlays will need either the dedicated image published
  or the api-image-reuse pattern promoted to a chart default.

## Reproduction

```bash
# Bootstrap (already done — script idempotent)
bash charts/openwhispr/examples/kind-bootstrap.sh
bash charts/openwhispr/examples/cnpg-install.sh

# Build + load local images
for app in api worker web; do
  docker build -f apps/$app/Dockerfile -t openwhispr-$app:kind-local .
  kind load docker-image openwhispr-$app:kind-local --name openwhispr
done

# Install
helm dependency update charts/openwhispr
helm install openwhispr ./charts/openwhispr \
  -f charts/openwhispr/examples/values-kind.yaml \
  -n openwhispr --create-namespace --timeout=15m

# Verify
kubectl get pods -n openwhispr
kubectl port-forward -n openwhispr svc/openwhispr-api 4000:3000 &

# R20 journey
curl -sS http://localhost:4000/api/health
curl -sS -c jar -X POST -H 'content-type: application/json' \
  -d '{"email":"u@x.com","password":"correct-horse-battery","name":"U"}' \
  http://localhost:4000/api/auth/sign-up/email
curl -sS -c jar -X POST -H 'content-type: application/json' \
  -d '{"email":"u@x.com","password":"correct-horse-battery"}' \
  http://localhost:4000/api/auth/sign-in/email
BEARER=$(curl -sS -b jar http://localhost:4000/api/auth/get-session | jq -r .session.token)
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $BEARER" \
  http://localhost:4000/api/notes/list  # expect 200
```

## Cluster state at writing

- Cluster `openwhispr` LEFT UP for inspection.
- Run `kind delete cluster --name openwhispr` to clean up.
