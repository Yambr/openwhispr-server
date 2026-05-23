---
status: fixing
trigger: "helm-upgrade-matrix.yml: helm upgrade --install traefik ... --wait --timeout 5m → context deadline exceeded on Yambr/openwhispr-server CI"
created: 2026-05-23T20:30:00Z
updated: 2026-05-23T20:30:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "helm --wait waits on Service of type=LoadBalancer to receive EXTERNAL-IP; kind has no LoadBalancer controller (no MetalLB / cloud-provider-kind), so EXTERNAL-IP stays <pending> forever, exhausting the 5m timeout — even though the Traefik pod itself reached Ready in 2 seconds."
  confirming_evidence:
    - "Pod traefik-98776975c-rkbmh: READY 1/1, STATUS Running, RESTARTS 0, Ready condition True, started in 2s after image pull"
    - "service/traefik: TYPE LoadBalancer, CLUSTER-IP 10.96.248.221, EXTERNAL-IP <pending>, age 5m at the moment of timeout"
    - "Pod logs show clean Traefik startup: 'Starting provider *crd.Provider', 'Creating in-cluster Provider client', no errors"
    - "No image-pull errors, no CRD errors, no webhook errors in describe events"
    - "Traefik chart defaults service.type=LoadBalancer (verified upstream); kind clusters do not ship a LoadBalancer implementation"
  falsification_test: "If hypothesis is wrong: setting service.type=ClusterIP on the install would NOT resolve the timeout. Conversely, if hypothesis is right: with ClusterIP, helm --wait completes in <30s once pod is Ready."
  fix_rationale: "Override service.type=ClusterIP in the CI step ONLY. Keep traefik-values.yaml default (LoadBalancer) — that is correct for real-operator cloud K8s. CI is a kind smoke environment with no LB, so it needs the override. This addresses root cause (Service never ready) not symptom (timeout)."
  blind_spots: "Cert-manager step uses --wait too but its Services are ClusterIP by default. The follow-up Helm install steps for OpenWhispr chart may also have LB-typed Services — but those failures (if any) would surface AFTER the Traefik fix and are separate."

next_action: "Add --set service.type=ClusterIP to the Install Traefik step in helm-upgrade-matrix.yml; commit and push; verify via fresh CI run."

## Symptoms

expected: "helm upgrade --install traefik traefik/traefik --version 32.1.1 -f traefik-values.yaml --wait --timeout 5m completes successfully within ~30-60s in kind"
actual: "Exits with 'Error: context deadline exceeded' after exactly 5 minutes on every run"
errors: "Error: context deadline exceeded"
reproduction: "Trigger helm-upgrade-matrix workflow (push to main on charts/** or workflow file)"
started: "First observed on run 26331965866; reproduced on 26342214899; both jobs (77519410532, 77546104692) show identical pattern"

## Eliminated

- hypothesis: "Image pull stall (ErrImagePull / ImagePullBackOff)"
  evidence: "describe events: 'Successfully pulled image docker.io/traefik:v3.1.6 in 1.506s'"
  timestamp: 2026-05-23T20:30:00Z
- hypothesis: "CRD registration race / 'no matches for kind'"
  evidence: "Pod logs clean: 'Starting provider *crd.Provider' with no errors"
  timestamp: 2026-05-23T20:30:00Z
- hypothesis: "Admission webhook init crashloop"
  evidence: "Pod restart count 0, Ready true, no webhook errors in pod logs or events"
  timestamp: 2026-05-23T20:30:00Z
- hypothesis: "Resource constraints (OOM/CPU starvation)"
  evidence: "Pod reached Ready True in 2s; QoS BestEffort but no OOM events; deployment.apps/traefik 1/1 ready"
  timestamp: 2026-05-23T20:30:00Z
- hypothesis: "wsrealtime port collision with kind NodePort range"
  evidence: "Service shows assigned NodePorts: 80:32750/TCP, 443:31590/TCP, 8443:30932/TCP — all in valid range, no collisions"
  timestamp: 2026-05-23T20:30:00Z

## Evidence

- timestamp: 2026-05-23T20:30:00Z
  checked: "kubectl get all -n traefik (from failure-dump step on job 77546104692)"
  found: "pod 1/1 Running, deployment 1/1 ready, but service/traefik EXTERNAL-IP <pending>"
  implication: "Pod-level readiness is fine; helm --wait blocks on Service readiness which never resolves without an LB"
- timestamp: 2026-05-23T20:30:00Z
  checked: "Traefik helm chart default values (chart 32.1.1)"
  found: "service.type defaults to LoadBalancer"
  implication: "kind clusters have no LoadBalancer controller by default; EXTERNAL-IP remains <pending> indefinitely"

## Resolution

root_cause: "Traefik chart's default service.type=LoadBalancer causes helm --wait to block waiting for EXTERNAL-IP assignment, which never happens in a kind cluster (no MetalLB / cloud-provider-kind in CI setup). The pod itself starts cleanly in 2 seconds."
fix: "Override --set service.type=ClusterIP in the Install Traefik step of .github/workflows/helm-upgrade-matrix.yml. Reference values file (charts/openwhispr/examples/traefik-values.yaml) intentionally keeps the LoadBalancer default for real-operator cloud K8s deployments."
verification: "(pending fresh CI run)"
files_changed:
  - .github/workflows/helm-upgrade-matrix.yml
