# OpenWhispr Server

A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

> **Status: Phase 0 (Repo Bootstrap & Constitutional CI).** The repo skeleton, CI, and constitutional disciplines are in place. Wire-API endpoints land in Phase 2+.

## Constitutional rules

Every PR enforces:

1. **Strict TDD** — tests precede production code. PR template + advisory commit-order check.
2. **GitHub Actions CI** must be green before any merge to `main`.
3. **English only** for source artifacts (docs, code, comments, identifiers, log keys, commit messages). Mechanically enforced via `tools/lint-english.ts`.
4. **Coverage gate** >= 85% lines / >= 80% branches.
5. **Mutation gate** (Stryker) on auth, multi-tenancy, virtual-key modules.
6. **No plaintext HTTP** on any externally reachable port (Phase 1+).

## Quickstart

```bash
git clone https://github.com/<owner>/openwhispr-server.git
cd openwhispr-server
corepack enable
pnpm install
make dev    # docker compose up -d (placeholder service in Phase 0) + parallel pnpm dev
make test   # full local suite: lint + typecheck + vitest + stryker incremental
```

`make dev` will boot a placeholder Fastify app on `http://localhost:3000/api/health` returning `{"status":"phase-0-placeholder"}`. Real services land starting Phase 1.

The Phase 03 endpoints — `POST /api/transcribe`, `POST /api/reason`, `POST /v1/audio/diarization`, and `WSS /v1/realtime` — are wired through the bundled LiteLLM proxy (out of the box) or a corporate-override LiteLLM via `LITELLM_BASE_URL`. See [docs/litellm-target-spec.md](./docs/litellm-target-spec.md) for the full topology and env override matrix, and [docs/wire-contracts-phase-3.md](./docs/wire-contracts-phase-3.md) for the desktop wire shape.

### Provider Keys (optional)

The bundled-default topology calls public providers via the LiteLLM proxy. Drop real keys into your `.env` to enable each surface; missing keys produce a 503 envelope on the corresponding endpoint (the realtime WSS upgrade closes with an error frame when `OPENAI_API_KEY` is unset).

| Env var              | Used by                                                                                  | Where to get a key                                  |
| -------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `OPENROUTER_API_KEY` | Chat / reasoning via `/api/reason` (D-06 default `qwen3.6-plus`, D-10 fallback)          | https://openrouter.ai/keys                          |
| `GROQ_API_KEY`       | Whisper-large-v3 STT via `/api/transcribe` (D-11 — fastest hosted Whisper)                | https://console.groq.com/keys                       |
| `OPENAI_API_KEY`     | Realtime WSS direct via `WSS /v1/realtime` (D-12 — `gpt-realtime` GA)                     | https://platform.openai.com/api-keys                |
| `PYANNOTE_API_KEY`   | Diarization via `/v1/audio/diarization` (D-07 REVISED — consumed by the Fastify route, **NOT** the LiteLLM container) | https://dashboard.pyannote.ai/                      |

Corporate operators set `LITELLM_BASE_URL=https://litellm.corp.example.com` instead of pasting individual provider keys; the corporate proxy holds the credentials. See [docs/litellm-target-spec.md](./docs/litellm-target-spec.md) "Corporate-Override Configuration" for the full setup.

### Testing Modes

| Target                | Network                          | Quota cost   | When to run                                                      |
| --------------------- | -------------------------------- | ------------ | ---------------------------------------------------------------- |
| `make test`           | none (vitest + stryker)          | none         | Every commit; covers unit + property + mutation slices.          |
| `make contract-test`  | local docker only                | none         | Hermetic CI default. Uses LiteLLM `mock_response` + `MOCK_DIARIZATION=true`. See [docs/litellm-mock-mode.md](./docs/litellm-mock-mode.md). |
| `make e2e-test`       | real provider APIs               | real money   | Requires `.env.e2e` with `OPENROUTER_API_KEY` + `GROQ_API_KEY` + `OPENAI_API_KEY` + `PYANNOTE_API_KEY`. Operator-driven cadence (NOT every PR). See [.env.e2e.example](./.env.e2e.example). |

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to set up dev env, TDD discipline, Conventional Commits, English-only rule
- [SECURITY.md](./SECURITY.md) — how to report vulnerabilities
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [docs/operations.md](./docs/operations.md) — operator-facing setup (Phase 0: branch protection; Phase 8/10: full ops)
- [docs/adrs/](./docs/adrs/) — Architecture Decision Records

## License

Apache-2.0. See [LICENSE](./LICENSE).
