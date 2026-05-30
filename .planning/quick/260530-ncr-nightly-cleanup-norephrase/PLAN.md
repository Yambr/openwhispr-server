---
quick_id: 260530-ncr
slug: nightly-cleanup-norephrase
date: 2026-05-30
status: complete
---

# Quick Task: nightly cleanup-no-rephrase e2e (variant B)

## Goal

A nightly LIVE e2e that proves the cleanup path (`POST /api/reason`, text-only
shape) still cleans transcripts VERBATIM against the REAL provider — catching
model/provider behavioral drift that hermetic tests cannot.

Nick chose "B now, A later": B = real OpenRouter via local live-overlay
(self-contained, only OPENROUTER_API_KEY); A = in-cluster stage litellm
(needs scoped kubeconfig) deferred.

## Approach

Mirror the proven `nightly-realtime-soak.yml` pattern exactly: a live compose
overlay repointing one alias at a real provider, a cron/tag/dispatch-gated
non-required workflow, and a `describe.skipIf`-gated e2e. The no-rephrase
assertion uses structural invariants (fillers/dups removed, content words +
order preserved, punctuation/caps added, length tightened not expanded) since
real-model output is not byte-deterministic.

## Surface

- compose/live-soak/litellm_config.live-cleanup.yaml
- compose/live-soak/docker-compose.live-cleanup.yml
- .github/workflows/nightly-cleanup-norephrase.yml
- tests/e2e/cleanup-norephrase-live.test.ts
- .env.full.example (operator temp:0 belt-and-suspenders nuance)

## Verification

- actionlint clean; compose config valid; YAML valid; no hermetic refs.
- e2e skips cleanly without OPENROUTER_API_KEY (PR/fork/local safe).
- pnpm test:all green for the pre-push evidence gate (never --no-verify).
- Empirical proof deferred to the first nightly run (operator adds the
  OPENROUTER_API_KEY repo secret) — surfaced to Nick, NOT claimed as already
  proven live.
