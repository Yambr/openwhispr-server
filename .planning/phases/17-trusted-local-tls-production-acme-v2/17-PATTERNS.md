<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# Phase 17 — Pattern Map

**Mapped:** 2026-05-15
**Plans:** 17-01 (dev toolchain) · 17-02 (isolation enforcement) · 17-03 (production ACME + Helm)
**Mode:** advisor; no source edits in this artifact.

## File Classification (cross-plan)

| File (new or modified) | Plan | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|---|
| `Makefile` — `tls-trust` target | 17-01 | toolchain | shell delegation | `Makefile:43-44` (`up`), `Makefile:25-26` (`lint-rls` tsx delegation), `Makefile:5-10` (`.PHONY:` group) | exact |
| `tools/bootstrap.sh` — SAN de-wildcard (lines 358-371) | 17-01 | shell/codegen | filesystem | `tools/bootstrap.sh:90-98` (age-keygen discovery), `tools/bootstrap.sh:287-317` (idempotency block) | exact |
| `compose/traefik/dynamic.dev.yml` | 17-01 | YAML config | static | already present (Phase 15-02) — ZERO edits per Q1-C1 | exact |
| `compose/traefik/certs/.gitkeep` | 17-01 | placeholder | static | `compose/traefik/certs/` (live dir; gitignored leaf files) | role-match |
| `.gitignore` entries | 17-01 | metadata | static | existing `.env.*` glob convention | exact |
| `README.md` — quickstart step 2 | 17-01 | doc | static | `README.md:50-62` (Variant A quickstart block) | exact |
| `tools/lint-dockerfile-tls.ts` | 17-02 | lint CLI | static text scan | `tools/lint-phase-tag-comments.ts:1-100` (full shape) | exact |
| `tools/lint-dockerfile-tls.test.ts` | 17-02 | test | unit (vitest + tmpdir) | `tools/lint-phase-tag-comments.test.ts`, `tools/lint-colocated-tests.test.ts` | exact |
| `tools/lint-dockerfile-tls.allowlist.txt` | 17-02 | config | static | `tools/lint-phase-tag-comments.allowlist.txt` | exact |
| `package.json` — `lint:dockerfile-tls` script | 17-02 | metadata | static | `package.json:24` (`lint:phase-tag-comments`) | exact |
| `lefthook.yml` — `dockerfile-tls` block | 17-02 | hook config | static | `lefthook.yml:17-19` (colocated-tests block), commit `4771e3d` | exact |
| `.github/workflows/ci.yml` — appended step | 17-02 | CI | static | `.github/workflows/ci.yml:40` (`lint:phase-tag-comments` line-append to `lint-english` job) | exact |
| `.dockerignore` (root) — TLS-05 additions | 17-02 | dockerignore | static | `.dockerignore:1-23` (current 23-line root file) | role-match |
| `compose/traefik/.dockerignore` (NEW per-context) | 17-02 | dockerignore | static | **no in-repo precedent** — see risk callout | NONE |
| `tests/e2e-cjm/features/phase17-tls.feature` | 17-02 | Gherkin | journey | `tests/e2e-cjm/features/traefik-host-split.feature` | exact |
| `tests/e2e-cjm/steps/tls.steps.ts` | 17-02 | step defs | journey | `tests/e2e-cjm/steps/*.steps.ts` (12 existing) | exact |
| `docs/operations.md` — `#air-gap-mkcert` section | 17-02 | doc | static | `docs/operations.md` "## Bootstrap prerequisites" (L34), "## Auth" (L214) | role-match |
| `.planning/ROADMAP.md` — §16→§13 ref fix | 17-02 | doc | static | Phase 16-02 ROADMAP wording-fix precedent (16-PATTERNS analog #4) | exact |
| `compose/traefik/traefik.yml` — ACME resolver | 17-03 | YAML config | static | `compose/traefik/traefik.yml:27-99` (entryPoints + providers blocks); ACME resolver block is NEW | role-match |
| `compose/traefik/dynamic.prod.yml` (NEW) | 17-03 | YAML config | static | `compose/traefik/dynamic.dev.yml` (Phase 15 overlay shape) | exact |
| `compose/docker-compose.acme.yml` (NEW overlay) | 17-03 | compose overlay | static | `compose/docker-compose.ingress.yml`, `compose/docker-compose.observability.yml` (overlay convention) | exact |
| `charts/openwhispr/Chart.yaml` — cert-manager dep | 17-03 | metadata | static | `Chart.yaml:46-57` (existing `dependencies:` block — valkey + minio) | exact |
| `charts/openwhispr/values.yaml` — `certManager` extension | 17-03 | values | static | `values.yaml:354-356` (existing 3-line `certManager:` block) | exact |
| `charts/openwhispr/templates/issuer.yaml` (NEW) | 17-03 | helm template | static | `templates/certificate-api.yaml`, `templates/certificate-web.yaml` (gating + labels shape) | role-match |
| `charts/openwhispr/tests/issuer_test.yaml` (NEW) + extend `tls_test.yaml` | 17-03 | helm-unittest | static | `tests/tls_test.yaml:1-80` (cross-product matrix shape) | exact |

---

## Plan 17-01 — Dev Toolchain (`tls-trust` + bootstrap SAN de-wildcard)

### Closest analogs

#### 1. Makefile target shape — `Makefile:1-104`

- `.PHONY:` aggregation lives at `Makefile:5-10` (one logical group per line, continuation backslash). **Add `tls-trust` to the FIRST group** (line 5-6 — toolchain targets next to `dev test lint`), not the overlay group at line 10.
- `help` target at `Makefile:12-13` auto-discovers any `^[a-zA-Z0-9_-]+:` target — zero help-text edit needed.
- Recipe style precedent — `Makefile:25-26` (`lint-rls: pnpm exec tsx tools/lint-rls.ts`) uses ONE shell delegation per line. `Makefile:43-44` (`up: docker compose up -d --wait`) uses zero indirection. CONTEXT-recommended `tls-trust` block (lines 85-111) keeps the logic INLINE rather than delegating to `tools/tls-trust.sh` — matches the in-Makefile precedent of `clean-stack:` (Makefile:101-104) which is also inline shell.
- `@command -v X >/dev/null || { … exit 2; }` style discovery: **no Makefile precedent** for binary discovery inline; closest analog lives in `tools/bootstrap.sh:91` (`if command -v age-keygen >/dev/null 2>&1; then`). Recipe-line `@command -v mkcert ...` per CONTEXT Q1 establishes the pattern.

#### 2. `tools/bootstrap.sh` cert generation — `tools/bootstrap.sh:287-399`

- **Idempotency block to MIRROR** for `tls-trust`: `bootstrap.sh:301-317` — `needs_cert=1` flag + 30-day `openssl x509 -checkend` guard. CONTEXT Q1 recipe (`make tls-trust` body) reproduces this idempotency check with one ADDED predicate: explicit-host SAN presence (`grep -q 'DNS:api.localhost'`) AND absence of wildcard (`! grep -q 'DNS:\*\.localhost'`). This catches the regression where a stale bootstrap-minted cert (still valid >30d) leaks the wildcard SAN.
- **age-keygen discovery to MIRROR** for mkcert: `bootstrap.sh:90-98` — `command -v age-keygen >/dev/null 2>&1` then echo stderr warning then fallback. Phase 17 mkcert detection is STRICTER (B3 = fail+platform-error, no openssl fallback in `tls-trust` — `bootstrap.sh` openssl path remains the CI generator per PITFALLS §13).
- **SAN list to MODIFY in place** — `bootstrap.sh:358-371`. Specific edits:
  - DELETE `DNS.2 = *.localhost` (line 360)
  - DELETE `DNS.10 = *.example.test` (line 368)
  - REPLACE remaining list with EXPLICIT 8-host list: `localhost` + 5 mkcert hosts (`api.localhost web.localhost app.localhost grafana.localhost mailpit.localhost`) + 2 contract-test hosts (`api.example.test auth.example.test`) + 2 ancillary (`auth.localhost minio-console.localhost`) per existing list intent.
- **Test gate** — bootstrap.sh has NO unit tests; SAN-list change is observable via `openssl x509 -text` in a Gherkin step or a new shellcheck-style assertion. Recommend: add an assertion inside `tests/e2e-cjm/features/phase17-tls.feature` scenario 2 (`then the bootstrap cert SAN list contains no wildcard entries`).

#### 3. `compose/traefik/dynamic.{yml,dev.yml}` — ZERO edits

- `dynamic.yml:130-133` `tls.certificates` block references `/certs/local.crt` + `/certs/local.key`. Q1-C1 single-SAN-cert decision → mkcert writes to the SAME paths → ZERO YAML edits on either base or dev overlay.
- `dynamic.dev.yml:16-22` Phase 15 comment header already names the canonical 5-host list. Confirms Phase 17 is wire-compatible.

#### 4. README quickstart insertion — `README.md:44-87`

- Current step 1 is `cp .env.embedded.example .env` at `README.md:54`. Per CONTEXT Q5: insert NEW step 2 `make tls-trust` block AFTER line 54, BEFORE current step 2 (`$EDITOR .env`). Renumber subsequent steps (current 2→3, 3→4, 4→5, 5→6, 6→7).
- Insertion preserves the `# N. <title>` shell-comment convention (lines 51, 56, 61, 65, 73, 81).

### Reusable conventions

- Makefile `@`-prefixed recipe lines (silent execution) — `Makefile:13`, `:194-197`, `:317-321`.
- Inline shell `case "$$(uname -s) in Darwin) … Linux) …` — **no in-repo precedent**; mkcert install hints establish it.
- 30-day cert validity guard — `bootstrap.sh:313-314`.

### Files to create vs modify (17-01)

| Action | File | Lines |
|---|---|---|
| Modify | `Makefile` — add `tls-trust` to `.PHONY:` line 5; append recipe block after `clean-stack` (Makefile:101-104) | +~25 |
| Modify | `tools/bootstrap.sh:358-371` — replace SAN list (drop wildcards; explicit 8-host list) | ~−2 lines, ~+0 |
| Create | `compose/traefik/certs/.gitkeep` | 1 |
| Modify | `.gitignore` — confirm `compose/traefik/certs/*.crt`, `*.key`, `*.srl` already covered; add `!compose/traefik/certs/.gitkeep` exception | +1 |
| Modify | `README.md:54` — insert `make tls-trust` step 2 block | +~6 |

### Risk callouts

- **mkcert binary detection** has no Makefile precedent — the `command -v` pattern is shell-only (bootstrap.sh:91). Mitigation: recipe is small (~25 lines); validate with `make tls-trust` dry-run on Darwin + Linux CI runners.
- **`.gitignore` exception for `.gitkeep`** — check existing `.gitignore` for cert globs before adding `!compose/traefik/certs/.gitkeep`. If `compose/traefik/certs/` itself is gitignored as a DIR (not via leaf glob), the `.gitkeep` won't be tracked.
- **bootstrap.sh test coverage** — CLAUDE.md ≥90/90/90/90 coverage rule does not apply to `bootstrap.sh` (bash, no test framework). Observability via Gherkin scenario in 17-02 is the only enforcement.

---

## Plan 17-02 — Isolation Enforcement (lint CLI + dockerignore + Gherkin + air-gap docs)

### Closest analogs

#### 1. Standalone tsx lint CLI — `tools/lint-phase-tag-comments.ts` (Phase 16-01)

This is the closest sibling, post-Phase-16. Copy verbatim:

- **Shebang + SPDX line 1-2** — `lint-phase-tag-comments.ts:1-2` (`#!/usr/bin/env -S pnpm exec tsx` + SPDX header).
- **Exit codes 0/1/2 doctring** — `:14-19`. Same triad.
- **Argv shape** — bare `tsx tools/lint-X.ts [rootDir]`, no subcommands.
- **PATTERNS + IGNORE arrays** — `:38-52`. For dockerfile-tls scan, PATTERNS = `["**/Dockerfile", "**/Dockerfile.*"]` (12 dockerfile inventory per CONTEXT `<code_context>` lines 64-67).
- **Allowlist file reader** — `readAllowlist(rootDir)` at `:64-74` — POSIX path list, `#` comments stripped, blank-line tolerant. Copy exact shape; rename const to `ALLOWLIST_FILE = "tools/lint-dockerfile-tls.allowlist.txt"`.
- **Exported `findViolations(rootDir)`** — `:81-100`. Returns `Violation[]`. Vitest tests import and call directly (no execFile).
- **CLI entry guard** — pattern at `:411-414` of `spdx-header.ts` (Phase 16-PATTERNS analog #1) — `invokedDirect` check so the module is both runnable and import-friendly for tests.

#### 2. Wiring triad atomic commit — **`4771e3d`** (Phase 16-01)

Verbatim template. Three files in ONE commit:

1. `package.json:24` — add `"lint:dockerfile-tls": "tsx tools/lint-dockerfile-tls.ts"` immediately after `lint:phase-tag-comments` (line 24).
2. `lefthook.yml:23-26` (after `phase-tag-comments` block — currently:
   ```yaml
   phase-tag-comments:
     glob: "..."
     run: pnpm lint:phase-tag-comments
   ```
   Append sibling block:
   ```yaml
   dockerfile-tls:
     glob: "**/Dockerfile*"
     run: pnpm lint:dockerfile-tls
   ```
3. `.github/workflows/ci.yml:40` — append `- run: pnpm lint:dockerfile-tls` to `lint-english` job (currently ends at line 40 with `lint:phase-tag-comments`). Adds 4th-now-5th step — no new job, no runner cost.

Commit body wording: mirror `4771e3d` exactly (`feat(17-02): wire lint-dockerfile-tls into pnpm + lefthook + ci`).

#### 3. RED-first test shape — `tools/lint-phase-tag-comments.test.ts`

- Vitest + `mkdtempSync(join(tmpdir(), "..."))` per-`it` tmpdir
- `touch(rel, content)` helper writes fixture Dockerfile files
- Calls `findViolations(root)` directly; asserts per-rule positive + negative
- Forbidden patterns (one test each):
  1. `COPY ... rootCA*.pem`
  2. `COPY ... root-ca.{crt,key}`
  3. `COPY ... compose/traefik/certs/`
  4. `COPY ... *.localhost.{pem,key}`
  5. `RUN mkcert ...` / `RUN ... mkcert-install`
- KEEP-bucket negatives:
  - `COPY fd-probe.sh /` (current `compose/traefik/Dockerfile` line) — must NOT flag
  - `COPY package.json /app/` — must NOT flag

#### 4. Gherkin feature shape — `tests/e2e-cjm/features/traefik-host-split.feature`

Tag convention (from grep on existing files):
```gherkin
@cjm-<slug> @after-docker-up @expected-red
Scenario: <name>
```

- `@cjm-tls-trusted-localhost` — ROADMAP §17 SC #5
- `@cjm-tls-no-dev-ca-in-prod-image` — TLS-05 enforcement
- `@cjm-tls-acme-staging` — TLS-02-prod / TLS-03

Step defs file `tests/e2e-cjm/steps/tls.steps.ts` mirrors `tests/e2e-cjm/steps/locale.steps.ts` shape (12 existing step files; 1:1 with features).

Scenario 2 step impl: `docker create <image>` → `docker export | tar -t | grep -E '(rootCA|local\.(crt|key)|mkcert)' && fail` — no `docker run` needed; works on distroless.

`@after-docker-up` ordering tag is required (gates scenario behind the e2e-cjm compose project — `Makefile:378-406`).

#### 5. Per-context `.dockerignore` — NO in-repo precedent

Only `.dockerignore` in the repo today is root (23 lines, `/Users/nick/openwhispr-server/.dockerignore`). Phase 17 introduces the SECOND `.dockerignore` at `compose/traefik/.dockerignore`. This is the highest-risk pattern in Phase 17.

Shape (5-line file per CONTEXT decision):
```
# SPDX-License-Identifier: FSL-1.1-ALv2
# TLS-05 / Phase 17 — per-context guard (root .dockerignore does NOT cover this context)
certs/
*.pem
*.crt
*.key
*.srl
```

Note: `.dockerignore` does NOT support SPDX-style hash headers via tooling — `tools/spdx-header.ts` currently does NOT scan `.dockerignore`. Leave header as plain `#` comment; do not add to spdx-header.ts HASH_PATTERNS scope to avoid scope creep.

#### 6. `docs/operations.md` section anchor

`docs/operations.md` has 754+ lines with `## <Title>` H2 sections (greps: L1, L5, L30, L34, L44, L116, L214, L251 `Open mailpit at http://mailpit.localhost`, L397 `## Realtime ingress (:8443)`, L477, L522, L754 `## Helm chart (Kubernetes)`).

Insert `## Air-gap mkcert installation` (anchor `#air-gap-mkcert`) AFTER `## Bootstrap prerequisites` (L34-43) and BEFORE `## BYOK Environment Matrix` (L44). 5-subsection content per CONTEXT Q5:
1. macOS binary mirror URL
2. Linux binary mirror URL
3. Checksum verification
4. PATH installation
5. `mkcert -install` air-gap caveat (no internet → trust store not auto-installed; doc fallback to manual `security add-trusted-cert`/`update-ca-certificates`)

### Reusable conventions

- SPDX header line 1 (TS) — `tools/lint-phase-tag-comments.ts:2`
- Shebang `#!/usr/bin/env -S pnpm exec tsx` line 1 (TS) — `tools/lint-phase-tag-comments.ts:1`
- Allowlist filename suffix `.allowlist.txt` — `tools/lint-phase-tag-comments.allowlist.txt` precedent
- Lefthook block glob string — `glob: "**/Dockerfile*"` (POSIX, single-quoted unsafe; double-quoted per Phase 16 wiring)
- Gherkin `@cjm-<slug>` + `@after-docker-up` (+ optional `@expected-red`) — `traefik-host-split.feature:14`, `:19`

### Files to create vs modify (17-02)

| Action | File |
|---|---|
| Create | `tools/lint-dockerfile-tls.ts` (CLI; ≥90/90/90/90 coverage required) |
| Create | `tools/lint-dockerfile-tls.test.ts` (RED-first; 5 positive + 2 negative fixtures) |
| Create | `tools/lint-dockerfile-tls.allowlist.txt` |
| Modify | `package.json:24` — add `lint:dockerfile-tls` script |
| Modify | `lefthook.yml` — append `dockerfile-tls:` block after `phase-tag-comments:` (line 23-26 area) |
| Modify | `.github/workflows/ci.yml:40` — append `- run: pnpm lint:dockerfile-tls` |
| Modify | `.dockerignore` (root) — append 9-line TLS-05 block per CONTEXT |
| Create | `compose/traefik/.dockerignore` (NEW per-context, ~7 lines) |
| Create | `tests/e2e-cjm/features/phase17-tls.feature` (3 scenarios) |
| Create | `tests/e2e-cjm/steps/tls.steps.ts` |
| Modify | `docs/operations.md:43` — insert `## Air-gap mkcert installation` section (5 subsections) |
| Modify | `.planning/ROADMAP.md` — §17 SC #1 + #3 `PITFALLS §16` → `PITFALLS §13` |

### Risk callouts

- **Per-context `.dockerignore` has zero in-repo precedent.** The semantic (Docker per-context dockerignore resolution) is documented in `PITFALLS.md:407, :539, :626, :660` but no existing Dockerfile in the repo has a sibling `.dockerignore`. Mitigation: Gherkin scenario 2 (filesystem scan) is the authoritative regression guard — if a future maintainer deletes the per-context file, the Gherkin scan fails.
- **Dockerfile glob breadth.** `compose/traefik/Dockerfile`, `compose/mock-litellm/Dockerfile`, `compose/postgres/Dockerfile`, `compose/pgbouncer/Dockerfile`, `images/cnpg-postgres-17-pgpartman/Dockerfile`, `tools/test-probe/Dockerfile`, `packages/contract-tests/Dockerfile`, `tests/fixtures/idp/Dockerfile`, `tests/e2e/mock-realtime/Dockerfile`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/worker/Dockerfile` — 12 files. PATTERNS array `["**/Dockerfile", "**/Dockerfile.*"]` catches all; IGNORE must include `node_modules`, `.git`, `coverage`, `dist`, `.next` to avoid spurious matches in vendored caches.
- **Lefthook glob `**/Dockerfile*`** triggers on the new `compose/traefik/.dockerignore` ONLY if extension expanded — recommend explicit `**/Dockerfile` (no trailing `*`) plus a separate glob row for `.dockerignore` if regression guard wanted. Per CONTEXT Q3-A2 the lint CLI is the regression guard for Dockerfiles; `.dockerignore` is not lint-scoped. Keep glob narrow.
- **ME-02 lefthook patch-reapply risk** — Phase 16-PATTERNS analog #2 documents the threshold (100+ overlapping rewrites). 17-02 commits stage <15 files each → well below threshold. Predicted ZERO `--no-verify`. If hit, escalate per CONTEXT line 203.

---

## Plan 17-03 — Production ACME + Helm (Traefik prod profile + cert-manager sub-chart)

### Closest analogs

#### 1. `compose/traefik/traefik.yml` ACME resolver block — NEW addition

Static config currently has NO `certificatesResolvers:` block. Insert AFTER `providers:` block (line 101-122) and BEFORE `log:` (line 124). Shape (per Traefik 3.6 docs; A3 single resolver + staging toggle):

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: "${LETSENCRYPT_EMAIL}"
      storage: /letsencrypt/acme.json
      caServer: "${LETSENCRYPT_CA_SERVER:-https://acme-v02.api.letsencrypt.org/directory}"
      httpChallenge:
        entryPoint: web
```

Operator overrides `LETSENCRYPT_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory` for staging. The existing `:80 web` entrypoint at `traefik.yml:28-39` is reused for HTTP-01 challenge (the 308 redirect block already routes everything else to `:443` so this is non-disruptive — ACME challenge bypasses the redirect via Traefik internal routing).

Resolver is INERT until a router opts in via `tls.certResolver: letsencrypt`. Existing routers in `dynamic.yml` do NOT opt in — they continue using `/certs/local.crt`.

#### 2. `compose/traefik/dynamic.prod.yml` (NEW)

Mirror `dynamic.dev.yml` overlay shape exactly (5 lines `SPDX-License-Identifier` + Phase header, then `http:` block). Per-host router with `tls.certResolver: letsencrypt`:

```yaml
http:
  routers:
    api-prod:
      rule: "Host(`api.example.com`)"      # operator-overridable
      service: api-svc
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
```

D1 (never wildcard): one router per host; no `*.example.com`.

#### 3. Compose overlay shape — `compose/docker-compose.ingress.yml` (Phase 14)

`docker-compose.ingress.yml` (72 lines) is the closest analog. Pattern to mirror:

- Top-level `services:` (no `version:` per compose v2.20+)
- Add `traefik:` service block (overrides ingress overlay's traefik)
- Volumes: ADD `letsencrypt:/letsencrypt` named-volume + KEEP existing `:/certs:ro` bind
- Top-level `volumes:` block declares `letsencrypt:` (named, no `driver:` — local default)

Naming: `compose/docker-compose.acme.yml` per CONTEXT Q5 + Phase 14 overlay convention.

#### 4. `charts/openwhispr/Chart.yaml` dependency entry — `Chart.yaml:46-57`

Existing `dependencies:` block has 2 entries (valkey, minio). Both use `condition:` for opt-in/out. Append THIRD entry (per CONTEXT Q2-B3):

```yaml
  - name: cert-manager
    version: "1.16.4"
    repository: "https://charts.jetstack.io"
    condition: certManager.bundled
    alias: certManager
```

NOTE: existing entries use lowercase aliases (`valkey`, `minio`); `alias: certManager` uses camelCase to match the existing `certManager.*` values-key namespace (`values.yaml:354-356`). This is a deliberate divergence to keep value lookup keys consistent (e.g. `certManager.installCRDs` passes through to the sub-chart's `installCRDs` value).

#### 5. `charts/openwhispr/values.yaml` extension — `values.yaml:354-356`

Current block (3 lines):
```yaml
certManager:
  enabled: true
  clusterIssuer: letsencrypt-prod
```

Append 5 NEW keys per CONTEXT Q2 (lines 132-138 of CONTEXT):
```yaml
  bundled: false             # NEW — opt-in sub-chart render
  issuerKind: ClusterIssuer  # NEW — or `Issuer`
  renderIssuer: false        # NEW — render (Cluster)Issuer body from THIS chart
  acmeEmail: ""              # NEW — required when renderIssuer=true
  acmeStaging: false         # NEW — flip to LE staging endpoint
  installCRDs: true          # NEW — passthrough to bundled cert-manager
```

#### 6. `templates/certificate-{api,web}.yaml` issuerRef.kind — `certificate-api.yaml:28-30`

Current:
```yaml
  issuerRef:
    kind: ClusterIssuer
    name: {{ .Values.certManager.clusterIssuer }}
```

`kind: ClusterIssuer` is HARDCODED — must be templated to `{{ .Values.certManager.issuerKind }}` for C3 issuer-kind switch. Apply same edit to `certificate-web.yaml:27-29`. Backward-compatible: default `issuerKind: ClusterIssuer` preserves existing behavior.

#### 7. NEW `templates/issuer.yaml`

Shape mirrors `templates/certificate-api.yaml:13-31` (gating + labels + body):

```yaml
{{- if and .Values.tls.enabled .Values.certManager.enabled .Values.certManager.renderIssuer -}}
{{- $fullname := include "openwhispr.fullname" . -}}
apiVersion: cert-manager.io/v1
kind: {{ .Values.certManager.issuerKind }}
metadata:
  name: {{ .Values.certManager.clusterIssuer }}
  {{- if eq .Values.certManager.issuerKind "Issuer" }}
  namespace: {{ .Release.Namespace }}
  {{- end }}
  labels:
    {{- include "openwhispr.labels" . | nindent 4 }}
spec:
  acme:
    email: {{ required "certManager.acmeEmail required when renderIssuer=true" .Values.certManager.acmeEmail }}
    server: {{ if .Values.certManager.acmeStaging }}https://acme-staging-v02.api.letsencrypt.org/directory{{ else }}https://acme-v02.api.letsencrypt.org/directory{{ end }}
    privateKeySecretRef:
      name: {{ $fullname }}-acme-key
    solvers:
      - http01:
          ingress:
            class: {{ .Values.ingress.className }}
{{- end }}
```

`include "openwhispr.labels"` at `_helpers.tpl:35` — verified shape.

#### 8. helm-unittest — `charts/openwhispr/tests/tls_test.yaml:1-80`

Existing matrix: `tls.enabled` × template names. EXTEND with new dimension `certManager.bundled` × `certManager.renderIssuer`:

NEW file `charts/openwhispr/tests/issuer_test.yaml`:
- `it: certManager.renderIssuer=false (default) — issuer.yaml renders zero docs`
- `it: tls.enabled=true + certManager.enabled=true + certManager.renderIssuer=true — issuer.yaml renders 1 ClusterIssuer doc`
- `it: certManager.issuerKind=Issuer — issuer.yaml renders namespaced Issuer with .metadata.namespace`
- `it: certManager.renderIssuer=true + acmeEmail empty — render fails with required error`
- `it: certManager.acmeStaging=true — server URL is acme-staging-v02`

EXTEND `tests/tls_test.yaml` (append after line 80) with new dimension on `certificate-api.yaml`:
- `it: certManager.issuerKind=Issuer — certificate-api.yaml issuerRef.kind = Issuer`

`charts/openwhispr/tests/subcharts_test.yaml` already exists — EXTEND with:
- `it: certManager.bundled=false (default) — no cert-manager sub-chart resources`
- `it: certManager.bundled=true + installCRDs=true — cert-manager CRDs render`

### Reusable conventions

- Helm template double-AND gating `{{- if and .Values.tls.enabled .Values.certManager.enabled -}}` — `certificate-api.yaml:14`
- `{{- include "openwhispr.labels" . | nindent 4 }}` — `certificate-api.yaml:22`
- `{{- $fullname := include "openwhispr.fullname" . -}}` — `certificate-api.yaml:15`
- helm-unittest `release:` + `tests:` shape — `tls_test.yaml:7-9`
- Compose overlay services-only top-level (no `version:`, no `name:` — inherits from base) — `docker-compose.ingress.yml:19`

### Files to create vs modify (17-03)

| Action | File |
|---|---|
| Modify | `compose/traefik/traefik.yml` — ADD `certificatesResolvers:` block after `providers:` (line ~122) |
| Create | `compose/traefik/dynamic.prod.yml` (NEW prod overlay; 5-host router skeleton) |
| Create | `compose/docker-compose.acme.yml` (NEW overlay; volume mount + env-driven LE) |
| Modify | `charts/openwhispr/Chart.yaml:57` — append `cert-manager` sub-chart entry |
| Modify | `charts/openwhispr/values.yaml:354-356` — extend `certManager:` block (+6 keys) |
| Modify | `charts/openwhispr/templates/certificate-api.yaml:29` — `kind: ClusterIssuer` → `kind: {{ .Values.certManager.issuerKind }}` |
| Modify | `charts/openwhispr/templates/certificate-web.yaml:28` — same edit |
| Create | `charts/openwhispr/templates/issuer.yaml` (NEW; gated by `renderIssuer`) |
| Create | `charts/openwhispr/tests/issuer_test.yaml` |
| Modify | `charts/openwhispr/tests/tls_test.yaml` — append `issuerKind=Issuer` assertion |
| Modify | `charts/openwhispr/tests/subcharts_test.yaml` — append `bundled=true/false` matrix |

### Risk callouts

- **`certificatesResolvers:` interaction with `tls.certificates`**: existing dynamic.yml `tls.certificates:` block (line 130-133) takes precedence over resolver for routers WITHOUT `certResolver:` opt-in. Verified Traefik 3 behavior: router-level `tls.certResolver:` overrides; absent it, file-provider cert wins. Decision-tree is correct. Mitigation: helm-unittest + Gherkin scenario 3 prove the prod opt-in path; dev path remains untouched.
- **HTTP-01 challenge requires :80 reachable from internet**. `traefik.yml:28-39` `:80 web` entrypoint is redirect-only (308). Traefik 3 internal HTTP-01 handler intercepts `/.well-known/acme-challenge/*` BEFORE the redirect middleware fires — verified upstream behavior. Production overlay must publish `:80` to host (operator concern; document in compose/docker-compose.acme.yml comment header).
- **cert-manager 1.16.4 pin** — per CONTEXT deferred #4, stay on 1.16 line. If 1.17 GA's during plan execution, do NOT bump — flag in 17-SUMMARY.
- **values.schema.json drift** — `charts/openwhispr/values.schema.json` exists at `charts/openwhispr/values.schema.json`; new `certManager.*` keys must be reflected there or helm-install with --strict will reject them. Verify when extending values.yaml. (Not listed in CONTEXT explicit-file-table but is a hard pre-existing gate.)
- **Compose-plane atomic commit vs K8s-plane atomic commit ordering**: per CONTEXT Q4 17-03 ships TWO commits. Either can land first (disjoint file trees). Recommend compose-plane first (test gate: smoke `docker compose -f docker-compose.yml -f compose/docker-compose.acme.yml config` succeeds — no actual ACME issuance attempted locally).

---

## Shared / cross-cutting

### Cross-plan file conflict analysis (parallel-safety)

CONTEXT Q4 claims 17-01 + 17-03 are wave-1 parallel-safe (disjoint file trees). Verified:

| File | 17-01 | 17-02 | 17-03 | Conflict? |
|---|---|---|---|---|
| `Makefile` | M | — | — | none |
| `tools/bootstrap.sh` | M | — | — | none |
| `compose/traefik/traefik.yml` | — | — | M | none (17-01 makes ZERO Traefik edits per C1) |
| `compose/traefik/dynamic.yml` | — | — | — | none |
| `compose/traefik/dynamic.dev.yml` | — | — | — | none (Phase 15-02 owns; both plans leave alone) |
| `compose/traefik/dynamic.prod.yml` | — | — | C | none (NEW) |
| `compose/traefik/.dockerignore` | — | C | — | none (NEW; 17-02 only) |
| `compose/traefik/certs/.gitkeep` | C | — | — | none (NEW; 17-01 only) |
| `.dockerignore` (root) | — | M | — | none |
| `README.md` | M | — | — | none |
| `docs/operations.md` | — | M | — | none |
| `.planning/ROADMAP.md` | — | M | — | none |
| `charts/openwhispr/**` | — | — | M+C | none |
| `tools/lint-dockerfile-tls.*` | — | C | — | none (NEW; 17-02) |
| `tests/e2e-cjm/features/phase17-tls.feature` | — | C | — | none (NEW; 17-02) |
| `package.json` | — | M | — | none |
| `lefthook.yml` | — | M | — | none |
| `.github/workflows/ci.yml` | — | M | — | none |

**Verdict:** 17-01 and 17-03 can ship in parallel (Wave 1). 17-02 sequences AFTER 17-01 because the dockerignore-tls lint CLI predicate keys on the `compose/traefik/certs/` path established by 17-01 (D1 status-quo).

### "No precedent" gaps to surface in PLAN.md

1. **Per-context `.dockerignore`** — no existing Dockerfile in the repo has a sibling `.dockerignore`. Phase 17-02 establishes this. Gherkin scenario 2 is the only regression guard.
2. **mkcert binary detection in a Makefile recipe** — `command -v` pattern exists in `bootstrap.sh:91` but not in `Makefile`. Phase 17-01 establishes inline Makefile recipe shape.
3. **Standalone tsx CLI scanning Dockerfiles** — `lint-phase-tag-comments.ts` scans `.ts/.tsx`; no existing CLI scans `Dockerfile`. 17-02 broadens the precedent.
4. **Helm template that's a generic `(Cluster)Issuer` body** — current chart only references externally-applied ClusterIssuers (see `charts/openwhispr/examples/cert-manager-clusterissuer-letsencrypt.yaml`). 17-03 introduces the first in-chart-rendered Issuer.
5. **cert-manager sub-chart as an OPTIONAL dependency** — current 2 sub-chart deps (`valkey`, `minio`) are ALWAYS rendered when their condition is true. `cert-manager` with `bundled: false` default is the first dep that DEFAULTS OFF — brownfield-safe pattern.

### SPDX header style (applied to all new `.ts/.yml/.sh/.feature` files in this phase)

```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
```

Hash variant for `.yml`, `.sh`, `.dockerignore`, `Makefile`, `.feature` (Gherkin `#` comments tolerate it):
```yaml
# SPDX-License-Identifier: FSL-1.1-ALv2
```

Both enforced by `tools/spdx-header.ts` audit in CI (per `lint-english` job). Verify glob coverage of new file types before commit; `.feature` and `.dockerignore` MAY need scope-add — confirm via dry-run `pnpm spdx:audit-hash` against staged tree.

### Plan-ordering invariant

`17-01 → 17-02` (sequential within wave gap). `17-01 ∥ 17-03` (Wave 1 parallel). `17-02` (Wave 2 after 17-01 closes).

### Metadata

- **Pattern extraction date:** 2026-05-15
- **Files read (read-only):** 16 (CONTEXT.md, DISCUSSION-LOG.md, 16-PATTERNS.md, PITFALLS.md §13 head, Makefile, bootstrap.sh slices, traefik.yml, dynamic.yml, dynamic.dev.yml, docker-compose.ingress.yml, Chart.yaml, certificate-api.yaml, certificate-web.yaml, values.yaml certManager slice, tls_test.yaml head, .dockerignore, lint-phase-tag-comments.ts head, README.md quickstart, operations.md greps, lefthook.yml + ci.yml + package.json greps, git log 4771e3d verify)
- **Analogs found:** 22 / 24 file rows (92%); 2 have no in-repo precedent (`compose/traefik/.dockerignore`, `Makefile` mkcert binary discovery)
- **Phase 16 commit hashes verified:** `4771e3d` (wiring triad atomic), `30a7b30` (lint CLI + allowlist), `0c0c0a2` (RED lint test)
<!-- REUSE-IgnoreEnd -->
