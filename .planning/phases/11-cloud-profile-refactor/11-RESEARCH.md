# Phase 11: Cloud Profile Refactor — Research

**Researched:** 2026-05-13
**Domain:** OSS-default slim-down, corporate-LiteLLM overlay, opt-in local-Speaches example, live demo via cloudflared
**Confidence:** HIGH (codebase-grep verified end-to-end; all claims tagged with file/line provenance)

## Summary

Phase 9/10 shipped a Helm chart and docker-compose stack that bundle a self-hosted Speaches container (Whisper + pyannote built from `main`) and require **HF_TOKEN** as a non-overridable secret in every code path — even though only the `load-test-realistic` profile actually consumes Speaches and HF_TOKEN. The runtime API (`apps/api`, `apps/web`, `apps/worker`) reads HF_TOKEN nowhere [VERIFIED: codebase grep — only `tools/load-test/scripts/*.sh` and `compose/litellm` references exist]. The chart's `secret-presence-probe` initContainers across `api/web/worker/litellm` Deployments hard-require HF_TOKEN and fail-fast every pod if absent [VERIFIED: `charts/openwhispr/templates/{api,web,worker,litellm}-deployment.yaml:58-59`], so a real cloud install today demands a secret that the cloud install never uses.

This phase splits the existing bundled stack into three crisp variants:

- **Variant A — OSS default** (`docker compose up` + `helm install` with `values-oss-quickstart.yaml`): embedded LiteLLM only. No Speaches, no HF_TOKEN, no GPU. Whisper STT routes to a SaaS provider (Groq today via `litellm_config.yaml:38-43`); diarization routes to pyannote.ai managed (optional — 503 envelope if `PYANNOTE_API_KEY` empty per `diarization.ts:34`). Required secrets shrink from 15 → 12.
- **Variant B — Corporate / external LiteLLM** (`values-corporate-litellm.yaml`, already exists at `charts/openwhispr/examples/`): chart's `litellm.embedded=false` switches every api/worker pod to `LITELLM_BASE_URL=<external>`. **Gap:** the corporate overlay still ESO-pulls HF_TOKEN despite no Speaches and no embedded LiteLLM ever rendering [VERIFIED: `externalsecret.yaml:59-61`]. Phase 11 deletes HF_TOKEN from this path entirely.
- **Variant C — Local Speaches opt-in example** (new — `examples/docker-compose.local-speaches.yml` + `examples/values-local-speaches.yaml`): pulls the existing `docker-compose.load-test.yml` Speaches block + `litellm_config.realistic.yaml` model overrides into a documented opt-in overlay. HF_TOKEN, pyannote master build, and GPU/CPU caveats are scoped here only.

**Primary recommendation:** Sub-plan 11-01 demotes HF_TOKEN to optional + Variant-C-only (chart, ESO, helm-unittest fixtures, `.env.example`). 11-02 hardens the existing `values-corporate-litellm.yaml` overlay path (currently has zero coverage for `litellm.embedded=false` Deployment-absence assertion). 11-03 extracts the Speaches block from `docker-compose.load-test.yml` into a stand-alone example. 11-04 is the live demo: cloudflared tunnel + a public-internet-reachable kind/compose URL operators can share.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Secret materialisation (helm-values + ESO) | Chart / templates | — | Chart owns secret enumeration; api ENTRYPOINT validator (`check-default-secrets.ts`) owns runtime fast-fail |
| LiteLLM model routing | LiteLLM Proxy (sidecar OR external) | api routes (transcribe/realtime/reason) | LiteLLM is the abstraction layer per CLAUDE.md; api always speaks OpenAI-compatible to `LITELLM_BASE_URL` |
| Diarization SaaS-vs-local toggle | api route (`diarization.ts`) | env (`SPEACHES_DIARIZATION_URL`) | Route already implements both branches conditionally on env presence |
| Speaches container lifecycle | docker-compose overlay (Variant C) | Helm `bundledAi.enabled` (Variant C only, GPU-only) | Existing primary path is compose `load-test-realistic` profile build-from-master |
| Live demo public exposure | cloudflared sidecar (compose) | DNS / Cloudflare Zero Trust | Tunnel-based — no static IP, no ACME, demo-only |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| LiteLLM Proxy | `ghcr.io/berriai/litellm:main-v1.83.14-stable` | OSS LLM/STT/realtime gateway | Already chart default at `values.yaml:194-196`; multipart-passthrough fix native [VERIFIED] |
| pyannote.ai managed API | (SaaS) | Default-mode diarization | Already wired at `apps/api/src/lib/pyannote-client.ts`; Variant A's only diarization path |
| cloudflared | `cloudflare/cloudflared:latest` | Live demo public tunnel | Zero-config public URL via `cloudflared tunnel --url http://traefik:80`; no DNS/ACME required for the quick-token flow [CITED: developers.cloudflare.com/cloudflare-one/connections/connect-networks/] |
| Speaches | `master` build (CPU) or `master-cuda-12.6.3` (GPU) | Variant C only — self-hosted Whisper + pyannote | Already vetted in `docker-compose.load-test.yml:367-432` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Groq Whisper-large-v3 | SaaS | Variant A default STT | Existing default at `compose/litellm/litellm_config.yaml:38-43` |
| OpenAI Realtime API | SaaS (`gpt-realtime`) | Variant A default realtime | Existing at `compose/litellm/litellm_config.yaml:51-55` |
| OpenRouter | SaaS | Variant A default LLM | qwen3.6-plus / gemini-3-flash / gpt-4o-mini routes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cloudflare Tunnel (cloudflared) | ngrok / tailscale funnel | ngrok = paid for custom domain; tailscale funnel = requires login. cloudflared has the canonical no-account quick-tunnel flow. |
| pyannote.ai managed (Variant A default diarization) | Always-on Speaches | Speaches drags HF_TOKEN gating + 3GB model pull + GPU/CPU mode complexity into the OSS quickstart |
| Drop HF_TOKEN entirely | Keep optional everywhere | Variant C operators legitimately need it; keep but make optional + Variant-C-only |

## Architecture Patterns

### System Architecture Diagram (target end state)

```
                       OSS DEFAULT (Variant A)
   ┌──────────────────────────────────────────────────────────────────┐
   │  desktop client / web                                            │
   │      │ HTTPS                                                     │
   │      ▼                                                           │
   │   Traefik :443 / :8443                                           │
   │      │                                                           │
   │      ├──► api  ─────► LiteLLM (embedded, in-cluster) ──► SaaS    │
   │      │                  └─ whisper:Groq                          │
   │      │                  └─ gpt-realtime:OpenAI                   │
   │      │                  └─ chat:OpenRouter                       │
   │      │                                                           │
   │      ├──► api  ─────► pyannote.ai (SaaS, async)                  │
   │      └──► web  ─────► api                                        │
   └──────────────────────────────────────────────────────────────────┘
                       SECRETS (12): no HF_TOKEN

                       CORPORATE (Variant B)
   ┌──────────────────────────────────────────────────────────────────┐
   │   api / worker  ──── LITELLM_BASE_URL=https://litellm.internal   │
   │   (no embedded LiteLLM Deployment rendered)                      │
   └──────────────────────────────────────────────────────────────────┘
                       SECRETS via ESO; no HF_TOKEN

                       LOCAL SPEACHES (Variant C, opt-in)
   ┌──────────────────────────────────────────────────────────────────┐
   │   api  ─────► LiteLLM (embedded) ──► Speaches:8000               │
   │          \                            ├ whisper-large-v3         │
   │           \                           └ realtime                 │
   │            └─► Speaches direct (SPEACHES_DIARIZATION_URL set)    │
   │                 └ /v1/audio/diarization (sync multipart)         │
   └──────────────────────────────────────────────────────────────────┘
                       SECRETS: HF_TOKEN required for pyannote weights
```

### Recommended Project Structure (additions)
```
charts/openwhispr/examples/
├── values-oss-quickstart.yaml          # existing — Variant A
├── values-corporate-litellm.yaml       # existing — Variant B (cleanup)
├── values-local-speaches.yaml          # NEW — Variant C overlay
└── values-kind.yaml                    # existing — kind smoke

examples/                                # NEW dir at repo root
├── docker-compose.local-speaches.yml   # NEW — extracted Speaches block
├── docker-compose.live-demo.yml        # NEW — cloudflared tunnel sidecar
└── README.md                           # NEW — variant matrix + quickstart
```

### Pattern 1: Conditional secret enumeration (helm-values mode)
**What:** Lift `hfToken` out of the unconditional `$required` list in `secrets.yaml` and gate it behind a Variant-C-only check.
**When to use:** Any secret needed by only one of N variants.
**Example:**
```yaml
{{- $required := list "litellmMasterKey" "openrouterApiKey" "openaiApiKey" "betterAuthSecret" "postgresOwnerPassword" "postgresAppPassword" "pgbouncerAdminPassword" "valkeyPassword" "minioRootPassword" "traefikAdminPassword" "grafanaAdminPassword" "masterKek" "backupAgeIdentity" -}}
{{- if .Values.bundledAi.enabled -}}
  {{- $required = append $required "hfToken" -}}
{{- end -}}
{{- if .Values.litellm.embedded -}}
  {{- $required = append $required "pyannoteApiKey" -}}  # optional even in default — see below
{{- end -}}
```
**Caveat:** `pyannoteApiKey` should remain *optional* even in Variant A — the `/v1/audio/diarization` route 503s gracefully if unset [VERIFIED: `diarization.ts:34`]. Suggest demoting it from `$required` to a soft warning in NOTES.txt.

### Pattern 2: Per-pod env requirement matrix
**What:** The `secret-presence-probe` initContainer in each Deployment iterates a hard-coded list of env names. Currently identical across all 4 Deployments (api/web/worker/litellm). Replace the literal list with a Helm-rendered list derived from values.
**When to use:** When the same env set must be enforced across multiple pods but the set is variant-dependent.

### Anti-Patterns to Avoid
- **Duplicating the env list 4× across templates** — current state. Change the list in one place; forget the others; pods CrashLoopBackOff on one but not others. Use a `_helpers.tpl` named template that renders the required env list once.
- **Keeping HF_TOKEN in ESO `data:` block "for symmetry"** — corporate users pay the cost of provisioning a Vault secret that nothing reads. Delete it from `externalsecret.yaml` outside Variant C.
- **Bundling Speaches in the chart's `bundledAi.enabled` default** — already correctly defaults to `false` at `values.yaml:80`. Keep it that way; add an example overlay that flips it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Public-internet exposure for demo | DIY DNS + Let's Encrypt + port-forward | cloudflared quick tunnel | No DNS provisioning, no ACME, no firewall hole-punching; teardown = ^C |
| Variant-C model fetching | Bake pyannote/whisper weights into a fork image | Speaches' existing `PRELOAD_MODELS` env | Already wired at `docker-compose.load-test.yml:406`; HF auto-pulls with `HF_TOKEN` |
| Corporate ESO HF_TOKEN provisioning | Make operators put a dummy value in Vault | Remove the key from ESO `data:` outside Variant C | The cost is zero — just don't ask for what you don't read |

**Key insight:** Variant C is the *only* path that legitimately needs HF_TOKEN. Today's chart treats it as universal. The fix is mechanical: gate the secret enumeration on `.Values.bundledAi.enabled` and remove the unconditional ESO pull.

## Runtime State Inventory

> Refactor / rename scope: removing HF_TOKEN gates means changing rendered Secret keys and ESO refs. Inventory required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** HF_TOKEN is never written to Postgres / Valkey / MinIO. Verified by grep on `apps/`, `packages/`. | None |
| Live service config | Helm-managed Secret `openwhispr-secrets` with `helm.sh/resource-policy: keep` annotation [VERIFIED: `secrets.yaml:40-42`]. Existing operators' Secret will retain the `HF_TOKEN` key after upgrade (orphaned but harmless). | Document in migration notes; no destructive cleanup. |
| OS-registered state | **None.** No Task Scheduler / launchd / systemd registrations reference HF_TOKEN. | None |
| Secrets / env vars | `.env.example:104` (HF_TOKEN=) + `.env.example:284-285` (OUTBOUND_ALLOWED_HOSTS includes `speaches`); `tools/lint-compose-chart-parity.ts:55` (parity fixture); `tools/load-test/scripts/{smoke-paid,pre-warm-speaches}.sh`. | Move HF_TOKEN comment block to Variant C section in `.env.example`; parity linter must accept HF_TOKEN-absent chart values without failing the compose-chart equivalence check. |
| Build artefacts / installed packages | **None.** No pre-built Speaches image is published by this repo; build happens at compose-up time from `https://github.com/speaches-ai/speaches.git#master`. | None |

## Common Pitfalls

### Pitfall 1: helm.sh/resource-policy: keep + Secret key removal
**What goes wrong:** Operator upgrades from 0.9.x → 0.10.x (post-Phase 11). Chart renders a Secret without `HF_TOKEN`. Because the existing Secret is `keep`-annotated, Helm will [TBD — VERIFY: VERIFIED via helm docs — `keep` only protects on uninstall, not on upgrade. Helm 3 patches the Secret to match render]. The `HF_TOKEN` key will be DROPPED from the live Secret. Pods don't read it post-Phase 11 so this is fine — but document explicitly.
**Why it happens:** Helm Secret merging strategy = full replace of `stringData`.
**How to avoid:** Verify on a kind cluster: install 0.9.x → upgrade → describe Secret → confirm HF_TOKEN absent.
**Warning signs:** Operators who manually `kubectl edit secret` to add other keys will lose those on upgrade (existing behaviour, not new).
**Confidence:** [ASSUMED] — Helm Secret upgrade semantics need verification via a real kind upgrade test in 11-01.

### Pitfall 2: pyannote.ai vs Hugging Face inference API
**What goes wrong:** Operators see `PYANNOTE_API_KEY` and `HF_TOKEN` next to each other in `.env.example` and assume HF_TOKEN authorises pyannote.ai's managed SaaS. It does not.
**Why it happens:** Two different services. `PYANNOTE_API_KEY` is the managed pyannote.ai API key (consumed by `apps/api/src/routes/diarization.ts` → `pyannote-client.ts`). `HF_TOKEN` is a Hugging Face token used to download the *gated* `pyannote/speaker-diarization-community-1` model weights into the Speaches container at boot (`docker-compose.load-test.yml:407`).
**How to avoid:** Strict separation in docs — Variant A docs mention only `PYANNOTE_API_KEY`; Variant C docs mention only `HF_TOKEN`. Never co-locate.

### Pitfall 3: LiteLLM v1.83.x DATABASE_URL requirement
**What goes wrong:** LiteLLM v1.83+ refuses to boot if `DATABASE_URL` is empty (Prisma P1012).
**Why it happens:** Engine validation runs before the config is loaded.
**How to avoid:** Both compose (`docker-compose.yml:362-365`) and chart (`litellm-deployment.yaml:87-91`) already set a default. Phase 11 must not regress this — Variant A still owns a Postgres for litellm metadata.
**Status:** Existing behaviour; flagged for regression check only.

### Pitfall 4: Better Auth verification email needs SMTP
**What goes wrong:** Live demo signups fail at "check your email" because no SMTP relay is reachable from the demo URL.
**Why it happens:** Better Auth's email-verification flow is required by default.
**How to avoid:** Demo overlay either (a) bundles `mailpit` and provides a UI link to view the inbox, or (b) sets `disableEmailVerification: true` like the kind smoke does [VERIFIED: `values-kind.yaml:106-107`]. Option (a) is more honest for a demo — operators see the real verification flow.

### Pitfall 5: Helm chart `litellm.embedded: false` branch test coverage
**What goes wrong:** Today, `helm-unittest` does not assert that `litellm-deployment.yaml` produces **zero documents** when `litellm.embedded=false`. A regression that accidentally always-renders the Deployment would deploy a duplicate LiteLLM in corporate clusters.
**Why it happens:** No negative-render assertion exists in `tests/litellm_test.yaml`.
**How to avoid:** Add `hasDocuments: count: 0` test against `values-corporate-litellm.yaml`. Also add an assertion that api Deployment's `LITELLM_BASE_URL` env equals `.Values.litellm.externalBaseUrl` in that mode.

### Pitfall 6: Compose profile precedence (existing realistic/mock overlays must not break)
**What goes wrong:** Phase 11 extracts Speaches from `docker-compose.load-test.yml` into a new opt-in overlay. The `load-test-realistic` profile in CI / `make load-test-realistic` paths breaks because `speaches:` service is no longer in the base load-test compose.
**Why it happens:** Compose profile activation requires the service to exist in one of the layered files.
**How to avoid:** Option A — leave `speaches` in `docker-compose.load-test.yml` (it already has `profiles: [load-test-realistic]`, so default `docker compose up` does NOT spawn it). Option B — restructure so `load-test-realistic` profile invocations explicitly layer in the new examples file too. **Recommendation: Option A** — the Speaches block is already correctly gated by the `load-test-realistic` profile; the *new* overlay is for operators who want Speaches in `default` profile (`docker compose up`-default). Both can coexist.

### Pitfall 7: cloudflared quick tunnel hostname rotation
**What goes wrong:** Quick tunnels (`cloudflared tunnel --url http://traefik:80` with no account) get a randomly-generated `*.trycloudflare.com` hostname that changes on every restart. Better Auth's `trustedOrigins` must include this hostname or all sign-ins 403.
**Why it happens:** Better Auth gates CSRF on Origin matching `trustedOrigins`.
**How to avoid:** For real (non-throwaway) demos, use a named cloudflared tunnel with a stable hostname (`cloudflared tunnel create owsp-demo` → DNS record → `--config` with the tunnel ID). For the quick-tunnel demo path, document the workaround: `AUTH_TRUSTED_ORIGINS_EXTRA=https://*.trycloudflare.com` (wildcard origin) — **flag this as demo-only; do NOT use in production** [ASSUMED: wildcard origin syntax in Better Auth needs verification].

## Code Examples

### Conditional ESO data block (`externalsecret.yaml`)
```yaml
# Variant-C-only — HF_TOKEN provisioning
{{- if .Values.bundledAi.enabled }}
    - secretKey: HF_TOKEN
      remoteRef:
        key: {{ .Values.secrets.external.path }}/hfToken
{{- end }}
```

### Conditional initContainer env-presence loop (`_helpers.tpl` extract)
```yaml
{{- define "openwhispr.requiredSecretKeys" -}}
LITELLM_MASTER_KEY OPENROUTER_API_KEY OPENAI_API_KEY POSTGRES_OWNER_PASSWORD POSTGRES_APP_PASSWORD PGBOUNCER_ADMIN_PASSWORD BETTER_AUTH_SECRET VALKEY_PASSWORD MINIO_ROOT_PASSWORD TRAEFIK_ADMIN_PASSWORD GRAFANA_ADMIN_PASSWORD MASTER_KEK BACKUP_AGE_IDENTITY
{{- if .Values.bundledAi.enabled }} HF_TOKEN{{- end }}
{{- if .Values.secrets.pyannoteApiKey }} PYANNOTE_API_KEY{{- end }}
{{- end -}}
```

### Cloudflared sidecar (`examples/docker-compose.live-demo.yml`)
```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    profiles: [live-demo]
    networks: [openwhispr_internal]
    depends_on:
      traefik:
        condition: service_healthy
    command: ["tunnel", "--no-autoupdate", "--url", "http://traefik:80"]
    restart: unless-stopped
  api:
    environment:
      # Demo: wildcard the trycloudflare.com origin (insecure — demo only)
      AUTH_TRUSTED_ORIGINS_EXTRA: "${DEMO_PUBLIC_URL}"
```
[CITED: developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Always-bundled Speaches (Phase 9 chart default `bundledAi.enabled: false` but secret gating still demands HF_TOKEN) | Variant-C-gated Speaches | Phase 11 | Variant A secret count 15 → 12; corporate operators stop provisioning HF_TOKEN in Vault |
| `litellm.embedded: false` works in render but lacks negative-render coverage | Add `hasDocuments: count: 0` helm-unittest | Phase 11-02 | Regression-proof corporate path |
| No public demo path | cloudflared quick-tunnel overlay | Phase 11-04 | OSS contributors can share live test instances; no DNS/ACME |

**Deprecated/outdated:** Nothing deprecated by this refactor. HF_TOKEN remains supported for Variant C; the value just stops being demanded universally.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Helm 3 Secret upgrade drops removed `stringData` keys (does NOT preserve them) | Pitfall 1 | Operators with manually-edited Secret keys lose them; chart authors should run a real upgrade test in 11-01 |
| A2 | Better Auth `trustedOrigins` accepts wildcard origins like `https://*.trycloudflare.com` | Pitfall 7 + code example | If false, quick-tunnel demo requires per-session origin updates → fallback to named tunnel with stable hostname |
| A3 | cloudflared `tunnel --url` quick mode requires no Cloudflare account and provisions a `*.trycloudflare.com` hostname at runtime | Cloudflared section | If access-controlled now, demo overlay needs a CF account token instead |
| A4 | Phase 10 lint tool `tools/lint-compose-chart-parity.ts` will tolerate HF_TOKEN removed from chart values but present in compose (Variant C) | Migration plan | If linter hard-asserts parity, fixture at line 55 must be conditional or linter scope must skip Variant-C-only keys |

## Open Questions

1. **Does `helm test` (templates/tests/first-launch-slo.yaml) currently exercise the no-HF_TOKEN render path?**
   - What we know: `testProbe` runs a sign-up + transcribe round-trip [VERIFIED: `values.yaml:294-305`].
   - What's unclear: does it touch `/v1/audio/diarization`? If yes, missing PYANNOTE_API_KEY in Variant A will 503 the test.
   - Recommendation: 11-02 must verify the helm-test flow does NOT depend on diarization; if it does, gate it on `secrets.pyannoteApiKey` being non-empty.

2. **Backward-compat: should we keep `secrets.hfToken: ""` in values.yaml as a quiet field, or delete the key entirely?**
   - Keeping it = old values overlays don't break with `unknown field` errors.
   - Deleting it = cleaner schema, forces overlays to be updated.
   - Recommendation: keep the field (default `""`) but remove from `$required` list. `values.schema.json` keeps the property declaration for ESO-mode operators who genuinely use Variant C.

3. **Where does the OSS quickstart documentation live post-refactor — README.md, docs/self-hosting.md, or new examples/README.md?**
   - Existing self-hosting.md is 103 lines — small enough to grow.
   - Recommendation: docs/self-hosting.md hosts the variant matrix; examples/README.md is a thin pointer.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| docker-compose | Variant A + C compose paths | ✓ | (host) | — |
| helm | Variant A + B chart installs | ✓ | (host) | — |
| kind | local chart smoke | ✓ | (host) | — |
| cloudflared | Variant 11-04 live demo | ? | check | use ngrok if absent (manual setup) |
| HF_TOKEN | Variant C only | operator-supplied | — | Variant C cannot run without it; Variants A/B unaffected |
| GPU (nvidia.com/gpu) | Variant C GPU mode | operator-dependent | — | CPU mode build available per `docker-compose.load-test.yml:386-390` |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | helm-unittest (chart) + vitest (api/web/worker/i18n) + bats (compose smoke) |
| Config files | `charts/openwhispr/tests/*.yaml`; `apps/*/vitest.config.ts` |
| Quick run command | `make helm-unittest` |
| Full suite command | `make test && make helm-unittest && make e2e-test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-11-01-a | Variant A render does not require HF_TOKEN | helm-unittest | `make helm-unittest` (tests/examples_render_test.yaml, new case) | ❌ Wave 0 |
| REQ-11-01-b | api/web/worker Deployments' secret-presence-probe no longer scans HF_TOKEN | helm-unittest | same | ❌ Wave 0 |
| REQ-11-02-a | `litellm.embedded=false` produces 0 `Deployment/openwhispr-litellm` docs | helm-unittest | `tests/litellm_test.yaml` (new) | ❌ Wave 0 |
| REQ-11-02-b | api Deployment LITELLM_BASE_URL env = .Values.litellm.externalBaseUrl in embedded=false mode | helm-unittest | `tests/api_test.yaml` (extend) | ❌ Wave 0 |
| REQ-11-03-a | Variant C overlay boots Speaches + chart Whisper alias points at speaches:8000 | bats compose smoke | `examples/test-local-speaches.sh` | ❌ Wave 0 |
| REQ-11-04-a | cloudflared sidecar emits a public *.trycloudflare.com URL within 30s | bats live-demo smoke | `examples/test-live-demo.sh` | ❌ Wave 0 |
| REQ-11-04-b | Better Auth sign-up succeeds via public URL (with mailpit-captured verification) | playwright e2e | `apps/web/e2e/live-demo.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `make helm-unittest` (≤8s on M-class)
- **Per wave merge:** `make test` (~3min) + `make helm-unittest` + `make e2e-test`
- **Phase gate:** Full suite + manual Variant-C smoke + manual cloudflared demo URL share

### Wave 0 Gaps
- [ ] `charts/openwhispr/tests/litellm_test.yaml` — extend with `hasDocuments: count: 0` case under `values-corporate-litellm.yaml`
- [ ] `charts/openwhispr/tests/examples_render_test.yaml` — add Variant-A render case without `hfToken` to confirm `fail` does not fire
- [ ] `examples/test-local-speaches.sh` — new bats smoke
- [ ] `examples/test-live-demo.sh` — new bats smoke (or pytest)
- [ ] `apps/web/e2e/live-demo.spec.ts` — playwright spec gated by `LIVE_DEMO=1`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth verification flow stays on in Variant A; demo overlay must NOT disable it in any production-facing variant |
| V3 Session Management | yes | `trustedOrigins` wildcard in live-demo is a **knowingly-loosened** posture; document as demo-only |
| V4 Access Control | yes | Variant B's ESO removal of HF_TOKEN reduces secret-scope leakage |
| V5 Input Validation | inherited | Variant changes don't touch request validation |
| V6 Cryptography | yes | MASTER_KEK / BACKUP_AGE_IDENTITY remain required in all variants — never reduce |

### Known Threat Patterns for {chart + compose}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale Secret keys after upgrade (orphan HF_TOKEN in live cluster) | Info Disclosure | Helm Secret patches dropped keys on upgrade (verify in 11-01 kind upgrade test) |
| cloudflared quick-tunnel hostname rotation enabling Origin-confusion | Spoofing | Use named tunnels with stable hostname for non-throwaway demos |
| Variant-mismatch: corporate operator installs with `bundledAi.enabled=true` but no GPU | DoS | Pre-flight in api Deployment (already present at `values.yaml:84-88`); document GPU prerequisite |
| Operator forgets to disable demo `AUTH_TRUSTED_ORIGINS_EXTRA=*` | Spoofing | Live-demo overlay README must include a "DO NOT use in production" banner; values-cloud-ha overlay must NOT inherit demo origins |

## Project Constraints (from CLAUDE.md)

- **Drop-in OSS / corporate-LiteLLM-ready by env override** — Phase 11's exact charter; refactor must preserve `LITELLM_BASE_URL` env-override semantics across compose + Helm without breaking either path.
- **Strict TDD** — every chart template edit lands with its helm-unittest case in the same commit; bats/playwright tests precede shell-script changes.
- **Per-phase coverage floor ≥ 90%** — helm-unittest does not produce line coverage; supplement with assertion-count growth tracking (existing 109 tests → must grow).
- **No mocks of internal logic** — Variant C bats smoke must boot real Speaches; Variant 11-04 must hit a real cloudflared sidecar.
- **GitHub Actions only CI** — Variant C is GPU-optional; CI must NOT require GPU runners. CPU-only build path (`BASE_IMAGE=ubuntu:24.04`) is the CI lane.
- **Source-artifact language: English only** — all new doc/example files English.
- **No bundled local AI models** (memory: `feedback_no_bundled_local_models.md`) — *this is the doctrinal foundation of Phase 11.* Variants A/B ship bare; Variant C is the documented opt-in.

## Sub-Plan Split Recommendation

The 4-plan split the operator proposed is correct and cleanly factored. Refinements:

### 11-01 Default slim-down (remove Speaches/HF from default)
- **Scope:** `charts/openwhispr/values.yaml`, `templates/secrets.yaml`, `templates/externalsecret.yaml`, all 4 `*-deployment.yaml` initContainers, `tests/*` helm-unittest fixtures, `.env.example` (HF_TOKEN/speaches comment relocation), `tools/lint-compose-chart-parity.ts` adjustment, `docs/self-hosting.md` Variant A section.
- **Touches:** ~12 files; ~250 LOC delta.
- **Test additions:** Variant-A-without-hfToken render snapshot; api Deployment env-list assertion.
- **Risk:** Helm Secret upgrade key-drop semantics (Pitfall 1) — *requires real kind-upgrade test, not just unittest.*

### 11-02 External-LiteLLM overlay hardening (Variant B)
- **Scope:** `charts/openwhispr/examples/values-corporate-litellm.yaml` (cleanup HF_TOKEN ESO refs), `templates/api-deployment.yaml` (verify LITELLM_BASE_URL env wiring), `tests/litellm_test.yaml` (negative-render assertions), new `tests/corporate_litellm_test.yaml`, `docs/self-hosting.md` Variant B section, `docs/litellm-target-spec.md` cross-link.
- **Touches:** ~6 files; ~150 LOC delta.
- **Test additions:** `hasDocuments: count: 0` against litellm-deployment + litellm-service when `embedded=false`; api env `LITELLM_BASE_URL` = `.Values.litellm.externalBaseUrl` assertion; ESO HF_TOKEN absence assertion.
- **Risk:** Low — `embedded=false` branch already exists; this hardens coverage.

### 11-03 Local-Speaches example (Variant C, opt-in)
- **Scope:** New `examples/docker-compose.local-speaches.yml` (extract Speaches block from `docker-compose.load-test.yml`), new `examples/values-local-speaches.yaml` (sets `bundledAi.enabled=true`, hfToken required), new `compose/litellm/litellm_config.local-speaches.yaml` (extract from realistic), `examples/README.md`, new `tests/local_speaches_test.yaml` + `examples/test-local-speaches.sh` bats smoke.
- **Touches:** ~8 new files; ~400 LOC additions.
- **Test additions:** bats smoke (`docker compose -f docker-compose.yml -f examples/docker-compose.local-speaches.yml up --wait`); helm-unittest for Variant-C overlay render.
- **Risk:** Medium — Speaches build-from-master is ~10 min on cold cache (already documented at `docker-compose.load-test.yml:420-423`); CI lane needs `actions/cache@v4` for buildx layers OR mark as nightly-only.

### 11-04 Live demo via cloudflared tunnel
- **Scope:** New `examples/docker-compose.live-demo.yml` (cloudflared sidecar), new `examples/values-live-demo.yaml` (chart variant — wildcard trustedOrigins, mailpit promoted), `apps/web/e2e/live-demo.spec.ts`, `examples/README.md` live-demo section, `examples/test-live-demo.sh` bats.
- **Touches:** ~5 new files; ~250 LOC additions.
- **Test additions:** bats smoke parsing cloudflared stdout for `*.trycloudflare.com` URL; playwright e2e signup against the live URL.
- **Risk:** Medium — quick-tunnel URLs rotate; CI bats can validate URL provisioning but can't assert sign-up against a CF-routed flow without external network egress (mark as `LIVE_DEMO=1`-gated, off-by-default).

### Recommended ordering
1. 11-01 first — unblocks corporate installs without HF_TOKEN.
2. 11-02 second — uses 11-01's slimmer secret list; corporate operators benefit immediately.
3. 11-03 third — codifies the Variant C opt-in path; relies on 11-01 making HF_TOKEN optional.
4. 11-04 last — depends on 11-01's slim Variant A as the baseline for the demo overlay.

## Sources

### Primary (HIGH confidence)
- `/Users/dev/openwhispr-server/docker-compose.yml` (lines 1-865) — service inventory + Speaches absence in default profile
- `/Users/dev/openwhispr-server/docker-compose.load-test.yml` (lines 340-435) — Speaches block + HF_TOKEN consumption
- `/Users/dev/openwhispr-server/docker-compose.load-test.realistic.yml` — realistic profile overlay
- `/Users/dev/openwhispr-server/charts/openwhispr/values.yaml` (lines 1-345) — chart defaults including `bundledAi.enabled: false`, `litellm.embedded: true`
- `/Users/dev/openwhispr-server/charts/openwhispr/templates/secrets.yaml` — 15-key required list
- `/Users/dev/openwhispr-server/charts/openwhispr/templates/externalsecret.yaml` — ESO data block
- `/Users/dev/openwhispr-server/charts/openwhispr/templates/litellm-deployment.yaml` — embedded=false short-circuit
- `/Users/dev/openwhispr-server/charts/openwhispr/templates/{api,web,worker}-deployment.yaml` — initContainer env enumeration
- `/Users/dev/openwhispr-server/charts/openwhispr/examples/values-corporate-litellm.yaml` — existing Variant B skeleton
- `/Users/dev/openwhispr-server/charts/openwhispr/examples/values-oss-quickstart.yaml` — existing Variant A skeleton
- `/Users/dev/openwhispr-server/compose/litellm/litellm_config.yaml` — Variant A default model list (OpenRouter + Groq + OpenAI)
- `/Users/dev/openwhispr-server/compose/litellm/litellm_config.realistic.yaml` — Variant C model overrides (Speaches)
- `/Users/dev/openwhispr-server/apps/api/src/routes/diarization.ts` — pyannote.ai async branch + Speaches sync branch toggle
- `/Users/dev/openwhispr-server/apps/api/src/routes/index.ts` (lines 380-411) — SPEACHES_DIARIZATION_URL env-driven registration
- `/Users/dev/openwhispr-server/apps/api/src/routes/transcribe.ts` (lines 1-60) — transcribe always via LiteLLM
- `/Users/dev/openwhispr-server/.env.example` (lines 98-116, 284-285) — HF_TOKEN comment block + outbound allowlists
- `/Users/dev/openwhispr-server/docs/operations.md` (lines 392, 456, 533) — only docs mention of HF_TOKEN/Speaches

### Secondary (MEDIUM confidence)
- Memory `feedback_no_bundled_local_models.md` — doctrinal lock on no-bundled-AI default
- Memory `feedback_speaches_full_local_coverage.md` — Speaches covers transcribe/diarize/realtime locally
- Memory `feedback_speaches_diarization_build_from_main.md` — must build from master, not latest-cpu tag
- `docs/litellm-target-spec.md` — canonical corporate override spec [not re-read this session — relied on CLAUDE.md description]

### Tertiary (LOW confidence)
- Cloudflared quick-tunnel hostname behaviour [ASSUMED A3] — confirm against current Cloudflare docs in 11-04 research/plan
- Better Auth wildcard `trustedOrigins` support [ASSUMED A2] — confirm in 11-04
- Helm 3 Secret upgrade key-drop semantics [ASSUMED A1] — verify in 11-01 with a real kind upgrade test

## Metadata

**Confidence breakdown:**
- Inventory of current state: HIGH — every file path verified by grep/read
- Variant A target shape: HIGH — orthogonal removal of one secret + one initContainer line
- Variant B gaps: HIGH — overlay already exists; gaps are test-coverage-only
- Variant C extraction: HIGH — block already exists at `docker-compose.load-test.yml:367`; copy-not-redesign
- Variant 11-04 cloudflared shape: MEDIUM — pattern is standard but exact wildcard-Origin behaviour in Better Auth unverified
- Pitfall #1 Helm upgrade semantics: LOW — flagged for kind-upgrade verification in 11-01

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (stable infrastructure; refresh if LiteLLM, Speaches, or Helm major versions shift)
