# @openwhispr/mock-litellm

Hermetic Fastify 5 stand-in for the LiteLLM proxy used **only** under the
`load-test-mock` docker-compose profile (wired in Phase 08 plan 05).

> **PROFILE-GATED — DO NOT RUN IN THE DEFAULT PROFILE.** The default
> `docker compose up` MUST resolve to the real LiteLLM upstream
> (`compose/litellm/`). The mock exists so the k6 load test (plan 08-06)
> can exercise the api's connection-pool, queue, and timeout behaviour
> against a deterministic, zero-cost upstream.

## Endpoints

| Method | Path                       | Default latency      | Body shape                                                             |
| ------ | -------------------------- | -------------------- | ---------------------------------------------------------------------- |
| POST   | `/v1/audio/transcriptions` | `1500ms ± 400ms`     | Whisper `{ text, duration, language }`                                 |
| POST   | `/v1/chat/completions`     | sync `300ms ± 80ms`  | OpenAI `chat.completion` envelope                                      |
| POST   | `/v1/chat/completions`     | stream first-token `200ms ± 50ms`, ~30ms per chunk | SSE `data: {chunk}\n\n` … `data: [DONE]\n\n` when `stream: true`       |
| GET    | `/health/liveliness`       | `0ms`                | `{ status: "ok" }`                                                     |

Latency is uniform-noise jitter around the mean, clamped to ≥ 50ms.
Means and stddevs are overridable via env vars (see below).

## Configuration

All env vars are optional. Numeric units are milliseconds.

| Env var                     | Default     |
| --------------------------- | ----------- |
| `PORT`                      | `4000`      |
| `HOST`                      | `0.0.0.0`   |
| `TRANSCRIBE_MEAN_MS`        | `1500`      |
| `TRANSCRIBE_SD_MS`          | `400`       |
| `CHAT_MEAN_MS`              | `300`       |
| `CHAT_SD_MS`                | `80`        |
| `STREAM_FIRST_TOKEN_MS`     | `200`       |
| `STREAM_FIRST_TOKEN_SD_MS`  | `50`        |

## Local development

```bash
# from the repo root
pnpm --filter @openwhispr/mock-litellm dev          # tsx watch
pnpm --filter @openwhispr/mock-litellm test         # unit tests
pnpm --filter @openwhispr/mock-litellm test:coverage  # with v8 coverage report
```

## Docker

```bash
docker build -t openwhispr-mock-litellm:dev compose/mock-litellm/
docker run --rm -p 4000:4000 openwhispr-mock-litellm:dev
curl -fsS http://localhost:4000/health/liveliness
# → {"status":"ok"}
```

The image is multi-stage Node 24-alpine and ships only the bundled
`dist/server.js` plus production node_modules — no source, no dev deps.

## Why this is allowed under "no mocks of internal logic"

CLAUDE.md forbids mocking **internal** logic. `mock-litellm` is a
**process boundary** — it replaces an external HTTP service that the
api connects to via `LITELLM_BASE_URL`. The api code path is
unchanged. Per CLAUDE.md, mocks at process/network boundaries are
explicitly permitted.

## Wave 1 hook-up

Plan 08-05 adds the following block to `docker-compose.yml`:

```yaml
mock-litellm:
  build: ./compose/mock-litellm
  profiles: ["load-test-mock"]
  networks:
    default:
      aliases:
        - litellm  # api resolves LITELLM_BASE_URL → http://litellm:4000
```

The `litellm` network alias makes the swap transparent to the api: no
code change, no env override beyond the profile flag.
