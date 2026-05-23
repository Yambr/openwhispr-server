---
slug: 3chart-split
status: in-progress
created: 2026-05-23
description: Split charts/openwhispr/ umbrella into 3 independent charts (openwhispr-server / -postgres / -litellm). Yank v0.9.1, target v1.0.0 with new layout.
---

# Plan: 3-chart split (Helm chart refactor, first public release shape)

## Why

User clarified the intended architecture for the FIRST public Helm release:
**3 mandatory minimal charts + everything else opt-in BYOK**. Operators with
existing infrastructure (their own LiteLLM, their own Postgres, their own
Valkey, MinIO, cert-manager, Traefik) install ONLY `openwhispr-server` and
point env vars at their cluster's services. Operators with empty clusters
install all 3 charts (+ CNPG operator prereq + cert-manager prereq).

User example: "у меня там wide moat computer use стек развернут — я не буду
поднимать ещё один litellm ради этого". So `openwhispr-server` must be a
clean standalone chart, no Chart.yaml deps, BYOK env first-class.

Previous Advisor #1 verdict (2a + 3a + 4c): 3 INDEPENDENT charts, naming
`openwhispr-{server,postgres,litellm}`, yank v0.9.1 (24h old, no adopters),
restart at v1.0.0. User confirmed.

Executor halted mid-scaffold on 6 structural holes Advisor #1 didn't
specify. Advisor #2 resolved all 6 (verdicts 1b/2a/3a/4c/5c/matrix-ify);
verdicts inlined below. Spec is now executable.

## Boundary table (frozen)

| Resource | server | postgres | litellm | BYOK env (if skipped) |
|---|---|---|---|---|
| api/web/worker Deployment+Svc+HPA+PDB+ServiceMonitor + ConfigMaps + IngressRoutes + Certificates + Middleware + OTel | YES | — | — | — |
| migrate-job + serviceaccount | YES | — | — | — |
| CNPG Cluster + Pooler + postgres-owner-secret + pooler-userlist-secret + backup config | — | YES | — | DATABASE_URL=, POSTGRES_APP_PASSWORD= |
| litellm Deployment+Svc+ConfigMap + LITELLM_MASTER_KEY ESO | — | — | YES | LITELLM_BASE_URL=, LITELLM_MASTER_KEY= |
| Valkey, MinIO, Speaches | DROP bundling | — | — | VALKEY_URL=, S3_*= |
| cert-manager | DROP from Chart.yaml deps; templates/issuer.yaml opt-in in server | — | — | prerequisite |

## Verdicts on the 6 holes (Advisor #2)

### 1. Cross-chart secret references → BYOK valueFrom refs (1b)

- Server chart values: `database.passwordSecretRef.{name,key}` (default `{{ .Release.Name | trimSuffix "-server" }}-postgres-app`, key `password`) and `litellm.masterKeySecretRef.{name,key}` (default `<prefix>-litellm-master-key`, key `master_key`).
- api Deployment uses `env: valueFrom: secretKeyRef:` for those 2 keys. Everything else stays `envFrom: secretRef: <release>-server-secrets`.
- **Gotcha:** `DATABASE_URL` must be assembled at pod startup via `args:` shell-expansion or initContainer — do NOT bake the string into ConfigMap. Pattern: `DATABASE_URL=postgres://$(POSTGRES_USER):$(POSTGRES_APP_PASSWORD)@$(DATABASE_HOST):5432/$(DATABASE_NAME)`.
- Result: single source of truth per credential, zero duplication, BYOK by ref-name override.

### 2. helm-values mode → split per chart (2a)

- Each chart gets its own `templates/secrets.yaml` gated by `secrets.mode == "helm-values"`, rendering only its own keys.
- Server: ~11 keys (BETTER_AUTH_SECRET, SMTP, OAuth client secrets, web-search keys, MASTER_KEK, S3 creds, Valkey password).
- Postgres: POSTGRES_APP_PASSWORD only (and ONLY if operator overrides CNPG's default auto-generated bootstrap — default path: CNPG generates it itself, no Secret rendered here).
- Litellm: LITELLM_MASTER_KEY only.
- **Gotcha:** when CNPG auto-generates the password, `database.passwordSecretRef` default must point at CNPG's emitted Secret (`<cluster>-app`), not the postgres chart's helm-values Secret. Document both paths in postgres README.

### 3. Release-name convention → convention + override (3a)

- Default: `database.host: {{ .Values.database.host | default (printf "%s-postgres-pg-pooler" (trimSuffix "-server" .Release.Name)) }}` (same pattern for litellm.baseUrl).
- Convention: operator installs `foo-server`, `foo-postgres`, `foo-litellm` (sharing `foo` prefix).
- Override: any operator can set `database.host` / `litellm.baseUrl` / `valkey.url` / `storage.endpoint` directly in values.
- **Gotcha:** if release name lacks `-server` suffix, `trimSuffix` is a no-op → default becomes `<full-release>-postgres-pg-pooler`. Surface this in values.schema.json `description:` rather than failing.

### 4. helm-unittest specs (28 files) → archive + fresh minimal (4c)

- Move existing `charts/openwhispr/tests/` to `charts-archive/openwhispr-unittest-pre-split/` (OUTSIDE `charts/` so `helm lint charts/*` doesn't try to parse it).
- Write 3-5 fresh helm-unittest specs per new chart: secret-ref defaults resolve, image tags pinned, ServiceMonitor/IngressRoute toggles work.
- Log full port to `.planning/deferred-items.md`.

### 5. values.schema.json per chart → hybrid (5c)

- Per-chart schemas keep operational-footgun preventers:
  - postgres: CNPG image PG-17 pin, replicas range
  - server: required-keys for own-Secret keys + `database.passwordSecretRef` shape
  - litellm: masterKey-required + image pin
- `additionalProperties: true` everywhere else.
- **Gotcha:** schema `required` for secret keys MUST be conditional on `secrets.mode == "helm-values"` via `if/then`, else ESO-mode installs falsely fail.

### 6. CI workflow scope → matrix-ify all 4 + create .cr.yaml (6)

Verified state (Advisor #2 read repo):
- 4 helm workflows exist: `helm-lint`, `helm-release`, `chart-release`, `helm-upgrade-matrix`
- NO `.cr.yaml` exists yet
- NO gh-pages branch (just bootstrapped in v0.9.1 retry — verify it's still there)
- `artifacthub-repo.yml` lives inside current `charts/openwhispr/` (will need 3 copies)

Plan:
- Create `.cr.yaml` at repo root pointing at `charts/` (chart-releaser auto-discovers all subdirs).
- Copy `artifacthub-repo.yml` into each of 3 new chart dirs.
- Convert all 4 workflows to `strategy.matrix.chart: [openwhispr-server, openwhispr-postgres, openwhispr-litellm]` (single file each, parallel jobs).
- **Gotcha:** `helm-upgrade-matrix` needs 2D matrix (chart × N-1→N version pair); pin `openwhispr-server` upgrades to also bump `openwhispr-postgres` in lockstep since DATABASE_URL contract crosses charts.

## Executable sequence

1. **Scaffold 3 dirs** `charts/openwhispr-{server,postgres,litellm}/` with `Chart.yaml` (apiVersion v2, version 1.0.0, appVersion 1.0.0, NO `dependencies:`), `values.yaml` stub.
2. **Move templates per boundary table.** Use `git mv` to preserve history. Rewrite cross-chart secret references per verdict 1b (`valueFrom: secretKeyRef:` for POSTGRES_APP_PASSWORD + LITELLM_MASTER_KEY in api Deployment; assemble DATABASE_URL via `args:` shell-expansion).
3. **Per-chart `templates/secrets.yaml`** gated by `secrets.mode == "helm-values"` (verdict 2a). Document CNPG auto-generated Secret path in postgres README.
4. **Helper functions** in each chart's `_helpers.tpl` implementing trimSuffix convention + explicit override (verdict 3a). Add README "Release-name convention" block.
5. **Archive 28 unittest specs** to `charts-archive/openwhispr-unittest-pre-split/`. Write 3-5 fresh helm-unittest specs per new chart (verdict 4c). Log full port to `.planning/deferred-items.md`.
6. **Per-chart `values.schema.json`** with hybrid validations + conditional `required` on `secrets.mode` (verdict 5c).
7. **CI:** create `.cr.yaml`, copy `artifacthub-repo.yml` into each chart, matrix-ify all 4 workflows (verdict 6). Verify gh-pages branch present (created during v0.9.1 release retry).
8. **Verify gh-pages branch still exists** — `git ls-remote origin gh-pages` (created during v0.9.1 retries; should not have been touched by yank).
9. **Delete `charts/openwhispr/`** ONLY AFTER chart-releaser confirms all 3 new tarballs publish cleanly (helm-release workflow on v1.0.0 tag).
10. **Atomic commits per step.** No tag push until orchestrator reviews helm-lint output.

## Acceptance

- 3 charts under `charts/` lint clean (`helm lint`).
- All 3 render via `helm template` for the 3 example values files.
- 4 helm workflows pass on next push to main.
- `charts-archive/openwhispr-unittest-pre-split/` exists outside `charts/`.
- `charts/openwhispr/` deleted.
- `.planning/deferred-items.md` has a "helm-unittest port to 3-chart shape" entry.
- v1.0.0 tag NOT pushed by executor — orchestrator handles after main CI green.

## Out of scope

- Tagging v1.0.0
- Pushing to OCI (workflows handle on tag)
- Re-publishing the 5 docker images (release.yml matrix unchanged)
- Fixing pre-existing reds (#7 test, #15 e2e-cjm peer regression)
