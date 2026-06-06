# tests/e2e — host-side end-to-end suite

Per `.planning/DISCIPLINE.md` rule 3 ("E2E is mandatory"), every phase
that touches a wire surface MUST ship at least one e2e test that boots
the real `docker compose` stack and round-trips a route.

This directory is the **host-side** suite. Unlike the in-cluster
`packages/contract-tests/` runner (which executes inside the
`openwhispr_internal` network and dials `http://api:3000`), the host-side
suite dials `https://api.localhost` through Traefik with the dev
self-signed cert — exactly what the desktop client does on a developer
laptop.

## Modes

| Target            | Profile                                                  | Provider keys | Network egress |
| ----------------- | -------------------------------------------------------- | ------------- | -------------- |
| `make e2e-hermetic` | `default + contract-test` with `litellm_config.contract.yaml` | none          | none (mock LiteLLM) |
| `make e2e-test`   | `default + contract-test` with `litellm_config.yaml`     | required (`.env.e2e`) | yes (Groq / OpenRouter / OpenAI) |

The hermetic profile uses LiteLLM's `mock_response` field so every
chat-completions / transcription call short-circuits inside LiteLLM
before any provider is contacted. Realtime entries do not support
`mock_response`; the realtime e2e asserts only the auth gate + proxy
hop (NOT a successful WSS session).

## Discoveries during back-fill

- `gpt-realtime` mock entry has `api_key: "fake-key-for-mock"` but no
  `mock_response`. LiteLLM short-circuits at the WSS upgrade BEFORE the
  mock layer fires, so the e2e asserts upstream-close-with-defined-code
  rather than a successful realtime session. Documented in
  `realtime.e2e.test.ts`.
- `https://api.localhost` is reachable from the host because RFC 6761
  reserves `*.localhost` to resolve to loopback; macOS + glibc + musl
  all honor this. The Traefik dev cert is self-signed, so the e2e fetch
  client passes `NODE_TLS_REJECT_UNAUTHORIZED=0` for the test process
  ONLY — never to the api container.
