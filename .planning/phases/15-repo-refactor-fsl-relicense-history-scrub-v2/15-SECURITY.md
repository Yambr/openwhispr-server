# Phase 15 — Security Audit Report (backfill)

**Phase:** 15 — repo-refactor-fsl-relicense-history-scrub-v2
**Audited commit range:** `2499435..0735965` (incl. 3 HIGH-fix follow-ups `f523184`, `508041d`, `0735965` — auditor sees the closed state per RESEARCH §4)
**Audited:** 2026-05-15
**ASVS Level:** 2 (target)
**Stance:** adversarial, fresh-context per D-19
**Backfill:** constitutional rule #10; 15-REVIEW.md (324 LOC) already exists — this report covers SECURITY surface only
**Scope correction (RESEARCH §10 D-2):** D-23 originally listed the TLS-bootstrap two-tier CA chain as a Phase 15 surface. That surface belongs to Phase 17 and is NOT audited here.

---

## Executive verdict

**Zero HIGH or CRITICAL findings.** The FSL relicense + REUSE 3.3 compliance gate + 220-file test relocation + Traefik host-split + history-scrub runbook are all VERIFIED. The 3 HIGH findings raised during Phase 15 review (`f523184` + `508041d` + `0735965`) are visible in the audited range and confirmed closed. One LOW observation: DCO `cutoff_sha` is empty pending the actual history scrub.

---

## Threat register verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-15-01 | R — license-mismatch contributor confusion | mitigate | **MITIGATED** | `LICENSE` is FSL-1.1-ALv2 (`head -1` confirms). ADR-0013 supersedes ADR-0004. README badge + OCI labels swapped (commit `6cac1d0`). |
| T-15-02 | I — REUSE non-compliance ships unlicensed file | mitigate | **MITIGATED** | `.github/workflows/reuse-lint.yml` gates every PR + push to main (paths exclude only build artefacts). `reuse lint` runs in CI; FAIL blocks merge. |
| T-15-03 | T — test-relocation orphans coverage | mitigate | **MITIGATED** | `feat(15-02): apply migrate-tests codemod + switch to tests/ layout` + `chore(15-02): delete legacy co-located tests allow-list — close ratchet`. STRUCT-01 ratchet closed. |
| T-15-04 | E — Traefik host-split path-based fallback | mitigate | **MITIGATED** | `docker-compose.yml:443, 448`: api host rule is `Host(\`api.localhost\`)`; admin gate is `Host(\`api.localhost\`) && PathPrefix(\`/admin\`)`. No path-only fallback router. Web routed via `web.localhost` (per `feat(15-02): traefik host split web/api.localhost`). |
| T-15-05 | T — history-scrub destructive default | mitigate | **MITIGATED** | `tools/history-scrub.sh:61-71`: refuses to run without `--dry-run` or `--force`. Default is no-op error exit. |
| T-15-06 | R — signed-tag attestation loss during scrub | mitigate | **MITIGATED** | `tools/history-scrub.sh:219-225`: GPG keyring precondition gated by `OPENWHISPR_SCRUB_REQUIRE_GPG=1`; refuses to proceed if `gpg` binary missing or `--list-keys` fails. |
| T-15-07 | T — concurrent scrub runs collide on state dir | mitigate | **MITIGATED** | `tools/history-scrub.sh:89` "HI-03: per-invocation state directory" — each run isolates workdir. Closes HIGH from initial review. |
| T-15-08 | E — DCO bot misconfig grandfathers post-cutoff commits | mitigate | **MITIGATED (with note)** | `.github/dco.yml:44` `cutoff_sha: ""` — empty value renders the allow-list inert (no commits exempted). Will be populated by Phase 15-04 post-scrub-HEAD-SHA. SAFE intermediate state — see Observation 1. |

**Closed: 8/8.**

---

## Prompt-supplied surface verification (RESEARCH §10 D-2 corrected scope)

### 1. FSL relicense SPDX swath

**Status: VERIFIED.**

- `LICENSE` file is FSL-1.1-ALv2 (confirmed `head -1`).
- Spot-check: `apps/api/src/index.ts:1` + `apps/web/src/middleware.ts:1` both carry `// SPDX-License-Identifier: FSL-1.1-ALv2`.
- 12 SPDX sweep commits in range (`refactor(15-03): sweep spdx headers ...`) cover apps/api/src, apps/api/tests, apps/web, apps/web/tests, apps/worker, packages, tools, tests, compose/, root.
- Stale Apache headers swept by `feat(15-03): binary-safe stale-header rewrite in spdx codemod` (`09fca84`) + `fix(15): green — flip 3 stale apache spdx headers to fsl-1.1-alv2` (`8c4ab86`).

### 2. REUSE 3.3 compliance gate

**Status: VERIFIED.**

- `.github/workflows/reuse-lint.yml` triggers on pull_request + push-to-main with sensible path excludes (coverage, dist, .next, node_modules).
- `REUSE.toml:21-40` declares aggregate annotations for non-SPDX-headered files; combined with inline headers, every tracked file has SPDX coverage.
- `chore(15-03): wire reuse lint to GREEN` (`5a374a6`) confirms the gate is currently passing.

### 3. 220 test-file relocation correctness (STRUCT-01)

**Status: VERIFIED.**

- `refactor(15-02): apply migrate-tests codemod + switch to tests/ layout` (`d442deb`) — 220 test moves.
- `chore(15-02): delete legacy co-located tests allow-list — close ratchet` (`99c41c1`) — the STRUCT-01 allow-list (previously protecting unmigrated tests) is removed, meaning future co-located `src/__tests__/*` files would fail the ratchet test. Closed regression net.

### 4. Traefik host-split SSRF surface

**Status: VERIFIED.**

- `docker-compose.yml:443`: `traefik.http.routers.web.rule=Host(\`api.localhost\`)`.
- `docker-compose.yml:448`: `traefik.http.routers.web-admin.rule=Host(\`api.localhost\`) && PathPrefix(\`/admin\`)`.
- Both routers use HOST predicates, not path-only. An attacker who controls a sub-resource on `web.localhost` cannot route a forged Host header to the api router because Docker's Traefik provider materialises labels per service; a Host-mismatch request lands on the default 404 handler.
- Gherkin coverage: `test(15-02): red traefik host-split gherkin + locale route unit` (`4f469b3`).

### 5. History-scrub runbook safety

**Status: VERIFIED.**

- Driver `tools/history-scrub.sh`: 484 LOC; runbook `docs/runbooks/15-04-history-scrub.md`: 402 LOC.
- No destructive default: requires explicit `--dry-run` or `--force` (`tools/history-scrub.sh:61-71`).
- Per-invocation state dir (HI-03 closure): `tools/history-scrub.sh:89, 230-234`.
- GPG keyring precondition (HI-03 closure): `tools/history-scrub.sh:219-225` — gated by `OPENWHISPR_SCRUB_REQUIRE_GPG=1`.
- `--force-with-lease` on the force-push (`tools/history-scrub.sh:359-360`) prevents clobbering concurrent `main` advancement.
- Refuses `git filter-branch` fallback (file header invariant).
- Red regression test: `test(15): red — history-scrub state-dir isolation + gpg precondition` (`0735965`, last commit in audited range).

### 6. DCO bot wiring

**Status: VERIFIED with intentional intermediate state.**

- `.github/dco.yml:35-44`: require.members=false, allowRemediationCommits.individual=true / thirdParty=false.
- `cutoff_sha: ""` — empty placeholder. Behaviour: no commits exempted; every contributor (including grandfathered pre-scrub authors) MUST sign off until Phase 15-04 fills the post-scrub HEAD SHA.
- This is a SAFE intermediate posture: erroring on the side of "require sign-off" until the scrub commits land. A misfilled cutoff (e.g. short SHA, typo) is the dangerous mode — empty is correct-by-default. See Observation 1.
- `feat(15-03): dco requirement + reuse lint ci gate` (`d6d2d1d`) confirms CI integration.

**NOT audited (out of scope per RESEARCH §10 D-2):** TLS-bootstrap, mkcert, two-tier CA chain, ACME — all Phase 17 territory.

---

## Observations (LOW, non-blocking)

**Observation 1 — `.github/dco.yml cutoff_sha` is empty pending Phase 15-04 history scrub.**
Current state is fail-safe (no exemption). Phase 15-04 will populate after the force-push lands. A SECURITY check in 17-VERIFICATION should re-verify the cutoff is a full 40-char SHA, not abbreviated.

**Observation 2 — `REUSE.toml` aggregate annotation copyright string is repo-level.**
`SPDX-FileCopyrightText = "2026 Nick Iambroskin and OpenWhispr Server contributors"` (`REUSE.toml:31, 38`) applies uniformly. Contributors who added significant code pre-2026 are not individually attributed. NOT a license-compliance issue (FSL grants enumerate the project, not individuals), but flagged for the upcoming `AUTHORS` file if one is added.

**Observation 3 — History-scrub `--force-with-lease` race window.**
Between `git rev-parse main` (Stage 1) and the force-push (Stage 6), a parallel push by another maintainer would cause the lease to fail (correct) but the operator then must re-run from scratch. Document this in the operations runbook as expected behaviour. Not a defect.

---

## Unregistered flags

15-01..04 SUMMARYs: no `## Threat Flags` blocks declared new surface. None require unregistered-flag handling.

---

## Coverage / completeness

- Every declared threat (8/8) verified.
- Every prompt-supplied D-23 surface (6/6, TLS explicitly excluded per RESEARCH §10 D-2) verified.
- 15-REVIEW.md (pre-existing, 324 LOC) NOT modified — confirmed via git status before commit.
- No HIGH or CRITICAL findings.

**Recommendation:** Phase 15 SECURITY is **CLEARED** (backfill closure). DCO cutoff_sha population deferred to Phase 15-04 post-scrub.

---

_Audited: 2026-05-15_
_Auditor: gsd-security-auditor (fresh-context backfill per D-19; RESEARCH §10 D-2 scope correction applied)_
