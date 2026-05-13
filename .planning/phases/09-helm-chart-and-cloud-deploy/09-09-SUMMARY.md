---
phase: 09
plan: 09
subsystem: helm-chart
tags: [helm, traefik, cert-manager, ingress, ingressroute, websocket, deploy-02]
requires:
  - 09-06 # api Deployment (initContainer chain extends secret-presence-probe)
provides:
  - traefik-ingressroute-api
  - traefik-ingressroute-realtime
  - traefik-ingressroute-web
  - cert-manager-certificate-api
  - cert-manager-certificate-web
  - traefik-preflight-initcontainer
affects:
  - charts/openwhispr/templates/api-deployment.yaml
tech-stack:
  added:
    - traefik.io/v1alpha1 (IngressRoute, Middleware, ServersTransport)
    - cert-manager.io/v1 (Certificate, ClusterIssuer pattern)
  patterns:
    - two-entrypoint topology (:443 short-JSON + :8443 long-WSS)
    - shared-cert reuse across entrypoints (D-21)
    - preflight initContainer guards operator-supplied prerequisites
key-files:
  created:
    - charts/openwhispr/templates/ingressroute-api.yaml
    - charts/openwhispr/templates/ingressroute-api-realtime.yaml
    - charts/openwhispr/templates/ingressroute-web.yaml
    - charts/openwhispr/templates/middleware-forwarded-headers.yaml
    - charts/openwhispr/templates/serverstransport-realtime.yaml
    - charts/openwhispr/templates/certificate-api.yaml
    - charts/openwhispr/templates/certificate-web.yaml
    - charts/openwhispr/examples/traefik-values.yaml
    - charts/openwhispr/examples/cert-manager-clusterissuer-letsencrypt.yaml
    - charts/openwhispr/examples/cert-manager-clusterissuer-internal-ca.yaml
    - charts/openwhispr/tests/ingress_test.yaml
  modified:
    - charts/openwhispr/templates/api-deployment.yaml
    - charts/openwhispr/values.yaml
    - charts/openwhispr/values.schema.json
    - charts/openwhispr/tests/api_test.yaml
decisions:
  - 'two IngressRoutes bound to distinct entrypoints (:443 + :8443) per Phase 04 Plan 05 lock-in'
  - 'ClusterIssuer (not namespaced Issuer) for cert-manager; default value letsencrypt-prod'
  - 'shared TLS Secret across both entrypoints (cert-reuse D-21)'
  - 'traefik-preflight initContainer ordered AFTER secret-presence-probe'
  - 'pitfall #3 enforced structurally — chart renders zero kind: Ingress resources'
metrics:
  duration: ~25min
  completed: 2026-05-13
  tasks: 3
  commits: 3
---

# Phase 09 Plan 09: Traefik IngressRoutes + cert-manager Summary

Templated two Traefik IngressRoute CRs (api short-JSON on :443, api realtime on :8443), a web catch-all IngressRoute, a ServersTransport with 3600s idleConnTimeout, a forwarded-headers Middleware, two cert-manager Certificate CRs, three operator-facing examples (Traefik install overlay + two ClusterIssuer patterns), and a `traefik-preflight` initContainer that fails the api pod fast if the operator's Traefik install lacks the `websecure-realtime` entrypoint.

## Commits

| Task | Commit  | Description |
| ---- | ------- | ----------- |
| 1    | 5502e55 | IngressRoutes + Middleware + ServersTransport + values + ingress_test |
| 2    | 9e78094 | cert-manager Certificate CRs + 3 examples + ingress_test cert assertions |
| 3    | 32bf75e | traefik-preflight initContainer in api-deployment + api_test assertions |

## Verification

- helm unittest: **92/92** (was 81 pre-wave, +11 from ingress_test 8 + api_test 3)
- `kind: Ingress` resources rendered against `.github/ci/values-ci.yaml`: **0** (pitfall #3 structurally enforced)
- yq/python equivalent: `examples/traefik-values.yaml`.ports.websecure-realtime.transport.respondingTimeouts.idleTimeout == "3600s" ✓
- Both example YAMLs parse cleanly under PyYAML safe_load.

## Two-entrypoint topology (Phase 04 Plan 05 parity)

| Entrypoint         | Port  | Routes                                                                   | Timeout regime                                |
| ------------------ | ----- | ------------------------------------------------------------------------ | --------------------------------------------- |
| websecure          | 443   | api `/api`, api `/v1/audio` (prio 100), web Host catch-all (prio 1)      | Traefik 3 defaults                            |
| websecure-realtime | 8443  | api `/v1/realtime` (prio 100, serversTransport openwhispr-realtime-transport) | idleConnTimeout 3600s + respondingTimeouts 0 |

Operator overlay (`examples/traefik-values.yaml`) declares both entrypoints under `ports.*` with matching transport timeouts. The chart-rendered ServersTransport sits on the OpenWhispr side of the proxy.

## cert-manager wiring

- `Certificate` CRs target `ClusterIssuer` `{{ .Values.certManager.clusterIssuer }}` (default `letsencrypt-prod`).
- Two example ClusterIssuers ship: LE-staging + LE-prod (HTTP-01 via Traefik) and internal-corp-ca (CA Secret reference).
- `tls.apiSecretName` defaults `openwhispr-api-tls`; `tls.webSecretName` defaults `openwhispr-web-tls`. Operators wanting a single cert across api+web set both to the same value.

## Pitfall #4 mitigation — traefik-preflight initContainer

- Curl probe of `http://traefik.traefik.svc.cluster.local:9000/api/entrypoints` (override via `values.ingress.preflightTraefikAdminUrl`).
- If response body does NOT contain `websecure-realtime`, the pod fails with a pointer to `examples/traefik-values.yaml`.
- Operators with bespoke Traefik admin-API topologies (RBAC-restricted admin, exposed on a different ClusterIP) toggle the check off with `--set ingress.preflightCheck=false`.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — IngressRoutes are external surface but match the pre-existing compose topology byte-for-byte; no new trust boundary introduced.

## Self-Check: PASSED

- All 11 created files exist on disk.
- Commits 5502e55, 9e78094, 32bf75e present in `git log`.
- helm unittest 92/92 green.
- `helm template … | grep -c '^kind: Ingress$'` returns 0.
