---
phase: 17-trusted-local-tls-production-acme-v2
reviewed: 2026-05-15T00:00:00Z
depth: deep
files_reviewed: 25
files_reviewed_list:
  - Makefile
  - tools/bootstrap.sh
  - README.md
  - compose/traefik/traefik.yml
  - compose/traefik/dynamic.prod.yml
  - compose/docker-compose.acme.yml
  - charts/openwhispr/Chart.yaml
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - charts/openwhispr/templates/issuer.yaml
  - charts/openwhispr/templates/certificate-api.yaml
  - charts/openwhispr/templates/certificate-web.yaml
  - charts/openwhispr/tests/issuer_test.yaml
  - charts/openwhispr/tests/subcharts_test.yaml
  - charts/openwhispr/tests/tls_test.yaml
  - tools/lint-dockerfile-tls.ts
  - tools/lint-dockerfile-tls.allowlist.txt
  - tools/__tests__/lint-dockerfile-tls.test.ts
  - tools/__tests__/fixtures/dockerfile-tls/good/Dockerfile
  - tools/__tests__/fixtures/dockerfile-tls/bad/Dockerfile
  - .dockerignore
  - compose/traefik/.dockerignore
  - tests/e2e-cjm/features/phase17-tls.feature
  - tests/e2e-cjm/steps/tls.steps.ts
  - docs/operations.md
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
fix_iteration: 1
fixed_at: 2026-05-15T11:35:00Z
fixed_in_branch: gsd-reviewfix/17-50594
fixed:
  WR-01: fixed (commit 1d7df7b — narrowed gherkin step via findDevCaArtefacts helper + 23 vitest assertions)
  WR-02: fixed (commits 4eac282 + 9479cbc — makefile aligned to 10 hosts + CONTEXT/REQUIREMENTS/ROADMAP updated)
  WR-03: fixed (commit 5621b8a — providers.file.filename moved to ingress-overlay CLI, no empty-string hack)
  WR-04: fixed (commit bd8c644 — set -e at top of multi-line shell command, smoke-confirmed fail-fast)
  WR-05: fixed (commits be8ed57 RED + 4118d26 GREEN — ingressClassName migration + values.yaml comment, 163/163 helm-unittest)
  IN-03: fixed (commit df1c2f4 — Scenario 4 traefik image dev-ca scan)
---

# Phase 17 — Code Review Report

**Verdict:** APPROVE-WITH-FOLLOWUP

Phase 17 delivers a coherent, well-scoped TLS story: mkcert-backed dev trust, env-driven ACME for prod, an optional cert-manager sub-chart, and defense-in-depth dev-CA isolation. TDD, atomic-commit, and zero `--no-verify` invariants all hold. No BLOCKER-class bugs or security vulnerabilities were surfaced. Five WARNING findings worth fixing before the next release; six INFO-class observations.

Two architectural items deserve emphasis in the follow-up:

1. The Scenario 2 "any bootstrap-minted cert" step is over-strict and will false-positive against every node-based prod image that vendors `ca-certificates` (WR-01).
2. The mkcert path mints a 5-host cert while `bootstrap.sh` mints 10; the idempotency predicate cannot detect the divergence and silently downgrades SAN coverage when an operator switches between paths (WR-02).

## Warnings

### WR-01 [FIXED 2026-05-15 — commit 1d7df7b]: Scenario 2 SAN-wildcard step false-positives on every node base image

**File:** `tests/e2e-cjm/steps/tls.steps.ts:123-137`
**Issue:** The step "any bootstrap-minted cert SAN list contains no wildcard entries" inspects the tar listing for any path ending in `.crt` or `.pem`, excluding only `node_modules`. Every node:slim / debian:slim derivative ships `/etc/ssl/certs/*.pem` (the `ca-certificates` bundle) — hundreds of trust-store entries. The current implementation will throw `prod image unexpectedly ships N cert/pem file(s)` against every realistic prod image, defeating the regression guard once Scenario 2 actually executes against a built image. The step name advertises a SAN-wildcard check but the implementation has nothing to do with SANs; it counts cert FILES.
**Fix:** Either (a) narrow the filter to paths under `compose/traefik/certs/` or filename `local.{crt,pem}` / `root-ca.*` / `rootCA*.pem` — the same forbidden tokens the upstream `Then`s already check, so the step becomes redundant and can be deleted, or (b) actually parse the SANs of any cert that lives outside the trust-store path and assert no `DNS:*.` entries. Recommend (a) — delete the step; the four prior `Then`s already exhaustively cover the surface this one was meant to catch.

### WR-02 [FIXED 2026-05-15 — commits 4eac282 + 9479cbc]: `make tls-trust` mints 5-host cert; `bootstrap.sh` mints 10; idempotency predicate cannot detect divergence

**File:** `Makefile:134-146` + `tools/bootstrap.sh:358-371`
**Issue:** `bootstrap.sh` re-enumerates 10 explicit hosts (`localhost`, `api.localhost`, `web.localhost`, `app.localhost`, `auth.localhost`, `grafana.localhost`, `minio-console.localhost`, `mailpit.localhost`, `api.example.test`, `auth.example.test`). `make tls-trust` mints only 5 (`api`, `web`, `app`, `grafana`, `mailpit`). An operator who ran `bootstrap.sh` first and then `make tls-trust` gets the cert silently overwritten with a smaller SAN set — `auth.localhost`, `minio-console.localhost`, `api.example.test`, `auth.example.test`, and bare `localhost` are dropped. Inverse order is also lossy. The idempotency predicate only checks for `DNS:api.localhost` presence and `DNS:*.localhost` absence — both true on either output, so a SAN downgrade is structurally undetectable. The contract-test runner relies on `auth.localhost` (`compose/docker-compose.ingress.yml:42-44` declares the Traefik alias) and will hit a SAN-mismatch on `make tls-trust` regen.
**Fix:** Align the host lists. Either (a) extend `make tls-trust` to mint the same 10 hosts `bootstrap.sh` does, or (b) tighten the idempotency predicate to require the union set: `grep -q 'DNS:auth.localhost' && grep -q 'DNS:web.localhost' && …`. CONTEXT Q1-C1 locked "5 explicit hosts" — that was incomplete given the parallel openssl path. Update CONTEXT + ROADMAP SC accordingly.

### WR-03 [FIXED 2026-05-15 — commit 5621b8a]: `traefik.yml` `providers.file.filename` leaks a stale path when the acme overlay flips to directory mode

**File:** `compose/traefik/traefik.yml:108-111` + `compose/docker-compose.acme.yml:55-63`
**Issue:** Base static config declares `providers.file.filename: /etc/traefik/dynamic.yml`. The acme overlay attempts to "switch" to directory mode by appending CLI flags `--providers.file.directory=/etc/traefik/dynamic` and `--providers.file.filename=` (empty). Traefik's CLI-flag-overrides-static-config behavior is real, BUT only the LATEST occurrence wins; an empty-string for `--providers.file.filename=` is parsed as "explicit empty" by Traefik 3 and typically clears the static value — yet this depends on Traefik 3's flag parser treating empty as unset, which is undocumented (the official upgrade docs recommend declaring only one of {filename, directory}). If the parser silently treats empty as `""` and still tries to read it as a path, Traefik logs `error reading file: open : no such file or directory` on every reload and the prod profile only works because the directory provider populates routes first. This is fragile.
**Fix:** Remove the `filename:` key from `traefik.yml` entirely and have the BASE compose ingress overlay (`compose/docker-compose.ingress.yml`) pass `--providers.file.filename=/etc/traefik/dynamic.yml` as a CLI arg. That keeps `traefik.yml` provider-agnostic and lets each overlay choose filename-or-directory cleanly. Alternative: add a "traefik.dev.yml" static-config variant and mount one or the other; but the CLI-flag approach is the lowest-blast-radius fix.

### WR-04 [FIXED 2026-05-15 — commit bd8c644]: Else-block in `tls-trust` recipe has no `&&` chaining — failures silently continue

**File:** `Makefile:138-146`
**Issue:** The else-branch of the idempotency `if` is a single shell `if/then/else/fi` chain joined by `\`-continuations and `;`. With no `set -e` and no `&&` between commands, a failure in `mkcert -cert-file …` does NOT abort the recipe — the subsequent `cp "$(mkcert -CAROOT)/rootCA.pem" …` and the three `chmod` invocations all still run. If `mkcert -install` is broken (air-gap host, NSS missing) or `-CAROOT` returns empty/nonexistent, `cp` may copy from `/rootCA.pem` (host root), or fail noisily but still let the recipe report exit 0 if the final `fi` succeeds. The recipe's exit semantics promise "exit 0 on regen" but cannot guarantee that.
**Fix:** Insert `&&` between the `mkcert`, `cp`, and three `chmod` calls inside the else-branch, OR prefix the recipe with `set -e;` at the top of the multi-line shell command. The latter is the more idiomatic Make pattern.

### WR-05 [FIXED 2026-05-15 — commits be8ed57 RED + 4118d26 GREEN]: `issuer.yaml` uses deprecated `solvers.http01.ingress.class`

**File:** `charts/openwhispr/templates/issuer.yaml:42-44`
**Issue:** The Helm template renders `solvers[0].http01.ingress.class: {{ .Values.ingress.className }}`. cert-manager 1.16 still ACCEPTS `class` but flags it as deprecated; the supported successor since 1.13 is `ingressClassName` (matching the upstream Ingress API). When operators bump to cert-manager 1.17.x (CONTEXT deferred #4) this will start emitting deprecation warnings; in 1.18+ it is slated for removal. Additionally — `.Values.ingress.className` is set to `traefik` which is documented in `values.yaml:381-384` as "informational only", because the chart renders Traefik IngressRoute CRDs, NOT `kind: Ingress`. The HTTP-01 solver's `class` here is the FIRST consumer in the chart that materially depends on `ingress.className` matching a real Kubernetes IngressClass resource — which may not exist if the operator's Traefik install registers under a different name.
**Fix:** (1) Migrate to `ingressClassName: {{ .Values.ingress.className }}` per current cert-manager guidance. (2) Update `values.yaml` comment to drop "informational only" because the issuer template now consumes the value structurally. (3) Add a values.schema.json warning / Helm NOTES.txt line that `ingress.className` MUST match a real cluster `IngressClass` when `certManager.renderIssuer=true`.

## Info

### IN-01: HTTP-01 challenge vs `:80 → :443` 308 redirect — confirmed compatible

**File:** `compose/traefik/traefik.yml:34-46` + `:146-153`
**Analysis:** Traefik 3 ACME HTTP-01 challenge handler registers a router on the resolver's `entryPoint` with priority above the user's redirect router. The `/.well-known/acme-challenge/*` path is served plaintext on `:80` before any redirect fires; all other paths still 308 to `:443`. This is documented Traefik behavior and works correctly out-of-the-box — no router-priority override needed in `dynamic.prod.yml`. The CONTEXT/SUMMARY claim that "Traefik 3 intercepts BEFORE the 308 redirect" is accurate. Acknowledging this only because the prompt asked for explicit verification.

### IN-02: cert-manager sub-chart alias-drop — architecturally sound

**File:** `charts/openwhispr/Chart.yaml:78-81`
**Analysis:** Dropping `alias: certManager` was the right call. cert-manager 1.16.4 publishes a strict `values.schema.json` with `additionalProperties: false` at the root, so aliasing would have caused the sub-chart validator to reject every parent-chart key under the same namespace. The un-aliased name `cert-manager` lives at `.Values["cert-manager"]` (hyphenated, requiring index syntax), which is syntactically disjoint from parent `.Values.certManager`. The trade-off: `certManager.installCRDs` on the parent is documentation-only — operators wanting to pass through must use the somewhat awkward `--set cert-manager.installCRDs=true`. This is the canonical Helm pattern for vendoring a strict-schema sub-chart and is worth a one-line NOTES.txt mention so operators discover the override syntax without reading the chart deviation log.

### IN-03 [FIXED 2026-05-15 — commit df1c2f4]: Per-context `compose/traefik/.dockerignore` is defense-in-depth only — no live regression guard

**File:** `compose/traefik/.dockerignore`
**Analysis:** Per-context `.dockerignore` is supported by Docker BuildKit and overrides the root `.dockerignore` for builds whose context is the sub-directory. Confirmed correct semantics. However: (a) the actual `compose/traefik/Dockerfile` does only `COPY fd-probe.sh /usr/local/bin/`, never `COPY . .`, so the per-context file is INERT today; (b) Phase 17 Gherkin Scenario 2 only scans the `openwhispr-api:tls-test` image, NOT the traefik image — so there is no automated regression guard against the per-context file being deleted or against a future `COPY . .` regression in the traefik Dockerfile. The 17-02 SUMMARY claims Scenario 2 is "the sole regression guard against per-context `.dockerignore` drift" — that claim is incorrect because the scan target image and the protected dockerignore are different contexts. Consider adding a second scenario or expanding Scenario 2's image-set to also build/scan the traefik image.

### IN-04: Idempotency predicate's wildcard guard regex is loose

**File:** `Makefile:136`
**Analysis:** `grep -q 'DNS:\*\.localhost'` matches `DNS:*.localhost` but also `DNS:*.localhostfoo` (no end-anchor). Practically harmless because no real cert ships `*.localhostfoo`. Could be tightened to `DNS:\*\.localhost[^A-Za-z0-9]` for paranoia. Not worth fixing.

### IN-05: Issuer metadata.name reads from `clusterIssuer` even when kind is `Issuer`

**File:** `charts/openwhispr/templates/issuer.yaml:29` + `certificate-{api,web}.yaml`
**Analysis:** When `issuerKind=Issuer`, the rendered Issuer's `metadata.name` is still pulled from `.Values.certManager.clusterIssuer` (default `letsencrypt-prod`). Functionally correct — cert-manager doesn't care that a namespaced Issuer is named "letsencrypt-prod" — but cosmetically confusing in `kubectl get issuer`. A future cleanup could rename the value key to `issuerName` and keep `clusterIssuer` as a deprecated alias.

### IN-06: `lint-dockerfile-tls` `\bmkcert\b` regex will flag comments

**File:** `tools/lint-dockerfile-tls.ts:86`
**Analysis:** The bare `\bmkcert\b` regex matches the token regardless of whether it appears in a `COPY`, `RUN`, or comment line. An operator who writes `# step 3: install mkcert manually` in a future Dockerfile comment will trip the lint and have to add an allowlist entry. The 17-02 commit B body documents this fact (good fixture rewritten to drop the bare "mkcert" comment). Acceptable noise for the security value gained; allowlist mechanism handles it.

---

## TDD Compliance Audit

PASS. Plans 17-01 / 17-02 / 17-03 each evidence RED → GREEN → REFACTOR:

- **17-02 (lint CLI):** `tools/__tests__/lint-dockerfile-tls.test.ts` authored first (Task 1 RED), implementation followed (Task 2 GREEN). Tests cover F1-F8 + readAllowlist + main CLI dispatch (13 tests, all green).
- **17-03 (Helm):** `charts/openwhispr/tests/issuer_test.yaml` 5-row helm-unittest matrix landed in the same atomic commit as `templates/issuer.yaml`. 163/163 helm-unittest pass.
- **17-01 (Makefile):** smoke-test of the no-mkcert exit-2 branch documented; live regen branch deferred to operator/CI per CONTEXT Q1 since mkcert is not on the executor host. Acceptable given the recipe is shell-only with no in-process logic to assert.

No internal mocks introduced. No `--legacy` flags. No suppressed warnings.

## Coverage Audit

PASS on the diff slice subject to coverage:

- `tools/lint-dockerfile-tls.ts`: 100 stmts / 94.44 branch / 100 funcs / 100 lines (above ≥ 90/90/90/90 floor). The branches missed are explicitly `c8 ignore`-annotated structurally-unreachable sort/error paths, mirroring the Phase 16-01 precedent.
- Helm chart templates have no `lines` coverage metric; surrogate is helm-unittest pass-rate (163/163 = 100%).
- Bash recipes (`Makefile`, `bootstrap.sh`) are uncovered by unit test but exercised by the deferred-live Gherkin scenarios 1 + 3 (`@expected-red @after-docker-up`).

No coverage regression on previously-shipped code.

## Constitutional Audit (CLAUDE.md hard rules)

- **Zero `--no-verify`:** Confirmed across all 5 atomic commits in the phase. `git log 81f69a3..HEAD` shows no override invocations. All three SUMMARYs explicitly assert the invariant held.
- **English-only:** All new code, comments, docs in English. Spot-checked `.feature`, `.steps.ts`, `.dockerignore`, `issuer.yaml`, `traefik.yml`, `docs/operations.md`. Clean.
- **Atomic commits:** 17-01 = 1 commit, 17-02 = 2 commits (lint-CLI triad + isolation evidence), 17-03 = 2 commits (compose-plane + K8s-plane). Each commit is internally cohesive; no scope mixing. Documentation `docs(*-SUMMARY)` commits are correctly split from `feat(*)` work.
- **No internal mocks:** Confirmed. The only mock-shaped object is `vi.spyOn(process.stderr, "write")` in the lint test, which is process-boundary IO — sanctioned per CLAUDE.md.
- **SPDX headers:** New files (`.feature`, `.dockerignore`, `issuer.yaml`, `dynamic.prod.yml`, `docker-compose.acme.yml`, lint CLI + tests + fixtures + allowlist) all carry `SPDX-License-Identifier: FSL-1.1-ALv2`. Verified.

## HTTP-01 Challenge vs `:80` Redirect — Verdict

No issue. Traefik 3 ACME HTTP-01 handler short-circuits the redirect router on `/.well-known/acme-challenge/*` (IN-01). The implementation is correct as-shipped; no router-priority overrides needed.

## cert-manager Alias-Drop Architectural Assessment

The drop is sound and well-documented (IN-02). Recommend a one-liner in chart `NOTES.txt` advising operators of the `--set cert-manager.installCRDs=true` override syntax — the hyphenated key is non-obvious to anyone who reads only `values.yaml`.

## Per-Context `.dockerignore` Docker Semantics Verification

Per-context `.dockerignore` files ARE supported by Docker BuildKit (since BuildKit GA) and DO override the root `.dockerignore` for that context's build. Semantics are correctly understood by the implementation. The remaining concern (IN-03) is that the new per-context file has NO live regression guard tying it to a failing test — its protection is defense-in-depth via `lint-dockerfile-tls.ts` (which scans Dockerfiles, not dockerignores) and the Gherkin Scenario 2 (which scans a different image). A future deletion of `compose/traefik/.dockerignore` would not break any test; only a future `COPY . .` regression in `compose/traefik/Dockerfile` combined with the deletion would leak certs. The compound failure window is small but exists.

---

_Reviewed: 2026-05-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
