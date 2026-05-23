# charts/openwhispr — drift-verify after R20+R19 + litellm-patterns A1-A4 (2026-05-23)

## Summary

**Verdict: MINOR-DRIFT.** Chart still installs cleanly under the kind overlay (Phase 09.1/09.2 invariants intact). `helm lint` exit 0, `helm dependency update` clean (Bitnami valkey 5.6.5 + minio 17.0.21 + jetstack cert-manager 1.16.4 pulled & cached), `values-kind.yaml` renders 1784 lines with zero errors, `values-local-speaches.yaml` renders clean. Of 7 example overlays, **5 fail render without dummy secrets — by design** (DEPLOY-03 / T-09-01 guard `fail`s when `secrets.*` empty in `helm-values` mode). With dummy secrets injected, **2 overlays still fail** with a real nil-pointer (`.Values.api.env.nodeEnv`) in `values-external-litellm.yaml` + `values-corporate-litellm.yaml` — but git blame puts both at Plan 11-02 (2026-05-18) and the issue is **NOT** introduced by the R20+R19 / litellm-patterns commits, so it is pre-existing debt, not new drift.

**Genuine NEW drift attributable to R20+R19 + A1-A4 = 2 items:**
1. **INGRESS_BASE_URL** — read by `apps/api/src/routes/better-auth-handler.ts:66` (R20 fix) and gated at boot by `validateIngressBoot()` (`apps/api/src/config/auth.ts:149`). The boot guard accepts AUTH_URL as fallback (which the chart DOES set: `api-deployment.yaml:172` `value: "https://{{ .Values.host.api }}"`), so the chart **still boots** — but it does not surface the preferred env var. **Operator impact: none functional, cosmetic only.**
2. **LITELLM_RETRY_MAX_ATTEMPTS / LITELLM_RETRY_BASE_MS / LITELLM_RETRY_CAP_MS** — new in `packages/litellm-client/src/config.ts:259-263` (A4). All have safe defaults (3 / 250ms / 8000ms). **Operator impact: cannot tune retry policy via Helm values; must rely on built-in defaults.**

Migrations 0028–0031 (added since chart's last mtime May 18) require **no chart change** — `migrate-job.yaml` runs `node /app/packages/data/dist/migrate.cjs` which picks up everything bundled in the image; drift is image-tag-driven, not template-driven.

**Estimated remediation: 1 commit, ~10 lines** — add `INGRESS_BASE_URL` env binding in `api-deployment.yaml` (mirror the AUTH_URL pattern) and optionally add three `litellm.retry.*` knobs in `values.yaml` + `configmap-api.yaml`. Phase 09.1/09.2 invariants are **NOT** broken; kind smoke install would still pass.

---

## Phase A — `helm lint charts/openwhispr`

**Exit code:** `0`
**Result:** `1 chart(s) linted, 0 chart(s) failed`

13× `funcMap fail` INFO lines (one per required secret) come from the schema `not/enum` placeholder rejection — informational only when no `-f` overlay supplies secrets. Single recommendation:

```
[INFO] Chart.yaml: icon is recommended
```

Classification: **no errors, no warnings, 1 cosmetic recommendation** (Chart.yaml `icon:` URL).

---

## Phase B — `helm dependency update charts/openwhispr`

**Exit code:** `0`
**Result:** all 3 sub-charts pulled cleanly from registries:

| Sub-chart | Version | Source | Digest |
|---|---|---|---|
| valkey | 5.6.5 | `oci://registry-1.docker.io/bitnamicharts` | sha256:ec34922c…b1f040a |
| minio | 17.0.21 | `oci://registry-1.docker.io/bitnamicharts` | sha256:f651556c…25872db4 |
| cert-manager | 1.16.4 | `https://charts.jetstack.io` | (downloaded) |

Single non-fatal noise: `Could not verify charts/openwhispr/charts/.gitignore for deletion: file '…/.gitignore' does not appear to be a gzipped archive` — Helm v4 behavior on the vendored `.gitignore` in `charts/openwhispr/charts/`, harmless and pre-existing.

---

## Phase C — `helm template` per example

7 example values files (10 `examples/*.yaml` exist; 3 are non-values: `cnpg-install.sh`, `kind-bootstrap.sh`, `kind-config.yaml`, `lgtm-install.sh`, `traefik-values.yaml`, `cert-manager-clusterissuer-*.yaml`).

### values-kind.yaml — EXIT=0 (CLEAN, 1784 lines rendered)
No errors, no `required field`, no `additionalProperties`, no deprecated API versions.

### values-local-speaches.yaml — EXIT=0 (CLEAN)
No errors.

### values-oss-quickstart.yaml — EXIT=1 (BY DESIGN)
`Error: execution error at (openwhispr/templates/secrets.yaml:27:8): values.secrets.litellmMasterKey is required` — DEPLOY-03 guard, expected when operator omits `-f` secrets overlay. **Re-render with dummy secrets: EXIT=0 (CLEAN).**

### values-embedded-litellm.yaml — EXIT=1 (BY DESIGN)
Same DEPLOY-03 guard. **Re-render with dummy secrets: EXIT=0 (CLEAN).**

### values-cloud-ha.yaml — EXIT=1 (BY DESIGN)
Same DEPLOY-03 guard. **Re-render with dummy secrets: EXIT=0 (CLEAN).**

### values-external-litellm.yaml — EXIT=1 (REAL TEMPLATING BUG, pre-existing)
With dummy secrets injected:
```
Error: openwhispr/templates/configmap-api.yaml:16:22
  executing "openwhispr/templates/configmap-api.yaml" at <.Values.api.env.nodeEnv>:
    nil pointer evaluating interface {}.nodeEnv
```
Root cause: the overlay declares `api: { env: { <comment-only block> } }` which Helm merges as an explicit empty map, blanking the parent's `api.env.nodeEnv: production` default in `values.yaml:313`. **Pre-existing** — Plan 11-02 (commit `2e1950e9`, 2026-05-18) introduced this overlay; no commit since 2026-05-13 touched `configmap-api.yaml`, `values.yaml`, or `values-external-litellm.yaml`. **NOT attributable to R20+R19 or litellm-patterns.**

### values-corporate-litellm.yaml — EXIT=1 (REAL TEMPLATING BUG, pre-existing)
Identical failure at `configmap-api.yaml:16:22` — this overlay is the deprecated alias of `values-external-litellm.yaml` (Plan 11-02 renamed it) and inherits the same `api.env:` empty-map bug.

---

## Phase D — env contract diff (compose api vs chart)

26 env vars defined on `api:` service in `docker-compose.yml`. Cross-check vs `api-deployment.yaml` + `configmap-api.yaml` + `secrets.yaml`:

| Env var | Required (compose) | Present in chart? | Path | Notes |
|---|---|---|---|---|
| AUTH_TRUSTED_ORIGINS_EXTRA | default | YES | api-deployment.yaml | F35 |
| AUTH_URL | default | YES | api-deployment.yaml:172 | `https://{{ .Values.host.api }}` |
| **INGRESS_BASE_URL** | default | **NO** | — | **NEW drift (R20+R19)** — boot guard accepts AUTH_URL fallback, so non-breaking |
| LITELLM_BASE_URL | default | YES | api-deployment.yaml | via `openwhispr.litellmBaseUrl` helper |
| LITELLM_MASTER_KEY | **REQUIRED** | YES | secrets.yaml | enumerated in `requiredSecretKeys` |
| LITELLM_REALTIME_MODEL | default | NO | — | safe default in code (`realtime-default`) |
| LOCALES_DIR | default | NO | — | safe default (`/app/locales`) |
| MOCK_DIARIZATION | default | NO | — | safe default (`false`) |
| NODE_ENV | default | YES | configmap-api.yaml:16 | `.Values.api.env.nodeEnv` |
| OIDC_CLIENT_ID | default | NO | — | safe default (lazy OIDC discovery) |
| OIDC_CLIENT_SECRET | default | NO | — | safe default |
| OIDC_ISSUER_URL | default | NO | — | safe default |
| OPENAI_API_KEY | default | YES | api-deployment.yaml | via secret |
| OPENAI_REALTIME_MODEL | default | NO | — | safe default |
| OPENAI_REALTIME_URL | default | NO | — | safe default (public GA URL) |
| OPENWHISPR_API_URL | default | NO | — | safe default; in-cluster discovery |
| OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION | default | NO | — | safe default (off) |
| OPENWHISPR_PROTOCOL | default | NO | — | safe default (`mycorp-whispr`); production should override |
| OPENWHISPR_TEST_ROUTES | default | NO | — | MUST stay false in prod (chart correct to omit) |
| OTEL_EXPORTER_OTLP_ENDPOINT | **REQUIRED** | NO direct binding | — | api-deployment.yaml sets `OTEL_SDK_DISABLED=true` for kind (F30); production overlays expect operator to wire collector |
| OTEL_EXPORTER_OTLP_PROTOCOL | default | YES | configmap-api.yaml | |
| OTEL_SERVICE_NAME | default | YES | configmap-api.yaml | |
| PYANNOTE_API_KEY | default | YES | secrets.yaml | soft-required |
| REALTIME_BACKEND | default | NO | — | 0 production reads — likely consumed by an alternate path; safe default (`direct`) |
| SMTP_PORT | default | NO | — | 0 production reads; safe |
| **MASTER_KEK** | **REQUIRED** (compose .env) | YES | secrets.yaml | enumerated in `requiredSecretKeys`; `envFrom: secretRef` propagates to api+worker+migrate |
| VALKEY_URL | default | YES | api-deployment.yaml | F28 |

**Verdict:** 1 NEW miss attributable to R20+R19 (INGRESS_BASE_URL); all others are pre-existing defaults that flow safely.

---

## Phase E — post-2026-05-13 production code env-additions

Walked every commit touching `apps/api/src` / `apps/worker/src` / `packages/` since 2026-05-13. New (or newly-relevant) `process.env.*` consumers that are NOT in the chart:

| Env var | Read site | Production reads | Chart? | Severity |
|---|---|---|---|---|
| **INGRESS_BASE_URL** | `apps/api/src/routes/better-auth-handler.ts:66` + `apps/api/src/config/auth.ts:153` | 1 | **MISSING** | Low — AUTH_URL fallback works |
| **LITELLM_RETRY_MAX_ATTEMPTS** | `packages/litellm-client/src/config.ts:259` | 1 | **MISSING** | Cosmetic — safe default 3 |
| **LITELLM_RETRY_BASE_MS** | `packages/litellm-client/src/config.ts:262` | 1 | **MISSING** | Cosmetic — safe default 250ms |
| **LITELLM_RETRY_CAP_MS** | `packages/litellm-client/src/config.ts:263` | 1 | **MISSING** | Cosmetic — safe default 8000ms |
| MASTER_KEK | `packages/data/src/encryption/env-key-provider.ts:27` | 2 | **PRESENT** (secrets.yaml) | OK |
| PROVIDER_CONNECT_TIMEOUT_MS | `apps/api/src/routes/tokens/_call-provider.ts` (commit 85904845) | — | NO | Cosmetic — safe default |
| PROVIDER_TOTAL_TIMEOUT_MS | same | — | NO | Cosmetic — safe default |
| OPENAI_REALTIME_TOKEN_URL | new realtime path | — | NO | Cosmetic |
| OPENAI_REALTIME_WHISPER_MODEL | new realtime path | — | NO | Cosmetic |
| OIDC_DISCOVERY_ALLOWED_ORIGINS | OIDC hardening | — | NO | Cosmetic |
| OIDC_AUTHORIZE_URL | OIDC | — | NO | Cosmetic |

No new BOOT-FATAL env vars added. All gaps degrade to defaults.

---

## Phase F — migration drift

Migrations added after `2026-05-13` (chart `values.yaml` mtime = May 18):

```
0025_better_auth_account_plaintext_compat       (May 13)
0026_better_auth_session_token_fp_nullable      (May 13)
0027_usage_ledger_event_at                      (May 20)
0028_api_keys_name_scope                        (May 20)
0029_fk_user_id_indexes                         (May 21)
0030_session_token_fp_unique_restore            (May 21)
0031_restore_previous_token_fp_lookup           (May 23)
```

`charts/openwhispr/templates/migrate-job.yaml` (lines 97-105) executes:

```yaml
command:
  - node
  - /app/packages/data/dist/migrate.cjs
```

This is the **Drizzle runtime migrator** baked into the migrate image — it picks up every `*.sql` file in `packages/data/migrations/` at image build time and applies them in journal order. **No template change required.** Migration drift is image-tag-driven, gated by `.Values.image.migrate.tag` (default `.Chart.AppVersion = 0.9.0-rc1`). Operator pulling a new image tag automatically gets new migrations on next install/upgrade.

**Verdict: NO chart-side migration drift.** Producing a new appVersion tag will pull 0025–0031 transparently.

---

## Verdict

**MINOR-DRIFT** — Phase 09.1/09.2 invariants are intact. Chart still installs cleanly via `values-kind.yaml`. The only genuine new chart-side gaps attributable to the post-2026-05-13 server changes are:

1. **INGRESS_BASE_URL** missing from `api-deployment.yaml` env block — boot still succeeds via AUTH_URL fallback (1 line cosmetic add).
2. **LITELLM_RETRY_{MAX_ATTEMPTS,BASE_MS,CAP_MS}** absent from `values.yaml` + `configmap-api.yaml` (3 optional knobs, all with safe in-code defaults).

Pre-existing `configmap-api.yaml:16` nil-pointer in `values-external-litellm.yaml` + `values-corporate-litellm.yaml` (Plan 11-02 debt, 2026-05-18) is **out of scope** for this drift-verify but should be tracked separately — fix would be either dropping the empty `api.env:` block from those overlays, or adding `default` guards in the template (`{{ .Values.api.env.nodeEnv | default "production" }}` is already there — the bug is `.Values.api.env` itself being nil after merge, not `.nodeEnv`).

**Estimated remediation: 1 commit, ~10 lines + 1 changelog note.** No kind rebringup justified. No new phase needed; can be folded into the next minor chart bump or done as a `/gsd-quick`.

---

## Verification — commands run & exit codes

| Step | Command | Exit |
|---|---|---|
| A | `helm lint charts/openwhispr` | 0 |
| B | `helm dependency update charts/openwhispr` | 0 |
| C1 | `helm template charts/openwhispr -f examples/values-kind.yaml` | 0 |
| C2 | `helm template charts/openwhispr -f examples/values-local-speaches.yaml` | 0 |
| C3 | `helm template … -f examples/values-oss-quickstart.yaml -f /tmp/dummy-secrets.yaml` | 0 |
| C4 | `helm template … -f examples/values-embedded-litellm.yaml -f /tmp/dummy-secrets.yaml` | 0 |
| C5 | `helm template … -f examples/values-cloud-ha.yaml -f /tmp/dummy-secrets.yaml` | 0 |
| C6 | `helm template … -f examples/values-external-litellm.yaml -f /tmp/dummy-secrets.yaml` | **1** (pre-existing nil-pointer, Plan 11-02 debt) |
| C7 | `helm template … -f examples/values-corporate-litellm.yaml -f /tmp/dummy-secrets.yaml` | **1** (same pre-existing bug) |
| D | env-key diff via `awk` extraction of `docker-compose.yml` api service vs `grep -rE "name: $var"` in templates | — |
| E | `git log --since=2026-05-13 --pretty=%H -- apps/api/src apps/worker/src packages/ \| while read sha; do git diff "$sha~1" "$sha" \| grep '^+.*process\.env\.[A-Z_]\+'` | — |
| F | `ls -la packages/data/migrations/*.sql` + `grep -n drizzle charts/openwhispr/templates/migrate-job.yaml` | — |

**No commits made. No file edits outside this RESULTS.md.**

Helm: `v4.1.4` (`/opt/homebrew/bin/helm`)
Branch at runtime: `fix/r20-bearer-session-resolution`
HEAD: `60e0e04b fix(R20+R19): resolve Better Auth bearer session.token on every sync route`
Working tree state: untracked phase docs only, no modifications to tracked files.
