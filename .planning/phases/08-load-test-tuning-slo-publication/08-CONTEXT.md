# Phase 8: Load Test, Tuning & SLO Publication - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** Direct user lock (no discuss-phase needed)

<domain>
## Phase Boundary

Phase 8 produces an on-demand k6 load test, two docker-compose profiles for it (`load-test-mock` and `load-test-realistic`), an actual live baseline run on the developer's Mac (48GB RAM), and operator-facing documentation in `docs/operations.md` covering measured p95 latencies, a sizing matrix per topology, and PgBouncer/file-descriptor tuning.

This phase is **NOT** about nightly CI or ephemeral cloud envs — those were stripped from the original ROADMAP success criteria when the user clarified the audience: this is a one-shot establishment of baselines + SLO budgets, not a continuous regression gate.

</domain>

<decisions>
## Implementation Decisions (locked by user 2026-05-12)

### Execution model

- **D-EXEC-1 — On-demand, manual, local.** `make load-test` (or equivalent npm/pnpm script) runs the k6 scenario against the local docker-compose stack on the developer's Mac. NO nightly cron. NO self-hosted GHA runner. NO ephemeral cloud env. Operators re-run after architectural changes; regression discipline is documented, not automated.
- **D-EXEC-2 — Live run mandatory in this phase.** The first `make load-test` run actually executes on the Mac and produces real baseline numbers. Raw k6 output + summary table embedded in `08-SUMMARY.md`. No estimates, no extrapolated numbers in operations.md.

### Load profile

- **D-LOAD-1 — 1000 concurrent active users.** Matches CLAUDE.md scale constraint. Lower scale (e.g., 100, 500) is acceptable for development smoke; 1000 is required for the baseline run that establishes published SLO budgets.
- **D-LOAD-2 — 30-minute scenario.** 5m ramp-up → 20m sustained @ 1000 VU → 5m ramp-down. Standard k6 pattern; long enough to flush ramp-up outliers from p95.
- **D-LOAD-3 — v1 assumed mix ratios (locked).** 50% transcribe, 25% reason, 15% agent/stream, 10% WSS realtime. Document in operations.md as `v1 assumed mix; revisit after operator feedback`.

### Compose profiles

- **D-PROF-1 — Two profiles, both baselines published.**
  - `load-test-mock`: LiteLLM upstream replaced with a mock that returns static responses with simulated latency (sleep(1500ms) for `/v1/audio/transcriptions`, sleep(300ms) for `/v1/chat/completions`, ~200ms first-token for `/v1/chat/completions?stream=true`). Measures gateway + auth + DB + Valkey + Traefik p95 in isolation. Labeled in docs as "gateway p95 (LLM excluded)".
  - `load-test-realistic`: Real Speaches container (Whisper-large-v3 + pyannote) inside compose. Apple Silicon → CPU inference, no GPU passthrough. Measures end-to-end p95. Labeled in docs as "end-to-end p95 (Mac CPU inference)".
- **D-PROF-2 — Both profiles are net-new additions to docker-compose.yml.** Should not affect the existing `default` profile (Phase 07.1 still works). Profile activation via `docker compose --profile load-test-mock up` or `--profile load-test-realistic up`.

### SLO budget model

- **D-SLO-1 — Baseline-driven, +20% headroom.** First live run establishes p95 per endpoint per profile. Published SLO = p95_baseline × 1.20. Documented per endpoint in operations.md.
- **D-SLO-2 — Two budget tables.** One for gateway p95 (mock profile), one for end-to-end p95 (realistic profile). Operators with corporate LiteLLM use the gateway numbers; operators on the bundled stack use the realistic numbers as upper bounds.
- **D-SLO-3 — No CI enforcement in Phase 8.** Phase 8 publishes numbers; future phases or operator-side automation can wire regression checks against them.

### Tuning targets

- **D-TUNE-1 — PgBouncer 100×4 transaction-mode.** Server-pool 100 per instance × 4 instances. Verified by metrics during the load test (pool exhaustion ratio < 5% under sustained 1000 VU).
- **D-TUNE-2 — File-descriptor limit 65535.** On api + traefik containers. Startup probe in api/traefik checks `prlimit --nofile=65535:65535` (or equivalent) and refuses to start if soft limit < 65535. Default 1024 must NOT silently regress.
- **D-TUNE-3 — No GPU tuning in Phase 8.** Apple Silicon Docker has no GPU passthrough; Speaches inference is CPU. Cloud GPU tuning is Phase 9 (Helm) territory.

### Documentation

- **D-DOCS-1 — `docs/operations.md`** receives all operator-facing artifacts:
  - "How to run the load test" section with the `make load-test` command + profile selection
  - p95 SLO budget tables (one per profile)
  - Sizing matrix: rows = topology (compose single-host / Helm small / Helm large), columns = CPU / RAM / connections / pgbouncer pool / observed p95
  - PgBouncer tuning rationale + file-descriptor probe contract
  - Limitations explicitly stated: Apple Silicon Docker = CPU inference, no GPU; load-test-realistic p95 is bounded by the developer machine, not production hardware

### Test discipline

- **D-TDD-1 — Strict TDD per CLAUDE.md.** Tests for the load-test harness (k6 script structure validators, fixture seed correctness, profile selection correctness) RED before the harness GREEN.
- **D-TDD-2 — ≥90/90/90/90 coverage on diff** for any TypeScript/JavaScript code added in `tools/load-test/` or similar.

</decisions>

<canonical_refs>
## Canonical References

### Phase 8 inputs
- `.planning/ROADMAP.md` Phase 8 entry — rewritten in commit 8b2fd5b with 7 new success criteria
- `.planning/REQUIREMENTS.md` SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01 entries
- CLAUDE.md — 1000 concurrent constraint, TDD, ≥90/90/90/90, English-only

### Carry-forward from prior phases
- `apps/api/src/routes/transcribe.ts`, `reason.ts`, `agent/stream.ts`, `realtime/*` — endpoints under load
- `apps/api/src/plugins/rate-limit.ts` — needs OPENWHISPR_DISABLE_RATE_LIMIT=1 for load profile (or per-test bypass header)
- `apps/api/src/auth.ts` — Better Auth rate limit (same env switch from Phase 07.1)
- `docker-compose.yml` — existing services (api, postgres, valkey, pgbouncer, traefik, litellm, mailpit, web)
- `compose/traefik/` — current Traefik config (file + docker providers)
- `apps/web/` — Phase 07.1 frontend (NOT under load in Phase 8; users hit api directly via k6)

### External tools
- k6 — Grafana-maintained load testing tool. Use `grafana/k6` Docker image or local install. Scripts in TS via `@grafana/k6-types`.
- xk6 extensions (optional): xk6-websockets for WSS realtime, xk6-output-prometheus-remote-write for live metrics streaming to Grafana

### Operator audience
- The k6 results + sizing matrix are read by operators planning a self-hosted deployment. Numbers must be reproducible, methodology documented, and limitations explicit.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **docker-compose.yml** already has api + postgres + pgbouncer + valkey + traefik + litellm + worker + otel-collector + mimir + tempo + loki + minio + mailpit (Phase 07.1 added mailpit). Adding `speaches` service under profile `load-test-realistic` is incremental.
- **OPENWHISPR_DISABLE_RATE_LIMIT=1** env switch from Phase 07.1 is reusable — k6 needs it on for the load test so Better Auth + Fastify rate-limit don't throttle the synthetic traffic.
- **`tests/e2e/fixtures/seed.ts`** (web) can be referenced for how to seed users + data via real api calls — though k6 will likely use direct API calls rather than the web seed helper.

### Established Patterns
- **TDD RED→GREEN atomic commits per slice** (Phase 07.1 precedent)
- **autonomous: true on all plans** (Phase 07.1 plan-checker fix)
- **English-only source** (CLAUDE.md)

### Integration Points
- **k6 scenarios target Traefik HTTPS endpoint** (`https://api.localhost`) — same surface as Playwright e2e in Phase 07.1. Cert is self-signed; k6 needs `--insecure-skip-tls-verify` or env var equivalent.
- **Speaches container needs ~3-4GB RAM for Whisper-large-v3 + ~500MB for pyannote**. On Mac 48GB, headroom is fine.
- **Authentication**: k6 needs valid Better Auth sessions per VU. Pattern: provision N test users via /api/auth/sign-up at the start of the test, save bearer tokens, distribute across VUs. Better Auth `signUpEmail` already handles this; rate limit disabled via env.

</code_context>

<specifics>
## Specific Ideas

- **Test users**: provision 100 unique users (alice0..alice99) at the start of the run; each VU rotates through them. Avoids hammering a single user's per-route rate limit.
- **Asset payloads**: small WAV file (~5 seconds, 16kHz mono) for transcribe; static prompt strings for reason; canned conversation history for agent/stream and WSS. Bundled in `tools/load-test/fixtures/`.
- **Live metrics dashboard**: k6 → Prometheus remote-write → Mimir → Grafana. Show p95 over time, RPS, error rate per endpoint, all live during the 30-min run. Reuses Phase 6 observability stack.
- **Exit criteria for the live run**: at the end of the 20-min sustained block, all four endpoints must report p95 within reasonable bounds (no >10x outliers vs steady-state), error rate < 1%, no api/pgbouncer/postgres restarts. If these fail, debug and re-run before publishing SLO budgets.

</specifics>

<deferred>
## Deferred Ideas

### Out of Phase 8
- Nightly CI cadence — postponed; operators run manually after architectural changes
- Ephemeral cloud env — Phase 9 (Helm) territory
- GPU tuning — Phase 9 (Helm + cloud GPU nodes)
- Regression-budget CI gate — future automation
- Per-tenant load profiles (multi-tenant fairness under load) — not in v1 scope
- xk6-browser scenarios (load testing the web frontend) — not needed for Phase 8; web is documentation-grade

</deferred>

---

*Phase: 08-load-test-tuning-slo-publication*
*Context locked: 2026-05-12 (direct user decisions, no discuss-phase)*
</content>
</invoke>