# ADR-0008: LiteLLM proxy as the single AI-plane abstraction

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a constitutional decision in force since Phase 4)

## Context

OpenWhispr Server brokers requests to multiple AI providers across multiple
modalities: speech-to-text (Whisper-family), diarization (pyannote), realtime
WSS audio (Speaches / OpenAI Realtime / equivalent), reasoning (chat
completion), and provider-specific web-search (Tavily, Yandex Search). Each
provider has its own auth, error model, retry semantics, rate-limit headers,
and token-accounting shape.

The project goal is **"OSS out of the box, corporate-LiteLLM-ready by env
override"** (CLAUDE.md, core value statement). Corporate operators already
run a centralized LiteLLM proxy in front of their internal model gateway and
billing ledger — the server must point at that proxy by setting two env vars,
not by code change.

Constraints:

- A single abstraction in front of every AI provider so the server has one
  HTTP client, one error model, one set of redact patterns.
- No parallel "fallback abstraction" that we maintain ourselves alongside
  LiteLLM — that path duplicates work and drifts.
- Pass-through of multipart audio uploads byte-for-byte; the LiteLLM
  v1.83.7-stable fix (multipart-passthrough) is what unlocked the
  spec-compliant Whisper pass-through.
- Env-driven override: `LITELLM_BASE_URL` and `LITELLM_VIRTUAL_KEY` flip the
  server from the bundled proxy to the corporate proxy with zero code change.

## Decision

**LiteLLM Proxy (≥ v1.83.7-stable)** is the single AI-plane abstraction.

- The default `docker-compose` ships a LiteLLM container wired with open-source
  configuration: keys come from `.env` (OpenRouter, OpenAI, Groq, pyannote).
  No local model weights are bundled — keys are operator-supplied at run time.
- The api uses `@fastify/http-proxy` to pass-through `/v1/audio/*`,
  `/v1/chat/completions`, and friends to `LITELLM_BASE_URL`. Authentication
  to LiteLLM uses `LITELLM_VIRTUAL_KEY` as a Bearer token.
- The Helm chart exposes `litellm.mode=bundled` (default) and
  `litellm.mode=external` (skips the bundled Deployment and the spend-log
  scheduler — the corporate proxy ingests its own ledger).
- Web-search providers (Tavily, Yandex Search) live behind a thin adapter
  in `apps/api/src/lib/web-search/` because they are not modeled by LiteLLM's
  v1.83 surface; this is the only "outside LiteLLM" AI integration and it is
  documented as an exception.

## Consequences

- **Easier:** one HTTP client config, one redact policy (LiteLLM virtual key
  masked by pino redact), one set of retry / circuit-breaker rules across
  every AI surface; one place to add new providers (corporate ops add a
  model to their LiteLLM, the server learns about it via env).
- **Easier (corporate path):** flip `LITELLM_BASE_URL` to the corporate proxy
  URL and `LITELLM_VIRTUAL_KEY` to the corporate-issued virtual key. Done.
- **Harder:** LiteLLM upstream releases are now in our supply chain; we pin
  to a known-good tag (≥ v1.83.7-stable) and re-test on bumps. A LiteLLM
  bug becomes our bug operationally even if the fix is upstream.
- **Risk:** v1.82.x had a multipart-passthrough bug that broke wire-compat
  with `BACKEND_SPEC.md` Whisper pass-through; pinned floor at v1.83.7
  documents the minimum. The `lint-deps` CI gate asserts the version pin.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Custom multi-provider abstraction** in apps/api | Reinvents LiteLLM's adapter library, retry logic, spend tracking, and rate-limit handling at no benefit; corporate operators would still need to bridge to their existing LiteLLM, doubling the surface area. |
| **Helicone** | Strong observability layer but weaker breadth of provider coverage and weaker corporate self-host story (designed as a hosted SaaS first). |
| **Portkey** | Similar trade-offs to Helicone; smaller OSS community than LiteLLM. |
| **Bare provider SDKs** (openai-node + groq-sdk + replicate-sdk + …) | N SDKs, N retry models, N rate-limit shapes, N error envelopes; multiplied operator burden. |
| **Bundle local model weights (Speaches / whisper.cpp)** | Tried and reverted — model weights are gigabytes, image bloat is a non-starter for OSS quickstart, and Speaches's GPU requirement excludes most laptops. Operator-supplied keys to hosted Whisper via OpenRouter/Groq are the pragmatic default; Speaches stays reference-only for plateau-mode load tests. |

## References

- CLAUDE.md (root) — core value statement
- `docs/litellm-target-spec.md` — corporate LiteLLM contract
- `docs/litellm-mock-mode.md` — hermetic e2e setup
- Phase 4 plans (LiteLLM bootstrap)
- Phase 9 Helm chart (`litellm.mode` knob)
- ADR-0006 (wire-compatibility — LiteLLM multipart pass-through is load-bearing)
- https://github.com/BerriAI/litellm
