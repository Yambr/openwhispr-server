# LiteLLM Mock Mode — Hermetic Contract Tests

**Status:** Operator-facing reference. Documents the architecture used by `make contract-test` to run the contract suite without internet access, provider quotas, or operator-supplied API keys.

**Companion docs:**

- `docs/litellm-target-spec.md` — bundled-default + corporate-override topology.
- `Makefile` — `contract-test` (hermetic, mock mode) and `e2e-test` (real provider keys, requires `.env.e2e`).

---

## What This Solves

The OpenWhispr Server contract suite verifies wire-shape conformance against `BACKEND_SPEC.md` for `/api/transcribe`, `/api/reason`, and `WSS /v1/realtime`. CI (and operator dev laptops) need to exercise the real network path through `Traefik → api → litellm` without:

- Burning real OpenAI / OpenRouter / Groq quota on every PR.
- Requiring operator-supplied API keys to clone-and-test the repo.
- Adding fragile network dependencies that flake when an upstream provider has a bad day.

LiteLLM ships a native `mock_response` feature on `litellm_params`. It is **not** a workaround — it is the upstream-supported way to exercise the proxy's request/response surface without making outbound calls. We use it as the canonical hermetic-CI substrate.

---

## How It Works

The `contract-test` profile in `docker-compose.yml` sets the `LITELLM_CONFIG_FILE` environment variable to `litellm_config.contract.yaml`, which the bundled `litellm` service mounts in place of the production `litellm_config.yaml` (Plan 01 wired the volume mount as `./compose/litellm/${LITELLM_CONFIG_FILE:-litellm_config.yaml}:/etc/litellm/config.yaml:ro`).

Each model in `compose/litellm/litellm_config.contract.yaml` adds a `mock_response` field; LiteLLM short-circuits the request and returns the canned payload without touching any upstream provider. No outbound network calls, no quota burned, deterministic CI.

The `make contract-test` target in the repo root is the canonical entry point:

```makefile
contract-test:
    LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
      docker compose --profile default --profile contract-test up -d --wait
    ...
```

---

## Per-Model mock_response

Examples from `compose/litellm/litellm_config.contract.yaml`:

```yaml
model_list:
  - model_name: whisper-large-v3            # D-11 (bundled mode: Groq)
    litellm_params:
      model: groq/whisper-large-v3
      mock_response: '{"text":"mock transcription","language":"en"}'

  - model_name: qwen3.6-plus                # D-06 (default reasoning)
    litellm_params:
      model: openrouter/qwen/qwen-3.6-plus
      mock_response: '{"choices":[{"message":{"content":"mock reasoning output"}}]}'

  - model_name: gpt-realtime                # D-12 (OpenAI Realtime direct)
    litellm_params:
      model: openai/gpt-realtime
      mode: realtime
      # no mock_response — see "Realtime caveat" below
```

**Realtime caveat.** LiteLLM does not honor `mock_response` for WSS realtime entries (`mode: realtime`) — the realtime upstream is a long-lived bidirectional stream, not a request/response. Plan 07's contract test asserts proxy reach only (the upgrade succeeds, the proxy handshakes, the connection closes cleanly when the desktop disconnects). Real realtime exercise lives in `make e2e-test` (requires `.env.e2e` `OPENAI_API_KEY`) and Phase 4 e2e fixtures.

---

## ⚠️ Operator Warning — Do Not Leak `LITELLM_CONFIG_FILE` Into a Live Deploy

`LITELLM_CONFIG_FILE` selects which config the `litellm` service mounts. **It must be unset (or `litellm_config.yaml`) for any live / slim-core deployment.** When it is left set to `litellm_config.contract.yaml`, the proxy comes up in hermetic mock mode and behaves asymmetrically:

- `/api/reason` and `/api/agent/stream` return **200** — chat models have a `mock_response`, so they short-circuit cleanly.
- `/api/transcribe` returns **502** — LiteLLM does not reliably short-circuit `mock_response` on the multipart audio passthrough, so the request still reaches the real Groq route and fails (typically `Invalid API Key` if the contract profile carries a placeholder key).

This 502 is **not a server bug** — it is the contract config leaking into a live stack. The failure mode is sneaky because reasoning still works, so the stack looks "mostly healthy."

**How it leaks:** `make contract-test` exports `LITELLM_CONFIG_FILE=litellm_config.contract.yaml` for its `docker compose up`. If a subsequent `docker compose up` runs in the **same shell** without unsetting it, the variable carries over and the live `litellm` container silently boots the mock config.

**Bring a live stack up cleanly:**

```bash
unset LITELLM_CONFIG_FILE          # drop any leftover from a contract-test run
docker compose up -d --force-recreate litellm
```

**Verify the running container has the production config (0 mock entries expected):**

```bash
docker exec <litellm-container> grep -c mock_response /etc/litellm/config.yaml   # → 0
```

The R25 `/api/ready` probe (`docs` — readiness endpoint) catches this at the *upstream* layer: a mock-config `litellm` whose audio route is broken will eventually surface as a degraded `litellm_upstream` check. Prefer `/api/ready` over `/api/health` for the compose healthcheck so an unservable stack is marked `unhealthy`.

---

## Running Locally

```bash
# Hermetic contract suite — no provider keys needed.
make contract-test

# Tear down on completion (the target does this automatically; manual override
# in case of a stuck container):
docker compose --profile default --profile contract-test down -v
```

**Troubleshooting**:

| Symptom                                                                                | Likely cause                                                                            | Fix                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mock_response` payload appears unparsed in test assertions                            | Test reads `text` field from non-mock-aware code path                                   | Check that the model alias under test maps to a `litellm_config.contract.yaml` entry with `mock_response`      |
| Realtime test times out at upgrade                                                     | LiteLLM container is starting; readiness probe not green yet                            | Re-run after `docker compose ps` shows `litellm` healthy                                                       |
| Container restart loop on `litellm`                                                    | `LITELLM_CONFIG_FILE` not honored — check the volume mount expression in compose        | Verify Plan 01's `./compose/litellm/${LITELLM_CONFIG_FILE:-litellm_config.yaml}:...` is present                |
| `/api/transcribe` → 502 on a live stack while `/api/reason` returns 200                | `LITELLM_CONFIG_FILE` leaked from a `make contract-test` run — `litellm` is on the mock config; audio passthrough does not honor `mock_response` | `unset LITELLM_CONFIG_FILE && docker compose up -d --force-recreate litellm`; confirm `grep -c mock_response /etc/litellm/config.yaml` → `0` |

For real-API exercise (operator-paid quota), use `make e2e-test` after creating `.env.e2e` with `OPENROUTER_API_KEY`, `GROQ_API_KEY`, and `OPENAI_API_KEY`. See `Makefile` for the target.

---

*Last updated: 2026-05-22 (R27 — operator warning on `LITELLM_CONFIG_FILE` leak into live deploys).*
