---
phase: 15-repo-refactor-fsl-relicense-history-scrub-v2
reviewed: 2026-05-15T00:00:00Z
reviewer: gsd-code-reviewer (Claude Opus 4.7 1M-context, FORCE stance)
depth: deep
commit_range: f84d809..HEAD (45 commits)
files_reviewed: 18
files_reviewed_list:
  - tools/history-scrub.sh
  - tools/history-scrub.test.sh
  - tools/spdx-header.ts
  - tools/__tests__/spdx-header.test.ts
  - tools/migrate-tests.ts
  - tools/lint-colocated-tests.ts
  - vitest.config.ts
  - biome.json
  - apps/api/src/routes/locale.ts
  - apps/api/tests/unit/routes/__tests__/locale.test.ts
  - apps/api/src/routes/index.ts
  - compose/traefik/dynamic.dev.yml
  - .github/workflows/chart-release.yml
  - .github/workflows/conformance-axe.yml
  - .github/workflows/e2e-cjm.yml
  - .github/dco.yml
  - REUSE.toml
  - tests/e2e/mock-realtime/Dockerfile
  - tests/fixtures/idp/Dockerfile
findings:
  blocker: 0
  critical: 0
  high: 3
  medium: 6
  low: 4
  info: 3
  total: 16
verdict: APPROVE-WITH-FOLLOWUP
---

# Phase 15 — Adversarial Code Review

**Verdict: APPROVE-WITH-FOLLOWUP**

No BLOCKER or CRITICAL defects. Three HIGH-severity correctness/contract findings worth a fix commit before merging the operator force-push (15-04 execution); six MEDIUM items track legitimate follow-up issues (some already flagged by verifier). Plan-level execution discipline (TDD, atomic commits, English-only) is solid.

---

## HIGH

### HI-01: Stale `SPDX-License-Identifier: Apache-2.0` headers in 3 Phase-15 / Phase-12 files — FIXED 2026-05-15

**STATUS: FIXED** in commits `883e32a` (RED test) + `8c4ab86` (GREEN fix) on
`gsd-reviewfix/15-85726` (fast-forwarded to `main`). Three stale headers
flipped to `# SPDX-License-Identifier: FSL-1.1-ALv2`; `tools/spdx-header.ts`
extended with hash-comment audit + fix pair (`audit-hash` / `fix-hash`
subcommands) covering `.yml`/`.yaml`/`.sh`. Test suite grew to 80/80 GREEN
(was 52 baseline) and now includes three live-tree regression assertions on
the cited paths.

**Files:**
- `compose/traefik/dynamic.dev.yml:1` (authored in Phase 15 commit `dc7dab7`)
- `.github/workflows/conformance-axe.yml:1` (Phase 12, untouched by 15-03 sweep)
- `.github/workflows/e2e-cjm.yml:1` (Phase 12, untouched by 15-03 sweep)

**Issue:** After the 15-03 SPDX relicense sweep (commits `9eb014d..41f6628`) these three files still carry an inline `# SPDX-License-Identifier: Apache-2.0` line. `dynamic.dev.yml` is particularly bad: it was authored *during* Phase 15 (commit `dc7dab7`), so the misstatement is fresh. `reuse lint` is GREEN only because `REUSE.toml` aggregate-annotates `**/*.yml` with `precedence = "aggregate"` and FSL-1.1-ALv2 — the inline tag is overridden silently. A human reader, or a downstream SBOM consumer that prefers inline SPDX, will see the Apache claim and the FSL aggregate disagree.

The 15-03 codemod (`tools/spdx-header.ts`) only sweeps `.ts/.tsx/.js/.jsx/.mjs/.cjs`. The sweep commits' commit-bodies are silent about the 3-file YAML carve-out; this is a real gap, not an intentional exemption.

**Recommendation:** one-line fix per file — change the SPDX line to `# SPDX-License-Identifier: FSL-1.1-ALv2`. Optionally extend `tools/spdx-header.ts` (or a sibling `tools/spdx-header-yaml.ts`) to cover `*.yml`/`*.yaml`/`*.sh` audit so this class can't recur.

**Severity: HIGH** — license-attribution correctness on a relicense phase. Not a BLOCKER because `reuse lint` (the contractual gate) passes via aggregate.

---

### HI-02: New `GET /api/locale` route is undocumented in `docs/wire-contract.md` (BACKEND_SPEC drift) — FIXED 2026-05-15

**STATUS: FIXED** in commit `d966d78` on `gsd-reviewfix/15-85726`
(fast-forwarded to `main`). Added a "Phase 15 — Public locale negotiation
(TD-15.g)" section to `docs/wire-contract.md` documenting method, path,
auth posture (none/public), request headers (`Accept-Language`), response
envelope (`{"locale": "en"|"ru"}`), cache directives (`no-store`), rate
limit (60/min/IP), and wire-compat note. CONTRACT-01 negative-matrix
backfill tracked as a separate followup-issue stub per 15-REVIEW.md
guidance to keep this commit doc-only.

**File:** `apps/api/src/routes/locale.ts:69-82` (route registered) and `apps/api/src/routes/index.ts:236-240` (wired unconditionally).

**Issue:** `docs/wire-contract.md` enumerates every public/authenticated API endpoint the desktop client may speak to. `grep -n "/api/locale" docs/wire-contract.md` returns zero. CLAUDE.md constraint #4 (`Wire compatibility: every endpoint we serve matches BACKEND_SPEC.md byte-for-byte`) makes documentation of a new public wire-surface endpoint a contractual obligation, not a courtesy. Even though the route exists "to prove the Traefik host split reaches Fastify" (route comment line 9), once shipped it is part of the public surface and downstream OAuth/SDK generators may key off the doc.

**Recommendation:** add a `### GET /api/locale` section to `docs/wire-contract.md` under the public endpoints group with: method, no auth, request headers honored (`Accept-Language`), response envelope `{ locale: "en" | "ru" }`, cache directives, rate-limit budget (60/min/IP). Also cross-link it from `BACKEND_SPEC.md` if the upstream spec is mirrored.

**Severity: HIGH** — wire-surface drift is exactly what BACKEND_SPEC.md exists to prevent.

---

### HI-03: `tools/history-scrub.sh` — global `/tmp/scrub-workdir.path` + glob-pick rollback file is racy and operator-hostile — FIXED 2026-05-15

**STATUS: FIXED** in commits `0735965` (RED tests) + `508041d` (GREEN fix)
on `gsd-reviewfix/15-85726` (fast-forwarded to `main`). State files moved
to per-invocation `${REPO_ROOT}/.scrub-state/${RUN_ID}/` (gitignored);
`RUN_ID` overridable via `SCRUB_RUN_ID` for operator-pinned resume; Stage
9 consumes the rollback file after restore so a no-op re-run cannot
reapply stale state. New `OPENWHISPR_SCRUB_REQUIRE_GPG=1` gate adds a
pre-flight `gpg --list-keys` precondition AND a Stage 7 keyring
re-verification inside the bare mirror clone; explicit recovery
instructions on failure. `tools/history-scrub.test.sh` grew to 20/20
GREEN (Tests 8, 9, 10 are HI-03 regressions; Test 7 updated to pin
`SCRUB_RUN_ID` since the new contract is "stable when RUN_ID is pinned").

**File:** `tools/history-scrub.sh:276` (`echo "${WORKDIR}" > /tmp/scrub-workdir.path`), `:290-295`, `:311`, `:327`, `:376` (`ls -t /tmp/scrub-protection-rollback.*.json | head -1`).

**Issue:** Two distinct correctness defects:

1. **Cross-run pollution.** `/tmp/scrub-workdir.path` is a fixed path with no per-invocation suffix. If the script is interrupted mid-Stage 4 and re-run, it will re-clone into a new `WORKDIR` and silently overwrite `/tmp/scrub-workdir.path` — which the runbook docs as "idempotent". Idempotency in the script header (line 13) is real for *the absence of effect* but not for *state continuity across resumes*; a Stage-5+ rerun without Stage 4 (e.g. operator re-runs after fixing the GH token) reads a `WORKDIR` that may already have been `rm -rf`'d on Mac auto-`/tmp` reaper.

2. **`ls -t | head -1` rollback selection (line 376).** If the operator has run two scrub attempts (e.g. one aborted, one in progress), the wrong `rollback.*.json` may be selected. Worse, the `mktemp /tmp/scrub-protection-rollback.XXXXXX.json` template in Stage 3 (`:241`) leaves a 6-char suffix — collision-rare, not collision-free, and unrelated previous-day rollbacks are still on disk because nothing cleans them up. Stage 9 will silently restore a *different scrub's* protection state.

Bonus minor: on macOS, the `/tmp/scrub-workdir.path` file persists across reboots only on stock filesystems; if the operator's `/tmp` is `tmpfs` (Linux), reboot-during-scrub yields a missing-file precondition failure with the misleading message `workdir path not recorded — Stage 4 did not complete cleanly` (line 292) — actually it did complete; the OS lost the marker.

**Recommendation:** store both state files under `${REPO_ROOT}/.scrub-state/` (gitignored), use a single timestamped run-id (e.g. `RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"`) prefix-keyed, and at the top of the script emit `RUN_ID` to stderr so the operator can pin Stage 9 to a specific run via `--rollback-id`. Add a `--clean-state` mode for fresh starts. Also: after Stage 9 succeeds, `rm` the consumed rollback file so a future no-op re-run doesn't reapply stale protection.

**Severity: HIGH** — a stale rollback file restoring wrong branch-protection on `main` is a security-posture regression even if FSL-06 itself completes. Catch this before the operator runs the script.

---

## MEDIUM

### ME-01: 2 Dockerfiles missing `LABEL org.opencontainers.image.licenses="FSL-1.1-ALv2"` (FSL-03 partial)

**Files:** `tests/e2e/mock-realtime/Dockerfile`, `tests/fixtures/idp/Dockerfile`

**Issue:** Already flagged by verifier (15-VERIFICATION.md §7). Both are test/fixture images and never shipped to `ghcr.io`; ROADMAP FSL-03 phrasing "every Docker LABEL" is technically not met.

**Recommendation:** add the LABEL line immediately after `FROM` in both Dockerfiles, or carve them out explicitly via a comment + a documented exception in `REUSE.toml`'s description. One-line fix preferred.

**Severity: MEDIUM** — license-metadata completeness, not runtime risk.

---

### ME-02: `--no-verify` legacy biome errors lack a tracked follow-up issue

**Commits:** `d442deb` (15-02), `41f6628`, `57145b1`, `2e0eba0`, `7aeea9b`, `dcebdcd` (15-03)

**Issue:** Per CLAUDE.md "If a hook fails, investigate and fix the underlying issue" — the 6 commits' bodies document the lefthook patch-reapply defect + 21 pre-existing biome errors in test fixtures, but no GitHub issue exists to track either root cause. The `biome.json` `overrides` block (`biome.json:36-58`) silences the test-side rules forever; the lefthook tooling defect goes unticked.

**Recommendation:** open two follow-up issues (see "Followup-issue stubs" below). Keep the biome override block as-is but link it from the new issue.

**Severity: MEDIUM** — process discipline, not correctness.

---

### ME-03: `biome.json` `formatter.formatWithErrors: true` in the test-file override is constitutionally dubious

**File:** `biome.json:54-56`

**Issue:** `formatWithErrors: true` means biome will format even files that have parse errors — which can silently corrupt malformed test fixtures during a future `biome check --write`. This is scoped to `*.test.ts` / `*.test.tsx` / `*.spec.ts` (good), but couples format with parse-failure tolerance. The five rule-relaxations above it are defensible (test code uses `!`, `any`, `${}` strings). `formatWithErrors` is a different axis and was added to work around the lefthook defect, not as a test-code policy.

**Recommendation:** drop `formatWithErrors: true`; once the lefthook patch-reapply issue is fixed (ME-02), this knob becomes unnecessary. If kept, document *why* in the JSON via a sibling key comment (biome doesn't support JSON comments — add a `description` ADR cross-link instead).

**Severity: MEDIUM** — quiet-failure surface in a lint config.

---

### ME-04: `.github/dco.yml:44` `cutoff_sha: ""` is empty-string, not `null` — DCO bot semantics unclear

**File:** `.github/dco.yml:42-44`

**Issue:** The DCO GitHub App documentation specifies `allow.cutoff_sha` as a 40-char hex string; the inert/disabled state is documented inconsistently across forks. An empty string MAY be interpreted as "match every SHA" by some Probot DCO implementations (regex `^${cutoff_sha}` against any commit SHA matches everything when empty). The comment on line 33 claims "abbreviated SHAs are ambiguous and the DCO bot will refuse to load the config" — but it does not claim an empty SHA is safe.

**Recommendation:** prefer leaving the key *commented out entirely* (line 43 already has the commented form) and delete line 44, until 15-04 force-push completes. Or, set to a clearly-fake sentinel like `"0000000000000000000000000000000000000000"` (40 zeros — git impossible) and document that as the inert form.

**Severity: MEDIUM** — until the bot is installed, this is theoretical; once installed BEFORE 15-04 fills it, a misread could grandfather everything.

---

### ME-05: `tools/history-scrub.sh` Stage 7 `git verify-tag` enumerates tags inside a *bare mirror clone* — may not have GPG keyring access

**File:** `tools/history-scrub.sh:332-337`

**Issue:** The script `cd`s into `${WORKDIR}/${REPO}.git` (a `--mirror` clone, line 271) and runs `git verify-tag` to flag signed tags requiring manual re-sign. `git verify-tag` requires `gpg.program` and a keyring with the signer's public key — on a fresh CI runner or ephemeral workdir this often fails silently (the `>/dev/null 2>&1` swallows the error and the `if` clause returns false). Result: **signed tags will be silently classified as unsigned and the operator will skip manual re-sign**, breaking signature verification post-scrub.

**Recommendation:** detect signed tags structurally via `git for-each-ref --format='%(objecttype) %(refname:short)' refs/tags/ | awk '$1=="tag"' | xargs -n1 git cat-file -p | grep -l 'BEGIN PGP SIGNATURE'`, or pre-flight that `gpg --list-keys` returns at least the expected signer key before relying on `verify-tag`. At minimum, document the GPG-keyring requirement in the runbook precondition list.

**Severity: MEDIUM** — silent loss of signed-tag attestation through a history rewrite is the exact failure mode `15-RESEARCH-history-scrub.md` warned against.

---

### ME-06: Missing `15-01-SUMMARY.md` and `15-04-SUMMARY.md`

**Issue:** Verifier flagged. Every prior phase ships one SUMMARY per plan; 15-01 and 15-04 lack theirs. Audit-trail gap.

**Recommendation:** author both before phase close.

**Severity: MEDIUM**

---

## LOW

### LO-01: `tools/history-scrub.sh` `--help` output uses `sed -n '2,40p'` against `$BASH_SOURCE[0]` (line 66) — brittle to header edits

**File:** `tools/history-scrub.sh:66`

**Issue:** The hard-coded line range `2,40p` requires the help-text block stay anchored. Future SPDX-line edits or comment-block growth will silently misalign help output. Use a sentinel pair (`# HELP-START` / `# HELP-END`) and `awk '/HELP-START/,/HELP-END/'` instead.

---

### LO-02: `apps/api/src/routes/locale.ts:53` — `req as unknown as { language?: string }` double cast loses Fastify type integrity

**File:** `apps/api/src/routes/locale.ts:53`

**Issue:** The author deliberately routes around Fastify's typed request to read `req.language` (set by i18next-http-middleware), commented as a forward-compat seam. A cleaner approach is a TS module augmentation in `apps/api/src/types/fastify-i18n.d.ts` declaring `declare module 'fastify' { interface FastifyRequest { language?: string } }`, then `req.language` becomes type-safe everywhere. Minor.

---

### LO-03: `vitest.config.ts:107` exclude `"tools/test-probe/**"` — but project entry is `tools/test-probe/vitest.config.ts` at line 53 (capitalization OK, just brittle)

**File:** `vitest.config.ts:53,107`

**Issue:** The inline `tools` project explicitly excludes `test-probe/**` and `load-test/**` so they aren't double-covered. If a new tools sub-dir ships its own vitest.config.ts but its exclude entry is forgotten, tests will run twice (slow + noisy). Defense: derive the exclude list dynamically from the explicit project entries above (line 44-56), or add a comment that says "keep these two in sync".

---

### LO-04: `apps/api/tests/unit/routes/__tests__/locale.test.ts` does not exercise the *rate-limit* config attached to the route

**File:** `apps/api/tests/unit/routes/__tests__/locale.test.ts:38-89`

**Issue:** Five tests cover happy paths + the info-leak gate, but none assert that the `config.rateLimit: { max: 60, timeWindow: '1 minute' }` (locale.ts:72) is actually honored — i.e. the 61st request in a window returns 429. For a *public* endpoint, that's the security-relevant test. Without it, a typo in `max` is invisible.

---

## INFO

### IN-01: `tools/spdx-header.ts:208-224` binary-safe byte-splice — only first match wins

**File:** `tools/spdx-header.ts:212-222`

**Note:** The `for (const stale of STALE_HEADERS)` loop returns after the first match; with only one entry today (`Apache-2.0`) that's fine, but a future second stale identifier could shadow correct rewrites. Add a unit test asserting STALE_HEADERS length > 1 picks the right one.

---

### IN-02: `tools/history-scrub.test.sh` is bash-mock based — coverage is reachability, not effects

**Note:** The bats-style harness (7 assertions) verifies dry-run output text and exit codes, not what `gh api -X PUT ...` would actually do against GitHub. That's correct scope for a unit test; flag for future *integration* test against a real `gh-api-mock` server before the next history rewrite.

---

### IN-03: `compose/traefik/dynamic.dev.yml:38` — both `web` + `websecure` entrypoints on the same router; TLS will fail without mkcert wired

**Note:** The router declares `entryPoints: [web, websecure]` and `tls: {}`. In dev without mkcert provisioned, plain HTTP to `web.localhost:80` works; HTTPS to `web.localhost:443` will serve Traefik's default self-signed cert and Chrome will refuse without a NET::ERR_CERT_AUTHORITY_INVALID bypass. Phase 17 plans mkcert provisioning. Flag-for-Phase-17 only.

---

## TDD Compliance Audit (5 RED→GREEN pairs sampled)

| Pair | RED commit | GREEN commit | Verdict |
|---|---|---|---|
| 15-01 codemod | `2499435 test(15-01): red migrate-tests codemod suite` | `a59a911 feat(15-01): migrate-tests ts-morph codemod` | ✓ |
| 15-01 lint guard | `c67193f test(15-01): red no-colocated-tests lint guard` | `28719b1 feat(15-01): no-colocated-tests lint guard` | ✓ |
| 15-02 locale route | `4f469b3 test(15-02): red traefik host-split gherkin + locale route unit` | `02180f7 feat(15-02): green fastify get /api/locale` | ✓ |
| 15-03 SPDX flip | `9eb014d test(15-03): red — assert spdx HEADER is FSL-1.1-ALv2` | `4f7ee9f feat(15-03): green — flip spdx codemod to FSL-1.1-ALv2` | ✓ |
| 15-04 scrub | `246a572 test(15-04): red history-scrub harness` | `994a228 feat(15-04): history-scrub.sh runbook driver` | ✓ |

**All 5 pairs: RED precedes GREEN by exactly one commit. PASS.**

---

## Coverage Audit (5 surfaces, claims taken from 15-02/15-03-SUMMARY; not re-run)

| Surface | Stmts | Branches | Funcs | Lines | Floor met? |
|---|---|---|---|---|---|
| `tools/migrate-tests.ts` | 98.61 | 94.11 | 100 | 100 | ✓ |
| `tools/lint-colocated-tests.ts` | 100 | 100 | 100 | 100 | ✓ |
| `tools/spdx-header.ts` | 96.85 | 92.85 | 100 | 100 | ✓ |
| `apps/api/src/routes/locale.ts` | 5/5 GREEN (no % published) | — | — | — | ✓ (claim) — but rate-limit untested (LO-04) |
| `tools/history-scrub.sh` | reachability-waiver (B-1) | — | — | — | ✓ (waiver), but Stage 7 + 9 paths have logic defects (HI-03, ME-05) untested |

---

## Constitutional Audit

| Rule | Status | Notes |
|---|---|---|
| English-only source artifacts | ✓ | Verifier ran `pnpm lint:english` GREEN (969 files); spot-grep of changed files: 0 Cyrillic hits |
| Atomic commits, conventional subjects | ✓ | All 45 commits match `<type>(15-NN):` pattern, lowercase, ≤100 chars |
| No mocks of internal logic | ✓ | bash test harness mocks only `git`/`gh`/`git-filter-repo` (process boundaries) |
| TDD RED→GREEN | ✓ | 5/5 sampled pairs pass (see above) |
| Per-phase coverage ≥ 90/90/90/90 | ✓ | All measured axes ≥ 92.85 |
| `--no-verify` discipline | ⚠ | 6 commits used `--no-verify` with documented justification but no tracked root-cause issues (ME-02) |

---

## Followup-Issue Stubs

### Issue: "Lefthook biome hook patch-reapply fails on large multi-file commits"
**Body (suggested):**
> Phase 15-02/15-03 sweep commits (`d442deb`, `41f6628`, `57145b1`, `2e0eba0`, `7aeea9b`, `dcebdcd`) bypassed the pre-commit hook via `--no-verify` because lefthook's `biome --write` + `stage_fixed: true` `git apply` step fails when staged and unstaged hunks overlap in commits spanning 100+ files. The defect is upstream (lefthook), not in our config.
> Repro: stage a 150-file biome-noisy refactor, let pre-commit run, observe `git apply` reject hunks.
> Action: open upstream lefthook issue; pin reproducer in `.planning/deferred-items.md`; remove `formatWithErrors: true` from `biome.json` once fixed.

### Issue: "Pre-existing biome errors in packages/contract-tests/tests/unit/transcriptions.test.ts (await in non-async arrow)"
**Body (suggested):**
> 21 biome correctness errors pre-exist in moved test fixtures (post-Phase-15 path: `packages/contract-tests/tests/unit/transcriptions.test.ts` and siblings). Masked by `biome.json` `overrides[0]` rule-relaxations (scoped to `**/*.test.ts*`). Untangle in a focused TDD pass: convert affected arrow expressions to `async () => { await ... }` or hoist into named test functions; restore strict rules once clean.

### Issue: "history-scrub.sh state files leak across runs"
**Body (suggested):** see HI-03 above; concrete fix proposed.

### Issue: "Document GET /api/locale in docs/wire-contract.md"
**Body (suggested):** see HI-02; add full spec stanza.

### Issue: "Backfill 2 missing Dockerfile LABELs (tests/e2e/mock-realtime, tests/fixtures/idp)"
**Body (suggested):** see ME-01; one-line fix.

### Issue: "Sweep remaining inline `SPDX-License-Identifier: Apache-2.0` lines in .yml files"
**Body (suggested):** see HI-01; 3 files; consider extending `tools/spdx-header.ts` to cover YAML.

---

## Final Notes

The phase is in excellent shape for the operator force-push checkpoint. Three HIGH items (HI-01 stale headers, HI-02 wire-contract drift, HI-03 history-scrub state hygiene) should land in a single follow-up commit `chore(15): post-review fixes` before any operator presses the `--force` button on Stage 6. The remaining MEDIUM/LOW items are tracker-fodder.

_Reviewed: 2026-05-15_
_Reviewer: gsd-code-reviewer (Claude Opus 4.7 1M-context, FORCE stance)_
_Depth: deep_
