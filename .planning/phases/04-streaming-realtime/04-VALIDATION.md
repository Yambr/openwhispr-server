---
phase: 04
slug: streaming-realtime
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-10
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Filled from `04-RESEARCH.md` § 4. Validation Architecture. Planner refines the
> Per-Task Verification Map after PLAN.md files are written.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (apps/api + packages/contract-tests), `ws` library for raw WSS soak client, `undici` for raw-socket NDJSON measurement, Playwright not used. |
| **Config file** | `apps/api/vitest.config.ts`, `packages/contract-tests/vitest.config.ts`, `tests/e2e/vitest.e2e.config.ts` |
| **Quick run command** | `pnpm --filter @openwhispr/api test --run` |
| **Full suite command** | `make test && make contract-test && E2E=1 make e2e-test` |
| **Estimated runtime** | ~120s unit + ~90s contract + ~300s e2e (mock-realtime hermetic, excludes nightly 65-min live soak) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @openwhispr/api test --run --coverage` for the touched package; coverage must remain ≥90/90/90/90 on every new/modified file.
- **After every plan wave:** Run `make test && make contract-test` (unit + integration + contract).
- **Before `/gsd-verify-work`:** Full suite green — `make test && make contract-test && E2E=1 make e2e-test`, including the buffering-injection negative-control test (must fail when buffering is injected; must pass without).
- **Nightly (separate gate):** `.github/workflows/nightly-realtime-soak.yml` runs the live 65-min OpenAI Realtime soak against `gpt-realtime`; failure does NOT block phase closure but pages on red.
- **Max feedback latency:** 120s for unit; 600s for e2e; 4000s (≈65min) for nightly soak only.

---

## Per-Task Verification Map

> Populated by the planner once PLAN.md files are written. Skeleton below — every task in every plan MUST land in this table with either a concrete `Automated Command` or a Wave 0 dependency that creates the test infrastructure. No 3 consecutive tasks without an automated verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-00-01 | 00 (spike) | 0 | — | — | LiteLLM SSE fixture corpus captured | spike-output | `ls apps/api/src/routes/agent/__fixtures__/*.sse` returns ≥7 files | ❌ W0 | ⬜ pending |
| 04-00-02 | 00 (spike) | 0 | — | — | Provider response shapes verified live | spike-output | `cat tests/spikes/04-provider-shapes.md` exists and lists 3 confirmed shapes | ❌ W0 | ⬜ pending |
| 04-01-XX | 01 (SSE parser) | 1 | WIRE-07 | — | Pure parser handles all 7 fixtures + premature close | unit | `pnpm --filter @openwhispr/api test src/lib/sse-parser.test.ts --run --coverage` | ❌ W0 | ⬜ pending |
| 04-01-XX | 01 (tool accumulator) | 1 | WIRE-07 | — | Tool-call deltas accumulated by index, emitted on `finish_reason==="tool_calls"`, malformed JSON safety | unit | `pnpm --filter @openwhispr/api test src/lib/tool-call-accumulator.test.ts --run --coverage` | ❌ W0 | ⬜ pending |
| 04-02-XX | 02 (AssemblyAI) | 1 | WIRE-13 | T-04-01 | 503 envelope when ASSEMBLYAI_API_KEY unset; 200 `{token}` with valid key | unit+contract | `pnpm --filter @openwhispr/api test src/routes/tokens/assemblyai.test.ts --run --coverage && pnpm --filter @openwhispr/contract-tests test src/streaming-token.contract.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-03-XX | 02 (Deepgram) | 1 | WIRE-14 | T-04-01 | 503 envelope when DEEPGRAM_API_KEY unset; 200 `{token}` mapped from `access_token` | unit+contract | `pnpm --filter @openwhispr/api test src/routes/tokens/deepgram.test.ts --run --coverage && pnpm --filter @openwhispr/contract-tests test src/deepgram-streaming-token.contract.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-04-XX | 03 (Traefik entrypoint) | 1 | SCALE-05 | T-04-02 | `websecure-realtime` entrypoint bound to `:8443` with 3600s timeouts; `:443` defaults preserved | integration | `tests/e2e/traefik-config.test.ts` parses `compose/traefik/traefik.yml` and asserts entrypoint config + cert-reuse | ❌ W0 | ⬜ pending |
| 04-05-XX | 04 (agent stream) | 2 | WIRE-07 | T-04-03 | Hand-rolled NDJSON producer; first-line < 200ms in unit, < 500ms through Traefik | unit+integration+e2e | `pnpm --filter @openwhispr/api test src/routes/agent/stream.test.ts --run --coverage && E2E=1 make e2e-test -- agent-stream` | ❌ W0 | ⬜ pending |
| 04-06-XX | 05 (OpenAI Realtime token) | 2 | WIRE-15 | T-04-01 | Parallel-mint for streams=2, clientSecrets.length≥2, fail-fast on partial failure | unit+contract | `pnpm --filter @openwhispr/api test src/routes/tokens/openai-realtime.test.ts --run --coverage && pnpm --filter @openwhispr/contract-tests test src/openai-realtime-token.contract.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-07-XX | 06 (mock-realtime) | 2 | SCALE-05 | — | Hermetic WSS echo server speaks session.created/response.done, ping/pong forwarding | integration | `pnpm --filter @openwhispr/mock-realtime test --run` | ❌ W0 | ⬜ pending |
| 04-08-XX | 07 (buffering-injection) | 3 | WIRE-07 | T-04-03 | Test B with `stream.Transform({highWaterMark:4096})` asserts first-line > 800ms; test fails closed when buffering injected | unit | `pnpm --filter @openwhispr/api test src/lib/__tests__/buffering-injection.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-09-XX | 08 (hermetic 5-min soak) | 3 | SCALE-05 | T-04-02 | 5-min WSS session through Traefik+Fastify+mock-realtime survives with zero ingress-attributable closes; ping RTT p95 < 1s | e2e | `E2E=1 pnpm --filter @openwhispr/e2e test tests/realtime-soak.hermetic.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-10-XX | 09 (nightly live soak) | 4 | SCALE-05 | T-04-02 | 65-min live WSS against gpt-realtime; close-code inspection distinguishes ingress from upstream 1006 | nightly-e2e | `.github/workflows/nightly-realtime-soak.yml` scheduled `cron: '0 6 * * *'` with `if: github.event_name == 'schedule'` and `OPENAI_API_KEY` secret | ❌ W0 | ⬜ pending |
| 04-11-XX | 10 (rate-limit verify) | 3 | WIRE-13/14/15 | T-04-04 | Per-user 30/min rate limit on 3 token-mint routes; userId-keyed via @fastify/rate-limit | integration | `pnpm --filter @openwhispr/api test src/routes/tokens/__tests__/rate-limit.test.ts --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/src/routes/agent/__fixtures__/` — directory with ≥7 recorded LiteLLM SSE fixtures: `text-only.sse`, `single-tool-call.sse`, `multi-tool-call.sse`, `tool-call-with-text.sse`, `premature-close.sse`, `error-mid-stream.sse`, `usage-final-chunk.sse`. Generated by a one-shot capture script against the contract-mode LiteLLM with `mock_response` configured per fixture.
- [ ] `tests/spikes/04-provider-shapes.md` — curl-verified response bodies for AssemblyAI v3 `/v3/token`, Deepgram `/v1/auth/grant`, OpenAI `/v1/realtime/client_secrets`. Each entry has request example + response example + observed TTL.
- [ ] `tests/e2e/mock-realtime/` — new package with `package.json`, `server.ts`, `tsconfig.json` skeleton. Implementation deferred to Wave 2 but the package boundary lands in Wave 0 so Wave 1+ tests can reference it.
- [ ] `apps/api/src/lib/sse-parser.test.ts` — failing-by-default test stubs referencing each fixture (TDD red state before Wave 1 green).
- [ ] `apps/api/src/lib/tool-call-accumulator.test.ts` — failing-by-default test stubs for: single tool, multi tool, malformed JSON args, `finish_reason==="stop"` with partial accumulator (safety case).
- [ ] `compose/traefik/dynamic.yml` — placeholder file referenced by Wave 1 Traefik task; planner ensures it exists before Wave 1 runs.

*Existing infrastructure: Vitest, undici (Node 24 bundled), ws library (via @fastify/websocket transitive), @fastify/rate-limit (Phase 2 D-28), Better Auth dual-auth (Phase 2 D-04), error-handler (Phase 2 D-13), CONTRACT-01 zod harness (Phase 2 D-17), mock-LiteLLM contract profile (Phase 3 D-05).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live 65-min OpenAI Realtime soak passes without ingress-attributable disconnects | SCALE-05 (criterion 2) | Costs ~$15-25 per run, cannot run on PR; nightly scheduled + manual `workflow_dispatch` only | Trigger `nightly-realtime-soak.yml` via GitHub UI; review artifacts: ping-RTT histogram, close-code log, total duration. Pass = zero close frames originating from our ingress chain for T+3900s; OpenAI 1006s are recorded but do not fail. |
| Production cert-reuse on `:8443` entrypoint works with Let's Encrypt or cert-manager | SCALE-05 (criterion 2) | Production-specific; dev uses mkcert (no ACME). Operator must validate against their cert source. | Document in `docs/self-hosting.md` § ingress: "When deploying with `:8443` for realtime, configure cert-manager to issue a SAN cert covering the same host as `:443`, OR reuse the existing `:443` certificate via `tls.certificates` shared block. Let's Encrypt HTTP-01 cannot validate on `:8443` directly; DNS-01 or TLS-ALPN-01 (port-443 only, so use cert-reuse) are the supported paths." Operator runs `curl -v wss://api.example.com:8443/v1/realtime` post-deploy and confirms TLS handshake succeeds. |
| Traefik `:443` short-JSON routes are NOT affected by the new realtime entrypoint | SCALE-05 | Negative property — can't easily prove in automated test that `:443` defaults are unchanged | After Wave 1 Traefik task, run `make test` against the running stack and observe `/api/health` p95 latency on `:443` is unchanged from Phase 3 baseline (~10ms). Record in PHASE-REPORT.md. |

---

## Threat Model References

Threat IDs referenced in the verification map above (planner expands these in PLAN.md `<threat_model>` blocks per Step 5.55 of plan-phase):

- **T-04-01:** Token-mint endpoint key leakage — bearer-leak abuse burns provider quota. **Mitigation:** per-user 30/min rate limit (D-19) + missing-key 503 (D-18) + provider-side 3s/5s timeouts (D-20). Verified in unit + integration tests.
- **T-04-02:** Ingress timeout DoS — long-running WSS sessions on `:443` could exhaust Traefik's connection pool and degrade short-JSON routes. **Mitigation:** dedicated `:8443` entrypoint (D-21) isolates the long-timeout regime. Verified by structural assertion on `compose/traefik/traefik.yml` and by the hermetic 5-min soak passing while `:443` `/api/health` latency stays nominal.
- **T-04-03:** NDJSON stream-injection / chunked-encoding poisoning — malformed upstream SSE frames could be re-emitted to the client. **Mitigation:** SSE parser validates each `data:` frame is `JSON.parse`-able before forwarding; malformed frames are dropped + logged + counted. Tool-call accumulator drops accumulator state on `finish_reason==="stop"` with partial args (D-09 safety case). Verified by the `error-mid-stream.sse` and `premature-close.sse` fixtures in unit tests.
- **T-04-04:** Cross-user rate-limit bypass — userId-keyed rate-limit must NOT collapse to IP-keyed under any failure mode. **Mitigation:** `keyGenerator` reads `request.user.id` (set by Better Auth dual-auth hook); if unset, return 401 BEFORE the rate-limit hook fires (Phase 2 D-14 401-not-200 contract). Verified by integration test that asserts an unauthenticated request returns 401, not a rate-limit consumption.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (planner fills the Per-Task Verification Map after PLAN.md files exist)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (SSE fixtures, provider shape spikes, mock-realtime package skeleton)
- [ ] No watch-mode flags in CI commands (`--run` everywhere, never `--watch`)
- [ ] Feedback latency < 120s for unit, < 600s for e2e
- [ ] Buffering-injection negative-control test is non-skippable (no `.skip`, no `if (process.env.SKIP_NEGATIVE)`)
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker confirms every task has automated verify

**Approval:** pending
