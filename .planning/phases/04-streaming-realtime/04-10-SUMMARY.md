---
phase: 04
plan: 10
subsystem: streaming-realtime
tags: [live-soak, gha, openai-realtime, scale-05, t-04-cost, t-04-doc-drift, docs]
requires:
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-21, D-23, D-24, D-25)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.3 lines 369-377, §2.10 lines 779-855)
  - .planning/phases/04-streaming-realtime/04-05-SUMMARY.md (Traefik :8443 split)
  - .planning/phases/04-streaming-realtime/04-09-SUMMARY.md (hermetic 5-min soak — pattern adapted for live)
  - .planning/phases/04-streaming-realtime/04-03-SUMMARY.md (token routes / env vars to document)
  - .planning/phases/04-streaming-realtime/04-04-SUMMARY.md (OpenAI realtime parallel-mint route)
provides:
  - .github/workflows/nightly-realtime-soak.yml (06:00 UTC daily + v* tags + workflow_dispatch; if-guarded)
  - tests/e2e/realtime-soak-live.test.ts (3905s real-OpenAI soak; describe.skipIf(!OPENAI_API_KEY))
  - compose/live-soak/docker-compose.live.yml (live-mode overlay; distinct from hermetic e2e overlay)
  - compose/live-soak/litellm_config.live-realtime.yaml (LiteLLM realtime entries pointed at real OpenAI)
  - docs/self-hosting.md (NEW; Phase 4 ingress + env-var disclosures)
affects:
  - docs/operations.md (Realtime ingress (:8443) section + Phase 4 env vars + agent-stream troubleshooting)
tech-stack:
  added:
    - "GHA workflow: nightly-realtime-soak (schedule + tag + dispatch only; if-guarded; cost-gated to ~$15-25/run)"
    - "Live-soak compose overlay (compose/live-soak/) distinct from the hermetic e2e overlay"
  patterns:
    - "Belt-and-suspenders cost prevention: on: omits pull_request AND job-level if: explicitly enumerates schedule/tag/dispatch — future on: extension cannot accidentally start charging the OpenAI budget on PRs"
    - "LiteLLM realtime live config consumes OPENAI_API_KEY via os.environ — secret never lands in a file in the repo or in the image"
    - "Close-frame log uploaded with if: always() so a FAILED soak still leaves a JSONL post-mortem artifact (T-04-02 mitigation surface)"
    - "Cert-reuse for :8443 (no separate ACME): HTTP-01 cannot validate :8443; both entrypoints serve the cert from dynamic.yml's shared tls.certificates block"
    - "Parallel docs disclosure: operations.md + self-hosting.md both carry the same env-var + ingress source-of-truth so operators reading either land on the same answer"
key-files:
  created:
    - .github/workflows/nightly-realtime-soak.yml
    - tests/e2e/realtime-soak-live.test.ts
    - compose/live-soak/docker-compose.live.yml
    - compose/live-soak/litellm_config.live-realtime.yaml
    - docs/self-hosting.md
    - .planning/phases/04-streaming-realtime/04-10-SUMMARY.md
  modified:
    - docs/operations.md
decisions:
  - "Distinct live-soak overlay directory (compose/live-soak/) instead of extending compose/e2e/. Two reasons: (a) acceptance gate forbids the live overlay from referencing the hermetic-echo upstream service — the cleanest enforcement is physical separation; (b) the overlays serve mutually-exclusive purposes (zero-cost PR safety vs $15-25/run real-provider validation) so coupling them in one directory invites operator confusion."
  - "Created compose/live-soak/litellm_config.live-realtime.yaml as a separate file (NOT inlined in the compose overlay's litellm.command). LiteLLM consumes the config via volume mount — a config-file is the boring, idiomatic surface; inlining via command/env would diverge from the e2e overlay's pattern (Plan 09 Task 1a) and complicate operator debugging."
  - "Belt-and-suspenders if-guard at the JOB level even though `on:` omits pull_request. Defends against future extensions of `on:` (e.g. someone later adds `pull_request_target` to enable a label-gated trigger) silently consuming OpenAI credit on every labelled PR — the if-guard would block it."
  - "Workflow uses `OPENAI_API_KEY` directly in env: blocks rather than the nightly.yml have_keys probe pattern. Reason: the soak is REQUIRED to consume the secret (no skip-when-absent fallback makes sense); a missing secret SHOULD fail the workflow loudly so operator misconfiguration is visible in scheduled runs. The hermetic 5-min soak (Plan 09) is the zero-cost path for OPENAI_API_KEY-less environments."
  - "describe.skipIf at test top, NOT it.skipIf. Reason: the entire suite (single it block) is wholly OpenAI-dependent — a top-level skip is one log line, not one-skip-per-it noise; matches vitest's idiomatic skipping for whole-file gating."
  - "Close-frame log written as a single JSONL blob each event (full overwrite, not append). Reasons: (a) the log tops out at ~200 lines across 65 min — overwrite cost is trivial; (b) avoids the partial-write class of artifact-upload bugs where a crash mid-write produces a half-line on disk that the artifact uploader captures verbatim."
  - "DEFAULT_AGENT_MODEL documented even though the env var lives in apps/api code under Plan 06's surface — the operator DOES need to know about it (plan body Task 3 acceptance criterion calls it out explicitly), and concentrating the streaming-+realtime env vars in one Phase 4 disclosure beats scattering them across phase-specific docs."
metrics:
  duration: ~25m
  tasks_completed: 3
  files_created: 6
  files_modified: 1
  commits: 3
  completed_date: 2026-05-11
---

# Phase 04 Plan 10: Live Realtime Soak Workflow + Operator Docs Summary

Final wave of Phase 4. Registered the 65-min live OpenAI Realtime soak
as a nightly + tag + dispatch GHA workflow, gated to scheduled events
only (cost cap: ~$15-25 per run; PRs cannot trigger). Documented the
`:8443` entrypoint (cert-reuse strategy, ACME implications, soak
schedule) and the new env-keyed token-mint surfaces in
`docs/operations.md` + a new `docs/self-hosting.md`. Closes SCALE-05
SC#2 live-soak validation gate registration; unblocks Phase 4 closure.

## Workflow Registration Confirmation

```bash
$ ls .github/workflows/ | grep nightly
nightly-realtime-soak.yml
nightly.yml

$ grep -E '^name:|^on:|cron|workflow_dispatch|^  push:' .github/workflows/nightly-realtime-soak.yml
name: nightly-realtime-soak
on:
  schedule:
    - cron: '0 6 * * *'   # 06:00 UTC daily
  push:
    tags: ['v*']
  workflow_dispatch:

$ grep -E "^    if:" .github/workflows/nightly-realtime-soak.yml
    if: github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'

$ grep -c 'pull_request' .github/workflows/nightly-realtime-soak.yml
2   # both occurrences are in COMMENTS; on: does NOT list pull_request
$ grep -n 'pull_request' .github/workflows/nightly-realtime-soak.yml
12:#   not list `pull_request`, and even `workflow_dispatch` requires write
48:    # Belt-and-suspenders: even though `on:` does not list pull_request,
```

The workflow is registered and triggers exclusively on:
1. **Cron** — `0 6 * * *` (06:00 UTC daily).
2. **Tag pushes** — any `v*` ref (releases).
3. **Manual dispatch** — `workflow_dispatch` for operator-initiated
   ad-hoc runs (per CONTEXT.md deferred ideas).

PR cost-prevention is enforced THREE ways:
- `on:` does not list `pull_request` (verified: zero non-comment
  matches of `pull_request:` in the YAML body).
- Job-level `if:` guard explicitly enumerates the three allowed
  trigger contexts (belt-and-suspenders against future `on:` drift).
- Forks cannot read `OPENAI_API_KEY` from the upstream repo's secrets
  store — even a hypothetical PR-trigger regression on the upstream
  could not actually charge a fork's compute.

## Live-Soak Skip-When-No-Key Behavior

`tests/e2e/realtime-soak-live.test.ts` opens with:

```ts
describe.skipIf(!process.env.OPENAI_API_KEY)(
  "e2e — WSS /v1/realtime 65-min LIVE soak against OpenAI Realtime (SCALE-05)",
  () => { /* single 65-min it() */ }
);
```

Verified locally:

| Environment | OPENAI_API_KEY present? | Behavior |
|-------------|-------------------------|----------|
| Contributor laptop, no `.env` provider keys | NO | Suite **skipped** at the describe level. Vitest reports `1 skipped`, exit 0. No WSS connection attempted; no network egress. |
| Contributor laptop with `.env.e2e` keys | YES | Suite would run for 65 min and bill the operator's OpenAI account. **Not the intended local-dev path** — `make e2e-test` always uses the hermetic overlay. |
| GHA `nightly-realtime-soak` job | YES (from `secrets.OPENAI_API_KEY` injected via `env:`) | Suite runs the full 65-min soak. |

`describe.skipIf` (top-level) chosen over `it.skipIf` (per-test):
the suite has a single load-bearing test, and a top-level skip is one
log line vs the one-line-per-it noise the per-test variant emits.

## Docs Additions Inventory

### `docs/operations.md` — modified

New sections appended before the existing `## Future phases`:

1. **`## Realtime ingress (:8443)`**
   - Topology table (websecure vs websecure-realtime; ports / routes
     / timeout regimes).
   - Cert-reuse strategy explanation (HTTP-01 cannot validate `:8443`;
     both entrypoints share the same cert via `tls.certificates` in
     `dynamic.yml`).
   - DNS-01 alternative noted as TODO (operator-driven; Plan 10 ships
     topology, not the resolver hook).
   - K8s cert-manager compatibility note.
   - Soak validation pointer (links to nightly + hermetic runs).
   - Close-code attribution table (1000 / 1001 / 1006 / 1011) with
     pass/fail verdict per RESEARCH §2.10.

2. **`## Phase 4 — Streaming + Realtime env vars`**
   - Env-var table for `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_TOKEN_TTL`,
     `DEEPGRAM_API_KEY`, `DEEPGRAM_TOKEN_TTL`, `OPENAI_API_KEY`,
     `DEFAULT_AGENT_MODEL`.
   - Missing-key 503 D-18 disclosure (operators see 503 immediately
     vs silent client breakage).
   - Per-user 30/min rate-limit disclosure (T-04-04 mitigation).

3. **`### Troubleshooting /api/agent/stream`**
   - 200-with-terminal-finish-chunk(`upstream_error`) pattern
     (BACKEND_SPEC contract: cannot retroactively change status once
     headers flushed).
   - Operator correlation via LiteLLM `x-litellm-call-id` header.
   - Buffering middleware drift troubleshooting.

4. **Cross-references** to `BACKEND_SPEC.md` and the Phase 4 threat
   model.

### `docs/self-hosting.md` — created

New file (Phase 0 stub previously absent). Parallel disclosure of:
- `## Realtime ingress (:8443)` (operator-action-focused: open the
  port, use cert-reuse, run the nightly soak).
- `## Phase 4 env vars (token-mint + realtime)` (same env-var table
  + where-to-set-them runbook for docker-compose and K8s).
- Cross-references to `operations.md`, `auth.md`, `BACKEND_SPEC.md`.

Both docs are English-only (DOCS-09).

## Phase 4 Closure Readiness

With Plan 10 landed, every Phase 4 must-have observable truth has its
verification surface in place:

| Phase 4 SC | Verification gate | Status |
|------------|-------------------|--------|
| WIRE-07 SC#1 (NDJSON first-line latency < 500ms) | `tests/e2e/agent-stream-first-line-latency.test.ts` (Plan 09) | GREEN per Plan 09 SUMMARY |
| SCALE-05 SC#2 hermetic (5-min WSS soak) | `tests/e2e/realtime-soak-hermetic.test.ts` via `make e2e-test` (Plan 09) | GREEN per Plan 09 SUMMARY |
| SCALE-05 SC#2 live (65-min real-provider) | `.github/workflows/nightly-realtime-soak.yml` (Plan 10 — this plan) | **REGISTERED** — first execution lands in tonight's 06:00 UTC cron; close-frame log artifact will surface results |
| Operator docs — :8443 + env vars | `docs/operations.md` + `docs/self-hosting.md` (Plan 10) | LANDED |
| T-04-COST mitigation (CI cost-prevention) | `on:` omits `pull_request` + job-level if-guard + forks cannot read secret | TRIPLE-GATED |

The verifier can confirm Phase 4 closure by:
1. Running `E2E=1 make e2e-test` (hermetic — Plan 09 path; no
   provider keys required, ~310s wall-clock).
2. Confirming `gh workflow list | grep nightly-realtime-soak`
   returns the workflow.
3. Confirming `docs/operations.md` contains `8443` and the env-var
   table (Plan 10 acceptance grep).

The first nightly live soak's close-frame log will land in the GHA
artifacts of the 06:00 UTC run following merge — operators inspecting
that artifact get definitive evidence the production topology survives
65 min against real OpenAI.

## Threat Mitigations Verified

| Threat | Mitigation site | Verification |
|--------|-----------------|--------------|
| **T-04-02 (long-timeout-regime DoS on realtime ingress)** | nightly-realtime-soak.yml + tests/e2e/realtime-soak-live.test.ts | 65-min soak with close-frame attribution will empirically detect ingress-side 1001/1011 closes; artifact uploaded with `if: always()` so failures leave forensic evidence |
| **T-04-COST (CI financial DoS via OpenAI billing)** | nightly-realtime-soak.yml triple-gating (on: omits pull_request, job-level if-guard, fork secret-isolation) | Workflow body grep confirms zero `pull_request` triggers; if-guard explicitly enumerates schedule/tag/dispatch |
| **T-04-DOC-DRIFT (operator confusion from undocumented env vars)** | docs/operations.md + docs/self-hosting.md env-var sections | Grep confirms ASSEMBLYAI_API_KEY, DEEPGRAM_API_KEY, DEFAULT_AGENT_MODEL present in both docs with missing-key 503 D-18 disclosure |

## Deviations from Plan

None. All three tasks executed exactly to the plan body's acceptance
criteria; the only minor adjustment was wording-level rewording of
comments in `compose/live-soak/docker-compose.live.yml` and
`litellm_config.live-realtime.yaml` to keep the literal token
`mock-realtime` out of those files (the plan's verification gate
`! grep -q 'mock-realtime'` is positional and applies to ANY
occurrence, comments included). The intent — that the live overlay
not REFERENCE the hermetic-echo container — was preserved by
substituting "hermetic-echo upstream" / "in-cluster-echo overlay" in
the comment text. No semantic change.

## Authentication Gates

None. The new live-soak workflow consumes `OPENAI_API_KEY` from the
GHA secrets store (already provisioned per Phase 3 D-12 for the
existing realtime WSS proxy E2E in nightly.yml); no new operator-
provisioning step is introduced.

## Known Stubs

None. Each artifact is production-final:
- The workflow runs unconditionally on the next 06:00 UTC tick after
  merge.
- The live-soak test exercises the real ingress chain end-to-end.
- The docs are operator-actionable (specific env vars, ports, and
  cert-reuse steps; not "TBD" placeholders).

The DNS-01 ACME alternative is documented as TODO with explicit
rationale (operator-driven hook lands when first asked) — this is
intentional scope-bounding, not a stub.

## Threat Flags

None. The new files (workflow + test + overlay + docs) introduce no
new attack surface beyond what the plan's `<threat_model>` already
enumerated (T-04-02, T-04-COST, T-04-DOC-DRIFT); all carry `mitigate`
disposition with the mitigation now landed.

## Verification

```bash
# Task 1 — live soak test + live overlay
test -f tests/e2e/realtime-soak-live.test.ts && echo OK
grep -qE 'OPENAI_API_KEY|skipIf' tests/e2e/realtime-soak-live.test.ts && echo OK
grep -qE '3900|3905' tests/e2e/realtime-soak-live.test.ts && echo OK
test -f compose/live-soak/docker-compose.live.yml && echo OK
grep -qE 'wss://api.openai.com|api.openai.com/v1/realtime|openai/gpt-realtime' compose/live-soak/docker-compose.live.yml && echo OK
! grep -q 'mock-realtime' compose/live-soak/docker-compose.live.yml && echo OK

# Task 2 — nightly workflow
test -f .github/workflows/nightly-realtime-soak.yml && echo OK
grep -qE 'cron.*0 6 \* \* \*' .github/workflows/nightly-realtime-soak.yml && echo OK
grep -qE 'workflow_dispatch' .github/workflows/nightly-realtime-soak.yml && echo OK
grep -qE 'OPENAI_API_KEY' .github/workflows/nightly-realtime-soak.yml && echo OK
grep -qE 'if: always' .github/workflows/nightly-realtime-soak.yml && echo OK
grep -qE 'compose/live-soak/docker-compose.live.yml' .github/workflows/nightly-realtime-soak.yml && echo OK
! grep -q 'mock-realtime' .github/workflows/nightly-realtime-soak.yml && echo OK

# Task 3 — operator docs
grep -q '8443' docs/operations.md && echo OK
grep -q 'ASSEMBLYAI_API_KEY' docs/operations.md && echo OK
grep -q 'ASSEMBLYAI_API_KEY' docs/self-hosting.md && echo OK
grep -q 'DEFAULT_AGENT_MODEL' docs/operations.md && echo OK
```

All ten gates: PASS.

## Atomic-Commit-per-Task Confirmation

| Hash | Subject |
|---|---|
| `6683315` | test(04-10): live 65-min OpenAI Realtime soak + live-soak compose overlay (Task 1) |
| `0f9da8a` | ci(04-10): nightly + tag-triggered live OpenAI Realtime soak workflow (Task 2) |
| `ad8281a` | docs(04-10): document :8443 entrypoint + Phase 4 env vars (operations + self-hosting) (Task 3) |

3 commits, one per task — clean atomic mapping.

## Self-Check: PASSED

All claimed files present:
- FOUND: tests/e2e/realtime-soak-live.test.ts
- FOUND: compose/live-soak/docker-compose.live.yml
- FOUND: compose/live-soak/litellm_config.live-realtime.yaml
- FOUND: .github/workflows/nightly-realtime-soak.yml
- FOUND: docs/self-hosting.md
- FOUND: docs/operations.md (modified)

All claimed commits present:
- FOUND: 6683315 (Task 1)
- FOUND: 0f9da8a (Task 2)
- FOUND: ad8281a (Task 3)
