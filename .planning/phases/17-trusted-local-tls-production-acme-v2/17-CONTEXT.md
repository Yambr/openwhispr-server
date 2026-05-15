# Phase 17 — Context

**Phase:** 17 — Trusted Local TLS + Production ACME (v2)
**Date captured:** 2026-05-15
**Mode:** discuss (advisor-style research-backed; 4 parallel `gsd-advisor-researcher` agents)
**Locked requirements:** TLS-01..06 (6 reqs from REQUIREMENTS.md lines 496-501)

<domain>
A first-time operator runs `make tls-trust` once, and `https://web.localhost` / `https://api.localhost` open in their browser without a cert warning. Production deploys with `--with-ingress` (compose) or `ingress.enabled=true` (Helm) wire up Let's Encrypt ACME automatically. Dev CA artefacts are physically excluded from production container images (Komodia/Lenovo-Superfish CVE-class prevention).

This phase delivers HOW — research-backed mechanics for mkcert wiring, ACME resolver, cert-manager sub-chart, and dev-cert isolation. The WHAT is locked by ROADMAP.md success criteria.
</domain>

<pitfalls_correction>

**CRITICAL — surface in PLAN so reviewers don't repeat the mistake:**

ROADMAP and earlier discuss references cite "PITFALLS §16" for the dev-cert leakage CVE concern. The relevant pitfall is actually **§13 (mkcert in CI / mkcert in production)** in `.planning/research/PITFALLS.md`. §16 is about Visual regression / a11y — unrelated. All Phase 17 plan documents must cite §13.

Also: existing `tools/bootstrap.sh` (lines 358-371) currently mints certs with `*.localhost` and `*.example.test` wildcard SAN entries — directly contradicts the §13 hard rule "list each host explicitly". Phase 17 MUST drop these wildcards from the bootstrap SAN list as part of the cert-wiring work.

</pitfalls_correction>

<canonical_refs>
**MANDATORY reads for downstream agents:**

- `.planning/ROADMAP.md` — Phase 17 entry + 5 success criteria (lines ~784-795)
- `.planning/REQUIREMENTS.md` lines 496-501 — TLS-01..06
- `.planning/PROJECT.md` — core value + constraints
- `.planning/STATE.md` — milestone state (Phase 16 closed 2026-05-15)
- `.planning/research/PITFALLS.md` §13 — mkcert in CI / prod — authoritative constraint source
- `CLAUDE.md` — TDD, ≥90/90/90/90 coverage, no internal mocks, no `--legacy`, atomic commits
- `tools/bootstrap.sh` lines 287-399 — existing two-tier openssl cert chain (must de-wildcard SAN list 358-371)
- `compose/traefik/dynamic.yml` lines 130-133 — current cert reference (`/certs/local.crt` + `/certs/local.key`)
- `compose/traefik/dynamic.dev.yml` — dev profile (Phase 15 host split lives here)
- `compose/traefik/traefik.yml` — static config (entryPoints, providers; no ACME resolver today)
- `compose/docker-compose.ingress.yml` (Phase 14) — current Traefik 3 ingress overlay
- `charts/openwhispr/values.yaml` — existing `certManager.enabled` + `certManager.clusterIssuer` block
- `charts/openwhispr/templates/certificate-api.yaml`, `certificate-web.yaml` — existing cert-manager Certificate CRs (gated by `tls.enabled && certManager.enabled`)
- `charts/openwhispr/examples/cert-manager-clusterissuer-letsencrypt.yaml` — existing operator-applied dual ClusterIssuer staging/prod pattern
- `tools/lint-tdd.ts`, `tools/lint-colocated-tests.ts`, `tools/lint-phase-tag-comments.ts` — standalone-tsx-CLI lint precedent (Phase 15-01 + Phase 16-01)
- `lefthook.yml` + `package.json` + `.github/workflows/ci.yml` lint-english job — wiring triad pattern (atomic single commit)
- `tests/e2e-cjm/features/` — Phase 13 Gherkin harness shape
- `.planning/phases/16-phase-tag-comment-audit-v2/` — most recent 2-plan precedent (Phase 16 zero-`--no-verify` outcome)
</canonical_refs>

<code_context>

**Existing state (post-Phase-16 close):**

Compose / Traefik:
- `compose/traefik/traefik.yml` static config: 2 TLS entrypoints (`:443 websecure`, `:8443 websecure-realtime`), `:80 web` is redirect-only (308 → websecure). Comment at L17 says "No separate ACME" — that was for shared-cert reuse, not against ACME itself.
- `compose/traefik/dynamic.yml` L130-133: `tls.certificates` block references `/certs/local.crt` + `/certs/local.key` (single SAN-cert convention).
- `compose/traefik/dynamic.dev.yml` Phase 15 header (L16-22) anticipates Phase 17 provisioning explicit 5-host list.
- Live on-disk: `local.crt`, `local.key`, `root-ca.crt`, `root-ca.key` in `compose/traefik/certs/`.
- `compose/docker-compose.ingress.yml` (Phase 14): mounts `./compose/traefik/certs:/certs:ro` (bind-mount).

Helm:
- `charts/openwhispr/values.yaml` has `certManager.enabled: true` + `certManager.clusterIssuer: letsencrypt-prod`.
- `templates/certificate-api.yaml` + `certificate-web.yaml` render Certificate CRs gated by `tls.enabled && certManager.enabled`, referencing `kind: ClusterIssuer`.
- Chart.yaml currently has NO `cert-manager` sub-chart dependency.
- `tests/ingress_test.yaml` + `tests/tls_test.yaml` already cover `certManager.enabled` + `tls.enabled` cross-product.

Dockerfile inventory (12 Dockerfiles — Phase 15 inventory of 10 was stale by 2):
- `apps/api/`, `apps/web/`, `apps/worker/` — build context = repo root; root `.dockerignore` covers
- **`compose/traefik/Dockerfile`** — build context = `compose/traefik/`; current `COPY fd-probe.sh` is explicit (no `COPY . .`). **BUT** the build context contains live `root-ca.{crt,key}` + `local.{crt,key}` cert files. **A single future `COPY . .` regression = CVE-class leak.** Root `.dockerignore` does NOT apply to this sub-context — dockerignore is per-context.
- `compose/mock-litellm/`, `compose/postgres/`, `compose/pgbouncer/`, `images/cnpg-postgres-17-pgpartman/`, `tools/test-probe/`, `packages/contract-tests/`, `tests/fixtures/idp/`, `tests/e2e/mock-realtime/` — no cert COPY today, low risk

mkcert: NOT yet installed by repo tooling. Operators do it manually if at all today.

</code_context>

<decisions>

### Q1 — mkcert wiring: **A2 + B3 + C1 + D1**

- **A2:** `make tls-trust` regenerates certs ONLY if files absent OR expiring within 30 days (mirrors `bootstrap.sh:287-317` idempotency block). Cheap re-runs. No browser-trust churn.
- **B3:** Detect mkcert on PATH; on absence, fail with platform-specific install instructions (`brew install mkcert nss` on macOS, `apt install mkcert` on Linux, doc link for air-gap binary mirror). Mirrors `bootstrap.sh` age-keygen discovery pattern (lines 90-98). Air-gap path documented in `docs/operations.md#air-gap-mkcert` with binary mirror instructions. NO sudo, NO `--auto-install` flag.
- **C1:** ONE SAN cert covering the canonical 10-host list (post-WR-02 review fix, 2026-05-15): `localhost`, `api.localhost`, `web.localhost`, `app.localhost`, `auth.localhost`, `grafana.localhost`, `minio-console.localhost`, `mailpit.localhost`, `api.example.test`, `auth.example.test` (plus IPs `127.0.0.1` + `::1`). The list now matches `tools/bootstrap.sh:362-371` byte-for-byte — the prior 5-host subset (`api`/`web`/`app`/`grafana`/`mailpit` only) was a silent SAN downgrade against the parallel openssl path and would have hit a SAN-mismatch on the contract-test runner (`auth.localhost` is a Traefik network alias in `compose/docker-compose.ingress.yml`). Matches existing `dynamic.yml` `/certs/local.crt` + `/certs/local.key` wiring byte-for-byte. ZERO YAML edits to existing Traefik configs.
- **D1:** Overwrite bootstrap cert in place (`compose/traefik/certs/local.crt` etc.). Certs are gitignored runtime artefacts; overwrite is the correct semantic. First-run operators with existing checkout see the cert mutate — that's expected.

**Also (Q1 corollary):** `tools/bootstrap.sh` lines 358-371 — drop `*.localhost` + `*.example.test` wildcard SAN entries. Replace with explicit 5-host list + contract-test hosts (`api.example.test`, `auth.example.test`). PITFALLS §13 hard rule.

**Recommended Makefile target shape:**
```makefile
.PHONY: tls-trust
tls-trust:
	@command -v mkcert >/dev/null 2>&1 || { \
	  echo "mkcert not found in PATH."; \
	  case "$$(uname -s)" in \
	    Darwin) echo "  Install: brew install mkcert nss";; \
	    Linux)  echo "  Install: apt install mkcert  (or see docs/operations.md#air-gap-mkcert)";; \
	    *)      echo "  See docs/operations.md#air-gap-mkcert";; \
	  esac; exit 2; }
	@mkcert -install
	@mkdir -p compose/traefik/certs
	@# Idempotency: skip if local.crt valid >=30 days AND covers 5 explicit hosts AND no *.localhost wildcard.
	@if openssl x509 -checkend $$((86400*30)) -noout -in compose/traefik/certs/local.crt >/dev/null 2>&1 \
	   && openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:api.localhost' \
	   && ! openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:\*\.localhost'; then \
	  echo "tls-trust: cert valid + explicit host list — skip"; \
	else \
	  mkcert -cert-file compose/traefik/certs/local.crt \
	         -key-file  compose/traefik/certs/local.key \
	    api.localhost web.localhost app.localhost \
	    grafana.localhost mailpit.localhost; \
	  cp "$$(mkcert -CAROOT)/rootCA.pem" compose/traefik/certs/root-ca.crt; \
	  chmod 644 compose/traefik/certs/local.crt compose/traefik/certs/root-ca.crt; \
	  chmod 600 compose/traefik/certs/local.key; \
	fi
```

### Q2 — Production ACME + cert-manager Helm: **A3 + B3 + C3 + D1**

- **A3:** Single ACME HTTP-01 resolver in `compose/traefik/traefik.yml` with `LETSENCRYPT_STAGING` env toggle (mirrors existing Helm staging/prod ClusterIssuer pair). Production overlay activates resolver via env-driven `LETSENCRYPT_EMAIL`. Resolver is INERT until a router in `dynamic.prod.yml` opts in via `tls.certResolver: letsencrypt`.
- **B3:** `Chart.yaml` declares OPTIONAL `cert-manager` sub-chart dep with `condition: certManager.bundled`, **default `false`** (brownfield safety — most enterprise clusters already run cert-manager as platform component). Greenfield operators flip `--set certManager.bundled=true`. Sub-chart entry:
  ```yaml
  - name: cert-manager
    version: "1.16.4"
    repository: "https://charts.jetstack.io"
    condition: certManager.bundled
    alias: certManager
  ```
- **C3:** Issuer kind switch via `certManager.issuerKind` (default `ClusterIssuer` — backward-compatible with existing `certificate-*.yaml`). New template `templates/issuer.yaml` renders `(Cluster)Issuer` body when `certManager.renderIssuer: true`; when false (current state), chart only references externally-applied issuer.
- **D1:** NEVER wildcard. Per-host HTTP-01 only. SC #1 explicit-host rule.

**values.yaml certManager block extension (existing block stays; add new keys):**
```yaml
certManager:
  enabled: true             # existing — chart references cert-manager CRs
  clusterIssuer: letsencrypt-prod  # existing
  bundled: false            # NEW — bundle upstream jetstack/cert-manager sub-chart (default off; brownfield safe)
  issuerKind: ClusterIssuer # NEW — ClusterIssuer (default) or Issuer
  renderIssuer: false       # NEW — render (Cluster)Issuer body from this chart
  acmeEmail: ""             # NEW — required when renderIssuer=true
  acmeStaging: false        # NEW — flip true for LE staging endpoint
  installCRDs: true         # NEW — cert-manager sub-chart passthrough (only when bundled=true)
```

**Compose:** new `compose/docker-compose.acme.yml` overlay activates ACME via `LETSENCRYPT_EMAIL` + optional `LETSENCRYPT_STAGING=1`. Mounts named volume `letsencrypt:/letsencrypt`. `dynamic.prod.yml` routers add `tls.certResolver: letsencrypt` per-host.

### Q3 — Dev-cert isolation: **A2 + B1 + C1 + D1**

- **A2:** Expanded root `.dockerignore` entries + **NEW per-context `compose/traefik/.dockerignore`** (because Traefik build context is `compose/traefik/`, NOT repo root — root `.dockerignore` does NOT apply to sub-context per Docker semantics).

  Root `.dockerignore` additions:
  ```
  # TLS-05 / Phase 17 — dev-CA isolation (PITFALLS §13)
  **/rootCA*.pem
  **/root-ca.*
  **/*mkcert*
  **/*.localhost.pem
  **/*.localhost.key
  **/local.crt
  **/local.key
  compose/traefik/certs/
  .certs/
  ```

  NEW `compose/traefik/.dockerignore`:
  ```
  # TLS-05 / Phase 17 — per-context guard (root .dockerignore does NOT cover this context)
  certs/
  *.pem
  *.crt
  *.key
  *.srl
  ```

- **B1:** Standalone tsx CLI `tools/lint-dockerfile-tls.ts` mirroring Phase 15-01 + Phase 16-01 pattern. Greps each `Dockerfile` for forbidden patterns (mkcert paths, `rootCA*.pem`, `root-ca.*`, `*.localhost.{pem,key}`, `compose/traefik/certs/`). Allowlist file `tools/lint-dockerfile-tls.allowlist.txt`. Coverage ≥ 90/90/90/90 via `tools/__tests__/lint-dockerfile-tls.test.ts`. Wiring triad atomic (pnpm + lefthook + ci.yml line-append to `lint-english` job).
- **C1:** NEW Gherkin feature `tests/e2e-cjm/features/phase17-tls.feature` with 3 scenarios under `@phase-17 @tls` tags:
  1. `Scenario: mkcert dev cert is trusted by browser on first run` (`@cjm-tls-trusted-localhost` — required by ROADMAP §17 SC #5)
  2. `Scenario: production image contains no dev CA artefacts` (TLS-05 enforcement; `@cjm-tls-no-dev-ca-in-prod-image`)
  3. `Scenario: ACME staging endpoint issues cert via Traefik prod profile` (TLS-02-prod/TLS-03 enforcement; `@cjm-tls-acme-staging`)

  Scenario 2 step impl uses `docker create <image>` + `docker export | tar -t` for filesystem scan (no `docker run` needed; faster + works on distroless). Step defs in `tests/e2e-cjm/steps/tls.steps.ts`.
- **D1:** `compose/traefik/certs/` (status quo). D2 (outside-repo `~/.openwhispr/certs/`) was researcher's preferred recommendation but rejected for v2 — migrating bootstrap.sh output path + compose bind-mount paths + Windows/WSL UX research is too much scope for Phase 17. Sub-A2 per-context `.dockerignore` + Sub-B1 lint CLI + Sub-C1 Gherkin scan provide belt-and-suspenders defense at the existing location. **D2 logged as deferred for v3.**

### Q4 — Plan split + commit strategy: **Option B (3 plans)**

**DAG:**
- **Wave 1 (parallel):** 17-01 dev toolchain + 17-03 production ACME + Helm — disjoint file trees (`compose/traefik/dynamic.dev.yml` + `Makefile` vs `compose/traefik/dynamic.prod.yml` + `charts/openwhispr/`)
- **Wave 2:** 17-02 isolation enforcement — depends on 17-01 cert-path conventions (lint CLI predicate keys on `compose/traefik/certs/` path)

**17-01 — Dev toolchain** (TLS-01, TLS-02-dev, TLS-04):
- Files (~5): `Makefile` (new `tls-trust` target) + `compose/traefik/dynamic.dev.yml` (5-host SAN cert reference unchanged) + `compose/traefik/certs/.gitkeep` + `.gitignore` entries + `README.md` quickstart step + bootstrap.sh SAN de-wildcard
- ONE atomic commit (mirrors Phase 16 16-01 "wiring triad atomic" pattern)

**17-02 — Isolation enforcement** (TLS-05, TLS-06):
- Files (~8): `tools/lint-dockerfile-tls.ts` + tests + `tools/lint-dockerfile-tls.allowlist.txt` + `package.json` script + `lefthook.yml` block + `.github/workflows/ci.yml` append + root `.dockerignore` + new `compose/traefik/.dockerignore` + `tests/e2e-cjm/features/phase17-tls.feature` + `tests/e2e-cjm/steps/tls.steps.ts` + `docs/operations.md` air-gap section
- TWO commits:
  - (a) Lint CLI tooling triad atomic (lint + tests + allowlist + pnpm + lefthook + ci.yml — mirrors 16-01)
  - (b) Isolation evidence atomic (.dockerignore root + per-context + Gherkin feature + step defs + air-gap docs)

**17-03 — Production ACME + Helm** (TLS-02-prod, TLS-03):
- Files (~6): `compose/traefik/dynamic.prod.yml` (NEW) + `compose/docker-compose.acme.yml` (NEW overlay) + `compose/traefik/traefik.yml` (extend with ACME resolver) + `charts/openwhispr/Chart.yaml` (cert-manager dep) + `charts/openwhispr/values.yaml` (extend certManager block) + `charts/openwhispr/templates/issuer.yaml` (NEW) + helm-unittest tests
- TWO commits:
  - (a) Compose-plane atomic (traefik.yml ACME resolver + dynamic.prod.yml + docker-compose.acme.yml overlay)
  - (b) K8s-plane atomic (Chart.yaml dep + values.yaml extension + issuer.yaml template + helm-unittest)

**Total: ≈5 commits across 3 plans.**

**`--no-verify` policy: ZERO predicted.** Makefile/YAML/Helm-templates outside biome glob; lint CLI written pre-formatted from RED-test forward. If lefthook fires unexpectedly, HALT and document as ME-02 deviation per Phase 16 16-02 precedent — do NOT silently apply `--no-verify`.

### Q5 (Claude's discretion — no user input requested)

- Compose overlay naming: `compose/docker-compose.acme.yml` (matches existing `docker-compose.<concern>.yml` convention from Phase 14)
- ME-02 lefthook tracking: still deferred to follow-up (Phase 16 outcome confirmed Phase 17 won't hit it)
- Sweep commit body wording: each commit explicitly states what the test gate is (codemod tests, helm-unittest, lefthook lint CLI run on changed files)
- ROADMAP §17 SC #1 + #3 — PITFALLS §13 reference inserted where SC currently says §16 (one-line correction at same atomic commit as 17-02 evidence commit)
- README quickstart step: `make tls-trust` inserted as step 2 IMMEDIATELY after `cp .env.example .env`, before `docker compose up` (TLS-04)
- Air-gap doc section: `docs/operations.md#air-gap-mkcert` covers (1) macOS binary mirror URL, (2) Linux binary mirror URL, (3) checksum verification, (4) PATH installation, (5) `mkcert -install` without internet access caveat

</decisions>

<deferred>

Captured during discussion; NOT in Phase 17 scope:

1. **D2 cert-out-of-repo path** (`~/.openwhispr/certs/` bind-mount) — researcher's preferred Sub-D pick; rejected for v2 (bootstrap.sh rewrite + compose mount paths + Windows/WSL UX too large). Logged for v3 if dev-cert isolation needs the strongest possible guard.
2. **DNS-01 challenge / wildcard certs** — explicitly forbidden by SC #1; defer to v3 if cloud-scale deploys need them.
3. **mkcert `--auto-install` flag** — researcher rejected (sudo + non-Debian edge cases). Operators do platform-specific install manually.
4. **cert-manager 1.16.4 → 1.17.x bump** — current stable line is 1.16; if 1.17 GA's before Phase 17 lands, leave on 1.16.4 pin for stability.
5. **Hadolint / Trivy adoption** — researcher rejected (B2/C2); not needed when tsx CLI + filesystem-scan Gherkin cover the concern.
6. **mkcert CI integration** — explicitly forbidden by PITFALLS §13 ("CI test for TLS path uses openssl self-signed, NOT mkcert"). Bootstrap.sh's openssl path remains the CI cert generator.

</deferred>

<scope_guardrail>

**Phase 17 boundary is FIXED by ROADMAP.md:**
- IN scope: TLS-01..06 — exactly 6 requirements
- IN scope: PITFALLS §13 reference fix in ROADMAP/REQUIREMENTS where §16 is incorrectly cited (one-line edit)
- IN scope: `bootstrap.sh` SAN de-wildcard (Q1 corollary)
- OUT of scope: Phase 18 SSO SPEC, broader Dockerfile lint (Hadolint), wildcard certs, cert-out-of-repo migration, mkcert in CI

</scope_guardrail>

<next_steps>

1. `/gsd-plan-phase 17` — gsd-planner reads CONTEXT + REQUIREMENTS + ROADMAP + 4 PATTERNS/code analogs (Phase 15-01 lint CLI pattern, Phase 16-01 wiring triad, Phase 14 ingress overlay, existing certManager values block); produces 3 PLAN.md files (17-01, 17-02, 17-03), PATTERNS.md, PLAN-CHECK.md.
2. `/gsd-execute-phase 17` — Wave 1 parallel (17-01 + 17-03), Wave 2 sequential (17-02). Predicted ZERO `--no-verify`.
3. `/gsd-verify-phase 17` — verifier checks TLS-01..06 met, lint CLI coverage ≥ 90/90/90/90, helm-unittest GREEN, Gherkin scenarios authored (live execution deferred to GHA CI per Phase 15-16 precedent), PITFALLS §13 corrections in ROADMAP.
4. `/gsd-code-review` — review mkcert wiring + ACME resolver + cert-manager Helm + lint CLI + per-context `.dockerignore` + Gherkin features.

</next_steps>
