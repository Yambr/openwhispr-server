# Phase 18 — Pattern Map (LDAP / Keycloak SSO — SPEC + ADR Only)

**Mapped:** 2026-05-15
**Plan model:** Option A — single `18-01-PLAN.md`, 4 atomic waves
**Artefacts:** 6 files touched (1 ROADMAP edit + 1 SPEC + 1 ADR + 1 .feature + 1 .steps.ts + 1 compose YAML + 1 customer-journeys.md edit; new directory `compose/test/`)
**Pattern source confidence:** HIGH — every analog inspected at exact line numbers below.

---

## Wave Classification

| Wave | Concern | Files (create / modify) | Role | Closest Analog | Match |
|------|---------|-------------------------|------|----------------|-------|
| 1 | ROADMAP cleanup | M `.planning/ROADMAP.md` | doc-edit (surgical) | commit `ecd81c8` (Phase 16-02 ROADMAP wording fix) | exact |
| 2 | SPEC artefact | C `.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md` (≤ 200 L) | spec | `.planning/phases/07-frontend-ui-spec/07-SPEC.md` (only existing in-tree SPEC.md) | role-match (07-SPEC is 216 L — sane upper bound for "≤ 200" target) |
| 3 | ADR + survey | C `docs/adrs/0012-ldap-via-keycloak.md` | ADR | `docs/adrs/0013-fsl-relicense.md` (most recent ADR) + `docs/adrs/0009-better-auth-…oidc-plugin.md` (predecessor decision) | exact-template + role-match |
| 4a | Gherkin scenarios | C `tests/e2e-cjm/features/sso/keycloak-oidc.feature` | gherkin | `tests/e2e-cjm/features/phase17-tls.feature` | exact |
| 4b | Step defs (pending) | C `tests/e2e-cjm/steps/sso.steps.ts` | step-defs (pending-impl) | `tests/e2e-cjm/steps/locale.steps.ts` | exact |
| 4c | Fixture stub | C `compose/test/keycloak.yml` (new dir) | compose-overlay (test) | `compose/docker-compose.contract-test.yml` | role-match (top-level `compose/`, NOT `compose/test/` — directory is novel) |
| 4d | CJM doc rows | M `docs/customer-journeys.md` (6 new `### @cjm-sso-N.M` anchors) | doc-edit (append section) | `docs/customer-journeys.md:194-232` (Phase 12 admin-onboarding rows w/ `after-phase-12` marker — most recent "deferred-phase" precedent) | exact |

---

## Wave 1 — ROADMAP Cleanup

### Surgical replacement (Phase 18 plans-list)

**Target file:** `.planning/ROADMAP.md`
**Target lines:** 810-813 (the four bullet lines under `**Plans**: 3 plans`).

Current state (lines 810-813, verbatim wrong — copy-pasted from Phase 17):

```
**Plans**: 3 plans
  - [ ] 17-01-PLAN.md — Dev toolchain (`make tls-trust`, mkcert wiring, …)
  - [ ] 17-02-PLAN.md — Isolation enforcement (…)
  - [ ] 17-03-PLAN.md — Production ACME (…)
```

Replacement target:

```
**Plans**: 1 plan
  - [ ] 18-01-PLAN.md — SPEC + ADR + red Gherkin + Keycloak fixture stub (4 atomic waves: ROADMAP cleanup, SPEC-ldap-keycloak.md, ADR-0012 + operator-demand survey, Gherkin scenarios + compose/test/keycloak.yml + customer-journeys.md rows)
```

### ADR-0012 slot context (commit-body only, no file change)

`docs/adrs/` listing confirmed: `0011-…md` exists, `0012-*.md` is **absent**, `0013-fsl-relicense.md` exists (Phase 15 took the slot out of order). Phase 18 occupies 0012. Cross-reference this in the Wave 1 commit body (NOT in any artefact) so future readers stop searching for the missing 0012.

### Phase-16 precedent (in-wave ROADMAP cleanup, NOT scope-creep PR)

- Commit `ecd81c8` — `docs(16-02): correct roadmap + requirements wording (q1 q3 + concern-2)`
- Confirms: ROADMAP wording fixes land **inside** the active plan's wave commits, NOT as a separate scope-stretch PR. Diff touched `.planning/ROADMAP.md` lines 54 + 770-784 in a single commit alongside REQUIREMENTS narrative + PATTERNS-driven inline corrections.
- Phase 18 Wave 1 commit message style: `docs(18-01): correct phase-18 plans-list + adr-0012 slot note`.

---

## Wave 2 — SPEC Artefact

### Closest analog: `.planning/phases/07-frontend-ui-spec/07-SPEC.md`

**Length:** 216 lines (Phase 18 target ≤ 200; PITFALLS §14 line 441 hard cap).

**Frontmatter shape (07-SPEC lines 1-10):**

```yaml
---
phase: 07-frontend-ui-spec
type: spec
status: locked
created: 2026-05-12
ambiguity_at_close: 0.143
ambiguity_dimensions:
  goal_clarity: 0.90
  …
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
---
```

Phase 18 SPEC frontmatter should mirror this — `requirements: [SSO-01, SSO-02]` (SSO-03/04/05 close in later waves; SPEC carries only the two it answers).

**Section skeleton (07-SPEC lines 12 → 60):**

1. `# Phase 18 — SPEC: LDAP / Keycloak SSO`
2. `## Purpose`
3. `## Goal`
4. `## In Scope` / `## Out of Scope` (use `| # | Concern | Notes |` tables — 07-SPEC convention)
5. PITFALLS §14 mandates these as section headers:
   - **Decision** (option a vs b, one-paragraph rationale)
   - **Open questions for v3 plan** (3-5 max)
   - **Operator survey results** (informal anonymised notes — cross-reference ADR-0012 embedded survey instead of duplicating)
   - **LDAP server scope for v3** (pick ONE: OpenLDAP via testcontainers; explicit non-goal "no 389DS / AD until paying customer asks")

### Env-vars block — language to mirror

**Source:** `apps/api/src/auth.ts:11-13` triple-comment block, verbatim language:

> "OIDC is silently disabled when any of OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET is unset (D-02). genericOAuth is registered only when all three are present; the smoke test pins both env permutations."

Mirror this exact tone in the SPEC's "Env vars (loud-fail BYOK)" table comment for the 7 new vars (OIDC_TENANT_CLAIM, OIDC_TENANT_MAPPING, OIDC_GROUP_CLAIM, OIDC_ROLE_MAPPING, OIDC_ROLE_PRIORITY, OIDC_DEFAULT_ROLE, OIDC_REVOCATION_MODE). Phase 18 SPEC does NOT implement the loud-fail; it names the call site (`lib/oidc-jit-config.ts` — a v3 file) and references the existing `lib/oidc-providers.ts` triplet validation as the shape.

### ADR-0009 framing as "extension of established decision"

**Source:** `docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md:30-43`:

> "Generic OIDC client plugin for upstream IdPs (Keycloak / Authentik / Azure AD / Okta / Google) — corporate operators set provider URLs and client credentials via env, no code change required."

The SPEC's "Decision" paragraph must lean on this commitment by name: Phase 18 chose option (a) because ADR-0009 already wired the surface; option (b) would require building a Better Auth plugin OpenWhispr does not own. Use `apps/api/src/auth.ts:39,209` as the proof-by-reference (the `genericOAuth` import + registration).

### Phase 14 research-distillation pattern

Phase 14's `14-CONTEXT.md` and 14-RESEARCH-*.md split research from spec. Phase 18 keeps SPEC as a distilled output of the 4 advisor researchers' inline returns (see `18-DISCUSSION-LOG.md:98-105`). No separate RESEARCH-*.md gets written; SPEC absorbs the distilled findings.

---

## Wave 3 — ADR-0012 + Operator-Demand Survey

### Template: `docs/adrs/0000-template.md`

Exact 6 sections, in order:

1. `**Status:** proposed | accepted | superseded by ADR-XXXX | deprecated` (line 3)
2. `**Date:** YYYY-MM-DD` (line 5)
3. `**Phase:** <phase number / name>` (line 7)
4. `## Context` (line 9)
5. `## Decision` (line 13)
6. `## Consequences` (line 17)
7. `## Alternatives considered` (line 21)
8. `## References` (line 25)

### Best richer-analog: `docs/adrs/0013-fsl-relicense.md`

Most recent ADR (Phase 15, 2026-05-15). Demonstrates **extended-template** shape ADR-0012 should adopt:

- SPDX header comment block (lines 1-5) — FSL-1.1-ALv2 (Phase 15 relicense locked the project SPDX target)
- `## Recovery (for downstream consumers who need to stay on Apache-2.0)` (line 157) — **novel section**. Precedent: ADRs MAY introduce one-off sections between `Consequences` and `Alternatives considered` when warranted.
- `## Retroactive consent` (line 193) — second novel section, embeds survey-style content.
- Alternatives-considered as a **table** with `| Alternative | Why rejected |` columns (line 219).

### Survey-embedded-in-ADR — novel pattern, but ADR-0013 establishes the precedent

PITFALLS §14 line 444 mandates "Operator survey results (even informal): which corp ops want which option". CONTEXT.md Q5 locks this as **embedded** in ADR-0012 (not a separate `SURVEY.md`). ADR-0013's `## Retroactive consent` section is the closest precedent for an ADR carrying participant-record-style content. Phase 18 introduces:

```
## Operator demand (informal survey, anonymised)
```

…between `Consequences` and `Alternatives considered`. 3-5 anonymised notes max ("Operator A — financial-services corp running Keycloak fronting Active Directory; expects OIDC frontend"). Risk callout: **no exact precedent for this section name** — first ADR to embed a survey. Verifier should NOT flag it as off-template; SC #4 explicitly calls for it.

### Predecessor link

ADR-0012 `## References` must cite **ADR-0009 as the predecessor decision** (not superseded — extended). Use ADR-0013:240 shape:

```
- **Predecessor ADR (extended, not superseded):** [ADR-0009](./0009-better-auth-email-password-and-oidc-plugin.md)
```

### Open questions for v3 (5 items, locked in CONTEXT.md decisions Q5)

ADR-0013 has no `## Open questions for v3 plan` section — Phase 18 introduces it (PITFALLS §14 line 443 mandates "3-5 max"). The 5 items (per CONTEXT.md):

1. Keycloak version pin (`26.0` chosen; revisit when 27 ships).
2. group→role exact JSON map format (`OIDC_ROLE_MAPPING` schema lock).
3. JIT auto-create policy (reject vs auto-onboard on missing tenant claim).
4. LDAP server scope for v3 fixture (OpenLDAP locked; 389DS/AD deferred).
5. Authentik as second-class documented option (no fixture in v3).

### ADR header conventions confirmed

- Status values: `proposed | accepted | superseded by ADR-XXXX | deprecated` (template line 3). Phase 18 starts as `accepted` (decision pre-locked per CONTEXT.md).
- Date format: `YYYY-MM-DD` — `2026-05-15` for Phase 18.
- No `Tags:` field exists in any in-tree ADR. Do not introduce one.

---

## Wave 4a — Gherkin Feature File

### Closest analog: `tests/e2e-cjm/features/phase17-tls.feature`

Most recent .feature (Phase 17). Pattern to copy:

**SPDX + multi-line provenance block (lines 1-16):**

```
# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 17 / Plan 02 — TLS journey scenarios.
#
# Three scenarios under @phase-17 @tls:
#   1. @cjm-tls-trusted-localhost — …
```

Mirror for Phase 18: `# Phase 18 / Plan 01 / Wave 4 — SSO journey scenarios.` listing all 6 `@cjm-sso-N.M` anchors in the header.

**Feature-level tag line (line 17):** `@phase-17 @tls` → Phase 18: `@phase-18 @sso`

**Scenario-level tag pattern (line 20):** `@cjm-tls-trusted-localhost @after-docker-up @expected-red` → Phase 18:

```
@cjm-sso-1.1 @expected-red @after-phase-19 @after-keycloak-up
```

### CRITICAL — Mode-3 linter constraint

**Source:** `tools/lint-cjm-doc.ts:201-216` — `lintExpectedRedPairing` asserts `@expected-red` MUST carry a paired `@after-phase-N`. Phase 18 uses `@after-phase-19`. Risk: Phase 19 is NOT yet on ROADMAP. The linter at line 201-216 only checks that **some** `@after-phase-N` tag exists; it does NOT validate N maps to a registered ROADMAP phase. Safe to use `@after-phase-19` ahead of Phase 19's ROADMAP entry being authored.

### Skip-tag precedent

**Source:** `tests/e2e-cjm/features/locale-switch.feature:6` — `@cjm-6.1 @expected-red @after-phase-15`. Identical 3-tag scenario decoration. Phase 18 adds a 4th tag `@after-keycloak-up` (compose-stack precondition, parallel to Phase 17's `@after-docker-up`).

---

## Wave 4b — Step Defs (Pending-Impl)

### Closest analog: `tests/e2e-cjm/steps/locale.steps.ts`

**Pattern to mirror (locale.steps.ts:26-49):**

```typescript
Given("the user is on the public sign-up page", async ({ tenantId }) => {
  stateFor(tenantId);
  throw new Error("locale UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
});
```

Phase 18 pattern:

```typescript
throw new Error("keycloak SSO ships in Phase 19 — @cjm-sso-N.M stays @expected-red");
```

Same shape: import `Given/When/Then` from `../support/world`; throw on every body; carry per-scenario tenantId state via `Map<string, ScenarioState>` (locale.steps.ts:11-24).

Prevents spurious GREEN if someone strips `--grep-invert "@expected-red"` from `Makefile:466`.

---

## Wave 4c — Compose Fixture Stub

### Closest analog: `compose/docker-compose.contract-test.yml`

**Pattern conventions copied:**

- Header block: `# Phase 14 / Plan 14-03 — Contract-test overlay.` style comment with the `docker compose -f … -f compose/<overlay>.yml up -d` usage example (contract-test:6-11).
- Network `openwhispr_internal` (contract-test:23).
- Healthcheck shape (contract-test:26-31): `test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:9000/livez"]` + `interval: 5s timeout: 3s retries: 5 start_period: 5s`. Keycloak healthcheck target: `http://localhost:9000/health/ready` (management port 9000 native, since Keycloak 25+).
- Image pinning by exact tag — never `:latest`.
- Volume mount for ro RO config (contract-test:99): `./compose/traefik/certs/root-ca.crt:/certs/root-ca.crt:ro` — Phase 18 mirrors with `./compose/test/keycloak/:/opt/keycloak/data/import:ro` for the (empty) realm-import directory.

### Risk callout — `compose/test/` directory is NOVEL

Confirmed: `ls compose/test` → directory does NOT exist. Every existing overlay lives at `compose/docker-compose.*.yml` top-level. Phase 18 introduces the `compose/test/` subdirectory to keep test-only stacks separate from production overlays. Plan must include:

1. Implicit directory creation via committing `compose/test/keycloak.yml` (git tracks the parent path).
2. Empty `compose/test/keycloak/` import directory — needs a `.gitkeep` so the directory survives `git add`. Scenario `@cjm-sso-1.6` (loud-fail on missing realm) depends on this directory being **empty** in v2.

### Keycloak 26 image conventions (locked in CONTEXT.md Q3)

- Image: `quay.io/keycloak/keycloak:26.0` (exact tag pin, not floating).
- Env vars: `KC_BOOTSTRAP_ADMIN_USERNAME` + `KC_BOOTSTRAP_ADMIN_PASSWORD` (canonical from KC 25+; `KEYCLOAK_ADMIN_*` deprecated and removed-by-default in 26).
- Command: `command: ["start-dev", "--import-realm"]` — `start-dev` because fixture stub does not need TLS termination (the openwhispr_internal network does that via Traefik in the parent overlay).
- Healthcheck: `/health/ready` on port 9000 (KC 25+ exposes /health on the management port, not the main HTTP port).
- Profile: `--profile sso` so Keycloak does not boot by default (mirrors `compose/docker-compose.observability.yml`'s opt-in shape).

---

## Wave 4d — `docs/customer-journeys.md` Rows

### Closest analog: `docs/customer-journeys.md:194-232` (Phase 12 admin-onboarding)

The 6 SSO rows append at the **end** of the file (current line 323), as a new section `## 9. SSO via Keycloak (after-phase-19)`. Sort by `@cjm-N.M` major number — append, do NOT splice into existing sections.

**Heading shape (customer-journeys:194 precedent):**

```
### @cjm-5.1 /admin reaches a real page (after-phase-12 — currently @expected-red)
```

Phase 18 row example:

```
### @cjm-sso-1.1 First-time JIT user creation from OIDC ID token (after-phase-19 — currently @expected-red)
```

Each row needs:
- Heading with `@cjm-sso-N.M` anchor (linter `tools/lint-cjm-doc.ts:69-89` greps for `### @cjm-N.M` exact pair).
- Body paragraph (customer-journeys:31-35 shape).
- `- Backend error branches:` sub-list (customer-journeys:36-37).
- `- Silent-failure modes:` sub-list (customer-journeys:38-40).

### Linter contract — Mode 1 + Mode 2

- **Mode 1** (lint-cjm-doc:90-107): each major (here, `sso-1`) needs ≥ 2 anchors. Phase 18 ships 6 — passes.
- **Mode 2** (lint-cjm-doc:172-195): every `.feature` `@cjm-sso-N.M` tag MUST have a matching `### @cjm-sso-N.M` anchor in `docs/customer-journeys.md`. **Wave 4 must commit feature + steps + customer-journeys atomically** — splitting them red-lights CI.

### Note on the (slight) naming surprise

CONTEXT.md L188 and ROADMAP both say "**docs/cjm.md**". The actual file is `docs/customer-journeys.md` (verified). Treat CONTEXT/ROADMAP references to `docs/cjm.md` as the canonical CJM doc; the file is `docs/customer-journeys.md`. Plan should call it by its real path.

---

## Shared Patterns (cross-wave)

### SPDX header on every new file

**Source:** ADR-0013 (Phase 15 relicense lock — every new file under `apps/`, `packages/`, `tools/`, `compose/`, `scripts/`, `.github/`, tests carries `SPDX-License-Identifier: FSL-1.1-ALv2`).

Phase 18 file-by-file:

| File | Header form |
|------|-------------|
| `SPEC-ldap-keycloak.md` | `<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->` (top, before frontmatter) — mirrors 07-SPEC.md (Apache-era predecessor — Phase 18 is post-relicense so FSL applies) |
| `docs/adrs/0012-…md` | HTML comment block lines 1-5, FSL-1.1-ALv2 + `<!-- REUSE-IgnoreStart -->` / `<!-- REUSE-IgnoreEnd -->` wrappers (verbatim from ADR-0013:1-5 + line 245) |
| `tests/e2e-cjm/features/sso/keycloak-oidc.feature` | `# SPDX-License-Identifier: FSL-1.1-ALv2` line 1 (phase17-tls.feature:1) |
| `tests/e2e-cjm/steps/sso.steps.ts` | `// SPDX-License-Identifier: FSL-1.1-ALv2` line 1 (locale.steps.ts:1) |
| `compose/test/keycloak.yml` | YAML comment line 1: `# SPDX-License-Identifier: FSL-1.1-ALv2` |
| `.gitkeep` in `compose/test/keycloak/` | empty file — REUSE.toml glob covers (no inline header needed) |

### English-only (CLAUDE.md hard rule)

Every artefact text English-only. No Russian copy in fixture or spec (runtime localisation is for end-user UI, not operator-facing SSO docs).

### `--no-verify` prediction: 0

All touched globs are `.md` / `.feature` / `.yml` / `.gitkeep` — outside biome glob (biome runs only on `.ts`/`.tsx`/`.js`/`.jsx`). Phase 16 + 17 confirmed identical pattern across 60+ commits.

---

## Risk Callouts (no precedent)

| Risk | Mitigation |
|------|-----------|
| **Operator-demand survey shape** — no prior ADR embeds a survey section. ADR-0013's `## Retroactive consent` is the loosest precedent. | SC #4 mandates it; verifier should NOT bounce. Document the novelty in the Wave 3 commit body. |
| **`compose/test/` directory create** — every other compose overlay is at top-level `compose/`. | Plan calls out the new subdirectory explicitly. Add `.gitkeep` in `compose/test/keycloak/` so the empty import-dir survives `git add`. |
| **`@after-phase-19` tag** — Phase 19 not yet on ROADMAP. v3 milestone planning is post-Phase-18 work. | Linter `tools/lint-cjm-doc.ts:201-216` only checks `@after-phase-N` syntax exists, NOT that N maps to a registered phase. Safe. |
| **CONTEXT.md says `docs/cjm.md`, real path is `docs/customer-journeys.md`** | Plan uses real path. Do not introduce a `docs/cjm.md` alias. |
| **SPEC ≤ 200 lines** is a hard cap (PITFALLS §14 line 449 — warning sign "SPEC >500 lines"). 07-SPEC is 216 L. | Author SPEC with section budget table up-front: Purpose+Goal (15 L), Decision (20 L), Worked example (30 L), Env table (25 L), 7 failure modes (40 L), Open questions (20 L), Operator survey ref-to-ADR (10 L), References (15 L) = ~175 L. Leaves 25 L slack. |

---

## Cross-Wave Dependencies

1. **Wave 1 → Wave 4d**: Wave 1's plans-list fix references filename `18-01-PLAN.md`. That filename IS this plan. Circular-but-fine — the filename is locked by the planner naming convention BEFORE Wave 1 lands.
2. **Wave 2 → Wave 3**: SPEC's "Operator survey results" section references ADR-0012's embedded survey. ADR-0012 doesn't exist yet at Wave 2 commit time. Use forward-reference language ("see ADR-0012 § Operator demand"); ADR is authored next wave.
3. **Wave 3 ⇄ Wave 2**: ADR-0012's `## References` section cites the SPEC. SPEC lands first (Wave 2), so reference is valid by Wave 3.
4. **Wave 4a + 4b + 4d MUST commit together** — splitting them red-lights `tools/lint-cjm-doc.ts` Mode 2 (orphan `@cjm-sso-N.M` tags with no doc anchors).
5. **Wave 4c independent** — `compose/test/keycloak.yml` and `.gitkeep` are not linted by lint-cjm-doc; could split into a 5th commit if reviewer asks, but the CONTEXT.md plan-shape says 4 atomic waves so keep 4c inside Wave 4's commit.

---

## Files Inventory

**Create (5 new files + 1 .gitkeep):**

1. `.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md`
2. `docs/adrs/0012-ldap-via-keycloak.md`
3. `tests/e2e-cjm/features/sso/keycloak-oidc.feature`
4. `tests/e2e-cjm/steps/sso.steps.ts`
5. `compose/test/keycloak.yml`
6. `compose/test/keycloak/.gitkeep`

**Modify (2 files):**

1. `.planning/ROADMAP.md` (Wave 1 — lines 810-813 surgical replace)
2. `docs/customer-journeys.md` (Wave 4d — append `## 9. SSO via Keycloak` section + 6 `### @cjm-sso-N.M` anchors)

**Do NOT touch (locked by v2 / v3 boundary):**

- `apps/api/src/auth.ts` — `genericOAuth` already wired (Phase 02 ADR-0009); Phase 18 = SPEC-only.
- `Makefile` (no `SSO=1` switch; deferred to Phase 19 / 19-01).
- Any `packages/data/migrations/*.sql` — JIT spec confirmed no migration needed (CONTEXT.md L62: `account.provider_id+account_id+tenant_id UNIQUE` already in place).

---

## Pattern Provenance (file:line summary)

| Pattern | Source | Lines |
|---------|--------|-------|
| ADR template (8 sections) | `docs/adrs/0000-template.md` | 1-28 |
| ADR extended-template (novel sections OK) | `docs/adrs/0013-fsl-relicense.md` | 157-216 |
| ADR "extension of established decision" framing | `docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md` | 24-45 |
| SPEC frontmatter + section shape | `.planning/phases/07-frontend-ui-spec/07-SPEC.md` | 1-50 |
| Env triplet loud-fail tone | `apps/api/src/auth.ts` | 11-13 |
| Feature SPDX + multi-line provenance + Scenario tag triple | `tests/e2e-cjm/features/phase17-tls.feature` | 1-21 |
| `@expected-red` + `@after-phase-N` skip pair | `tests/e2e-cjm/features/locale-switch.feature` | 6 |
| Mode-3 linter contract enforcing the pair | `tools/lint-cjm-doc.ts` | 201-216 |
| Mode-2 orphan-tag linter (forces atomic Wave 4 commit) | `tools/lint-cjm-doc.ts` | 172-195 |
| Pending-impl `throw new Error("…stays @expected-red")` step defs | `tests/e2e-cjm/steps/locale.steps.ts` | 26-49 |
| Compose overlay (header + healthcheck + RO volume) | `compose/docker-compose.contract-test.yml` | 1-99 |
| CJM doc heading + sub-lists shape | `docs/customer-journeys.md` | 29-50, 194-232 |
| ROADMAP in-wave cleanup precedent | commit `ecd81c8` (`docs(16-02): correct roadmap + requirements wording`) | — |
| Phase-18 plans-list bug | `.planning/ROADMAP.md` | 810-813 |
| ADR-0012 slot reservation (sequence 0011 → 0013 gap) | `docs/adrs/` directory listing | — |
| PITFALLS §14 SPEC bloat cap (≤ 200 L) | `.planning/research/PITFALLS.md` | 441-454 |

**Pattern extraction date:** 2026-05-15
**Phase 18 target close:** v2 milestone close (post-Phase-18 merge).
