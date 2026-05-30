---
quick_id: 260530-ncr
slug: nightly-cleanup-norephrase
date: 2026-05-30
status: complete
---

# Summary: nightly cleanup-no-rephrase e2e (variant B — real OpenRouter)

Tracker #17. Nick decision: **"B now, A later."** This ships variant **B**;
variant A (in-cluster stage litellm) is deferred until the operator provides
a scoped kubeconfig.

## What B catches (the MODEL/PROVIDER drift axis)

A nightly live e2e that drives the golden dirty transcript through the FULL
production chain — `POST /api/reason` (cleanup shape) → Traefik → api →
LiteLLM → **real OpenRouter instruct checkpoint** — and asserts the cleanup
INVARIANT: fillers/dups removed, punctuation/caps added, meaning + word
ORDER preserved, NOT paraphrased/reordered. Catches "the instruct checkpoint
started paraphrasing" / "OpenRouter swapped behavior under the same id".

Orthogonal to variant A (regression of the operator's DEPLOYED litellm
config after an ArgoCD sync), which needs cluster access.

## Files

- `compose/live-soak/litellm_config.live-cleanup.yaml` — `qwen3.6-cleanup`
  → `openrouter/qwen/qwen3-30b-a3b-instruct-2507` + `temperature:0`
  (mirrors the operator's confirmed stage config), `os.environ/OPENROUTER_API_KEY`.
- `compose/live-soak/docker-compose.live-cleanup.yml` — overlay binding that
  config + requiring `OPENROUTER_API_KEY`. No hermetic/mock upstream.
- `.github/workflows/nightly-cleanup-norephrase.yml` — cron 06:20 UTC +
  tag + workflow_dispatch (NO pull_request); job `if:` guard; SHA-pinned
  actions; `OPENROUTER_API_KEY` secret; non-required, flaky-tolerant.
- `tests/e2e/cleanup-norephrase-live.test.ts` — `describe.skipIf` gated on
  `OPENROUTER_API_KEY` + `E2E=1`; 6-part no-rephrase invariant assertion.
- `.env.full.example` — operator's belt-and-suspenders nuance on temp:0.

## Safety (PR/fork/cost)

- No `E2E=1` → test not even discovered (empty include glob).
- `E2E=1` + no key → discovered, **cleanly skipped** (verified: 1 skipped,
  0 failed) — mirrors the proven `realtime-soak-live.test.ts` pattern.
- nightly (`E2E=1` + secret) → runs against real OpenRouter.
- `on:` omits pull_request + job if-guard → forks/PRs cannot read the secret
  nor trigger the overlay. One short completion (~40 tokens) ≈ a fraction of
  a cent per run.
- NOT in branch-protection (empirical/provider-dependent). The per-PR
  guarantee stays the hermetic contract test (#16) + no-rephrase resolver
  unit tests (#18).

## Verification

- actionlint clean; compose overlay `docker compose config` valid; all YAML
  parses; hermetic-echo grep gate = 0 real refs (comments only).
- e2e skips cleanly without the key; biome clean.
- `pnpm test:all` GREEN for the pre-push evidence gate (the e2e live test is
  not loaded in the standard suite — no E2E=1 — so suite behavior is
  unchanged). Never --no-verify.

## Status: DORMANT by Nick's decision (2026-05-30)

Nick reviewed the value ("а для чего он нам?") and chose **"не нужен сейчас
— dormant."** Rationale: the nightly catches ONLY silent provider-side model
drift (OpenRouter swaps behavior under the same id → cleanup paraphrases
again with no code change on our side) — a real but low-frequency risk. Our
code is already protected on every PR by the hermetic contract test (#16) +
the no-rephrase resolver unit tests (#18), and the operator live-verified the
current model behaves. So the nightly is defense-against-silent-external-
regression only, not load-bearing.

**Decision:** merge the workflow + overlay + test as a **dormant** capability
(it skips cleanly with no `OPENROUTER_API_KEY` secret — verified). NO key is
placed in CI. To activate later: add the `OPENROUTER_API_KEY` repo secret
(scoped preferred, per the R2/#45 pattern) — NO code change needed. The
operator (gr0flvsr, gh admin on the repo) was told NOT to add the key.

This matches the established [[project_prepush_gate_tip_only]] posture of
"correct-but-dormant capability landed, activated by config not code."

## Variant A (deferred)

When Nick wants A: ping operator gr0flvsr for the scoped kubeconfig (he has
it ready — URL http://stage-litellm.stage.svc.cluster.local:4000, secret
stage-litellm-masterkey/masterkey, master-key in pod-env LITELLM_MASTER_KEY,
scoped SA = pods get/list + pods/exec create in ns stage, no cluster-admin).
A new nightly variant hits the in-cluster stage litellm directly.
