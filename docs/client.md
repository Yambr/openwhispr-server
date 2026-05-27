# OpenWhispr Desktop Client

The OpenWhispr desktop client is an Electron application that captures
microphone input, sends it to this server for transcription / reasoning /
diarization, and renders the result inline. The client is built and
distributed separately so it can ship signed builds and integrate with
OS-native audio capture.

## Download

The client ships as signed Electron builds maintained by Yambr (Apple
Developer ID signed; reproducible builds):

- **Repository:** <https://github.com/Yambr/openwhispr>
- **Releases:** <https://github.com/Yambr/openwhispr/releases>

The upstream (unsigned) lineage lives at the original OpenWhispr project;
operators following this server should use the Yambr signed builds.

## Pair the client with this server

1. Install the client from the release link above.
2. Bring this server up (see [`self-hosting.md`](./self-hosting.md) for
   the variant matrix — embedded LiteLLM is the default OSS quickstart).
3. Point the client at your server's base URL. The exact env var or
   settings field the client reads is documented in the client's own
   README — see <https://github.com/Yambr/openwhispr>.
4. Open the client; sign up or sign in. The client opens its embedded
   auth surface against the server, completes email verification (the
   server sends mail via SMTP — see [`operations.md`](./operations.md)
   §Branded sender via Resend SMTP if you want a branded sender), and stores
   the resulting bearer token locally.
5. Press the hotkey and speak. The audio is streamed to the server,
   transcribed via the configured LiteLLM provider, and the text is
   surfaced in the client.

## Variant compatibility

The client behaves the same against every server variant; only the
provider keys on the server side change.

| Server variant | Client behavior |
|---|---|
| **Variant A — Embedded LiteLLM** (OSS quickstart) | Works out of the box once provider keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, etc.) are set in `.env`. |
| **Variant B — External corporate LiteLLM** | Client is unchanged; the server forwards through your corporate LiteLLM via `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY`. |
| **Variant C — Local Speaches + pyannote** | Client is unchanged; transcription and diarization run offline on the operator's GPU host. Requires `HF_TOKEN` (gated pyannote weights). |

See [`self-hosting.md`](./self-hosting.md) for the full matrix.

## Realtime streaming

If your operator wants the client's realtime mode (low-latency streaming
transcription), open port `:8443` alongside `:443` on the host. The
server uses two TLS entrypoints:

| Entrypoint | Port | Routes | Idle timeout |
|---|---|---|---|
| `websecure` | `:443` | All JSON / NDJSON routes | 180s |
| `websecure-realtime` | `:8443` | `WSS /v1/realtime` only | 3600s |

Both entrypoints share one TLS certificate (single ACME flow). Without
`:8443` reachable, the client's realtime button will fail to connect.
Details in [`self-hosting.md`](./self-hosting.md) §Realtime ingress.

## Verify the pairing

Server health is exposed without auth. From the host:

```bash
curl -sk https://api.your-domain.tld/api/health | jq .
```

A `200` with all components reporting `ok: true` means the client should
be able to authenticate and transcribe. Endpoint contract is in
[`operations.md`](./operations.md).

## Issue triage

- **Client bugs** (UI, hotkey capture, audio routing, Electron native
  modules, signed-build issues) → file in the client repo:
  <https://github.com/Yambr/openwhispr/issues>
- **Server bugs** (API responses, wire-protocol mismatch, auth flow,
  transcription quality, infra) → file in this repo's issues.
- **Wire-protocol mismatch** (client sends X, server rejects with Y) →
  file in the server repo first; we'll triage to the client repo if the
  mismatch is on the client side.

## Wire-protocol references

The server implements the wire surface defined by the upstream
`BACKEND_SPEC.md` / `OAUTH_SPEC.md` / `SELF_HOSTING.md`. The local
[`wire-contract.md`](./wire-contract.md) summarizes the contract the
server enforces; the upstream specs are the source of truth for new
client implementations.
