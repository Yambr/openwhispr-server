# Phase 17 — Discussion Log

**Date:** 2026-05-15
**Mode:** discuss (advisor-style; 4 parallel `gsd-advisor-researcher` agents)
**User pacing:** yolo — full acceptance of research recs with one explicit Sub-D Q3 fallback to D1 (status quo cert location)

## Gray areas selected

User selected ALL four researched gray areas:
1. mkcert wiring + dev-cert lifecycle
2. Production ACME + cert-manager Helm sub-chart
3. Dev-cert isolation enforcement (TLS-05)
4. Plan split + commit strategy

Plus an explicit Q0 correction: ROADMAP/CONTEXT references "PITFALLS §16" — actual ref is §13 (mkcert in CI/prod). §16 is unrelated (visual regression/a11y).

## Questions asked and decisions made

### Q1. mkcert wiring + dev-cert lifecycle

**Options presented (after research):**
- A: cert generation responsibility (A1 always / A2 if-missing-or-expired / A3 mkcert+bootstrap coexistence)
- B: mkcert binary discovery + air-gap (B1 hard-require / B2 auto-install / B3 detect+platform-error+air-gap doc)
- C: cert filename convention (C1 single SAN / C2 per-host / C3 SAN+symlinks)
- D: bootstrap cert migration (D1 overwrite in place / D2 archive / D3 keep both forever)

**User selected:** A2 + B3 + C1 + D1 (full research recommendation).

**Rationale recorded:** A2 matches bootstrap.sh's 30-day idempotency block. B3 mirrors bootstrap.sh's age-keygen discovery, satisfies TLS-06 without sudo. C1 is drop-in to Phase 15 Traefik wiring (zero YAML edits). D1 is the correct semantic for gitignored runtime artefacts.

**Corollary locked:** `tools/bootstrap.sh` SAN list (lines 358-371) must drop `*.localhost` + `*.example.test` wildcards per PITFALLS §13.

### Q2. Production ACME + cert-manager Helm

**Options presented (after research):**
- A: ACME resolver shape (A1 single HTTP-01 / A2 dual HTTP+DNS / A3 single + staging toggle)
- B: cert-manager Helm sub-chart (B1 bundled-required / B2 external / B3 hybrid optional `bundled` flag)
- C: Issuer shape (C1 ClusterIssuer / C2 namespaced Issuer / C3 kind switch)
- D: wildcard cert posture (D1 never / D2 optional / D3 split compose/Helm)

**User selected:** A3 + B3 + C3 + D1 (full research recommendation).

**Rationale recorded:** A3 mirrors existing Helm staging/prod ClusterIssuer pair. B3 with `bundled=false` default = brownfield safety; greenfield ops flip the flag. C3 default `ClusterIssuer` is backward-compatible with existing `certificate-api.yaml` + `certificate-web.yaml`. D1 is SC #1 mandate.

### Q3. Dev-cert isolation enforcement

**Options presented (after research):**
- A: `.dockerignore` shape (A1 single line / A2 expanded + per-context / A3 per-Dockerfile allowlist)
- B: lint mechanism (B1 tsx CLI / B2 Hadolint / B3 bash / B4 Gherkin-only)
- C: Gherkin scenario shape (C1 prod-image filesystem scan / C2 Trivy/Grype / C3 ts-morph static)
- D: cert directory location (D1 `compose/traefik/certs/` status quo / D2 `~/.openwhispr/certs/` outside repo / D3 `.certs/` repo root hidden)

**User selected:** A2 + B1 + C1 + D1 (research recs for A/B/C; orchestrator overrode D from researcher's D2 preference to D1 status-quo fallback).

**Rationale recorded:**
- A2 is mandatory — root `.dockerignore` does NOT apply to `compose/traefik/` build context (Docker per-context semantics); per-context file required.
- B1 matches Phase 15-01 + Phase 16-01 standalone-tsx-CLI precedent verbatim.
- C1 SC #3 explicitly demands a Gherkin scenario; static lint alone misses multi-stage `COPY --from=` carry-over.
- D1 overrides researcher's D2 — orchestrator rejected D2 for v2: migrating bootstrap.sh output + compose mount paths + Win/WSL UX research is too large for Phase 17 scope. A2 + B1 + C1 provide belt-and-suspenders defense at the status-quo location. D2 logged as deferred.

### Q4. Plan split + commit strategy

**Options presented (after research):**
- A: 2 plans (dev / prod)
- B: 3 plans (dev-toolchain / isolation-enforcement / prod-ACME-Helm) — research rec
- C: 4 plans (max split)
- D: single plan

**User selected:** B.

**Rationale recorded:** B threads three precedent constraints — Phase 16's "tooling triad atomic commit" fits 17-02's lint CLI wiring; Phase 15's lesson about mixing reviewable code with infra-config in one plan is avoided; wave-parallel feasibility (17-01 + 17-03 disjoint file trees; 17-02 sequenced after 17-01 for cert-path conventions).

**Sub-X (commit grouping within plans):** Atomic per concern, not per file. ≈5 commits across 3 plans.
**Sub-Y (`--no-verify` prediction):** ZERO predicted. Makefile/YAML/Helm-templates outside biome glob; lint CLI written pre-formatted from RED-test forward. HALT-and-escalate semantics if lefthook fires unexpectedly.
**Sub-Z (Gherkin placement):** Single feature file `tests/e2e-cjm/features/phase17-tls.feature` with 3 scenarios.

## Deferred ideas

1. D2 cert-out-of-repo path (`~/.openwhispr/certs/`) — v3 candidate; strongest isolation guard
2. DNS-01 challenge / wildcard certs — SC #1 forbids; v3 if cloud-scale needs them
3. mkcert `--auto-install` flag — researcher rejected (sudo + non-Debian edge cases)
4. cert-manager 1.16.4 → 1.17.x bump — stay on 1.16 for stability
5. Hadolint / Trivy adoption — overlap with B1 + C1
6. mkcert CI integration — explicitly forbidden by PITFALLS §13

## Research artifacts

All 4 advisor researchers returned findings inline (didn't write `/tmp/` files due to "do not write summary md" instruction). Key findings embedded in CONTEXT.md `<decisions>` section.

- mkcert researcher: A2+B3+C1+D1; key insight: bootstrap.sh already mints `*.localhost` wildcard — must de-wildcard SAN list lines 358-371
- ACME+Helm researcher: A3+B3+C3+D1; key insight: `certManager` values block ALREADY exists — extend, not create
- Dev-cert isolation researcher: A2+B1+C1+D2-or-D1; key insight: Traefik build context is `compose/traefik/`, root `.dockerignore` does NOT apply
- Plan split researcher: Option B 3 plans; key insight: 17-01 + 17-03 can ship parallel (disjoint file trees)

## Claude's discretion items (no user input requested)

- D2 → D1 override (preserve status quo cert location; defer D2 to v3)
- PITFALLS §16 → §13 reference fix bundled inside 17-02 evidence commit (Sub-Z atomic)
- Compose overlay naming: `compose/docker-compose.acme.yml` (matches existing convention)
- README quickstart step 2: `make tls-trust` after `cp .env.example .env`, before `docker compose up`
- Air-gap doc section in `docs/operations.md#air-gap-mkcert` covers 5 items (macOS mirror, Linux mirror, checksum, PATH install, `mkcert -install` air-gap caveat)
- Commit body wording: each commit explicitly cites test gate (codemod tests, helm-unittest, lefthook lint CLI)
