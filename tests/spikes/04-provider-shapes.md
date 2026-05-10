# Phase 04 — Provider Token-Mint Response Shapes Spike

**Phase:** 04-streaming-realtime
**Plan:** 04-01 (Task 2)
**Date:** 2026-05-10
**Verifier:** parallel-worktree executor

This spike documents the request and response shapes for the three
ephemeral-token mint endpoints Wave 1 will call from `apps/api/src/routes/tokens/*`:

| Provider | Endpoint | Token field |
|----------|----------|-------------|
| AssemblyAI Streaming v3 | `GET https://streaming.assemblyai.com/v3/token` | `token` |
| Deepgram Grant Token | `POST https://api.deepgram.com/v1/auth/grant` | `access_token` |
| OpenAI Realtime client_secrets | `POST https://api.openai.com/v1/realtime/client_secrets` | `value` |

**Verification status — overall:** all three providers fall back to the
documented shape from each provider's official 2026 API reference because
no API keys are available in this worktree environment (`ASSEMBLYAI_API_KEY`,
`DEEPGRAM_API_KEY`, `OPENAI_API_KEY` all unset). A future contributor with
the corresponding env keys MUST re-run this spike via the curl commands
below and overwrite the fixture JSONs with real captures (sanitizing token
values to `<REDACTED-...>` placeholders before commit). CI does NOT gate on
this fixture; Wave 1 contract tests run against the documented shape and
will surface any drift the moment a real call is made.

---

## 1. AssemblyAI Streaming v3 — `GET /v3/token`

### Request

```bash
curl -s "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60" \
  -H "Authorization: ${ASSEMBLYAI_API_KEY}"
```

- **Method:** `GET`
- **URL:** `https://streaming.assemblyai.com/v3/token`
- **Query:** `expires_in_seconds` ∈ `[1, 600]` (60 used here per D-14)
- **Headers:** `Authorization: <ASSEMBLYAI_API_KEY>` (NOTE: no `Bearer` prefix — AssemblyAI uses raw key)
- **Body:** none

### Response (documented shape)

```json
{
  "token": "<REDACTED-assemblyai-v3-ephemeral-token-base64ish-payload-...>"
}
```

- **Token field name:** `token` (CONFIRMED via D-14; **NOT** `access_token`).
- **TTL observed:** 60 seconds (request param echoed).
- **Single-use per session.** Provider default `max_session_duration_seconds = 3h`
  (omitted here per D-14).

### Verification

- **Date verified:** 2026-05-10
- **Verified:** no (fallback to documented shape — `ASSEMBLYAI_API_KEY` unset)
- **Source of shape:** AssemblyAI Streaming v3 API reference,
  https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token
- **Re-verify command:** `ASSEMBLYAI_API_KEY=... bash -c 'curl -s "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60" -H "Authorization: $ASSEMBLYAI_API_KEY"'`

---

## 2. Deepgram Grant Token — `POST /v1/auth/grant`

### Request

```bash
curl -s -X POST "https://api.deepgram.com/v1/auth/grant" \
  -H "Authorization: Token ${DEEPGRAM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"ttl_seconds":30}'
```

- **Method:** `POST`
- **URL:** `https://api.deepgram.com/v1/auth/grant`
- **Headers:** `Authorization: Token <DEEPGRAM_API_KEY>` (provider-specific scheme),
  `Content-Type: application/json`
- **Body:** `{"ttl_seconds": 30}` (per D-15; max 30, default 30)

### Response (documented shape)

```json
{
  "access_token": "<REDACTED-deepgram-grant-jwt-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature>",
  "expires_in": 30
}
```

- **Token field name:** `access_token` (CONFIRMED via D-15; **NOT** `token`).
- **TTL observed:** 30 seconds (provider hard cap).
- Unlimited issuance, no `project_id` required (vs the `/v1/projects/{id}/keys`
  path which is capped at 250/day and explicitly rejected by D-15).

### Verification

- **Date verified:** 2026-05-10
- **Verified:** no (fallback to documented shape — `DEEPGRAM_API_KEY` unset)
- **Source of shape:** Deepgram Grant Token API reference,
  https://developers.deepgram.com/reference/token-based-auth-api/grant-token
- **Re-verify command:** `DEEPGRAM_API_KEY=... bash -c 'curl -s -X POST "https://api.deepgram.com/v1/auth/grant" -H "Authorization: Token $DEEPGRAM_API_KEY" -H "Content-Type: application/json" -d "{\"ttl_seconds\":30}"'`

---

## 3. OpenAI Realtime — `POST /v1/realtime/client_secrets`

### Request

```bash
curl -s -X POST "https://api.openai.com/v1/realtime/client_secrets" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"session":{"type":"realtime","model":"gpt-realtime"}}'
```

- **Method:** `POST`
- **URL:** `https://api.openai.com/v1/realtime/client_secrets`
- **Headers:** `Authorization: Bearer <OPENAI_API_KEY>`, `Content-Type: application/json`
- **Body:** `{"session":{"type":"realtime","model":"gpt-realtime"}}` (per D-16)

### Response (documented shape)

```json
{
  "value": "<REDACTED-ek_abcdef0123456789abcdef0123456789>",
  "expires_at": 1700000060,
  "session": {
    "id": "sess_<REDACTED>",
    "object": "realtime.session",
    "type": "realtime",
    "model": "gpt-realtime",
    "expires_at": 1700000060
  }
}
```

- **Token field name:** `value` (CONFIRMED via D-16; **NOT** `client_secret`).
  Token strings start with `ek_`.
- **TTL observed:** ~60 seconds (OpenAI default, not configurable on this endpoint).
- Prefer `/v1/realtime/client_secrets` over the legacy `/v1/realtime/sessions`.

### `streams=2` Multi-Stream Note (D-17)

OpenAI Realtime has no native multi-stream session. For `streams=2`, Wave 1
mints **two ephemeral secrets via two parallel `POST /client_secrets` calls
with `Promise.all`** and returns `{clientSecret: secrets[0], clientSecrets: secrets}`.
The desktop asserts `clientSecrets.length >= 2` when `streams=2` was requested.

### Verification

- **Date verified:** 2026-05-10
- **Verified:** no (fallback to documented shape — `OPENAI_API_KEY` unset)
- **Source of shape:** OpenAI Realtime client_secrets API reference,
  https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret
- **Re-verify command:** `OPENAI_API_KEY=... bash -c 'curl -s -X POST "https://api.openai.com/v1/realtime/client_secrets" -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d "{\"session\":{\"type\":\"realtime\",\"model\":\"gpt-realtime\"}}"'`

---

## Cross-Provider Summary

| Provider     | HTTP method | Auth scheme        | TTL  | Token field    | Verified |
|--------------|-------------|--------------------|------|----------------|----------|
| AssemblyAI   | GET         | raw API key        | 60s  | `token`        | no       |
| Deepgram     | POST        | `Token <key>`      | 30s  | `access_token` | no       |
| OpenAI       | POST        | `Bearer <key>`     | ~60s | `value`        | no       |

All three field names map to our uniform response envelope `{token: "..."}`
in Wave 1 (per BACKEND_SPEC.md §`/api/streaming-token` /
`/api/deepgram-streaming-token` / `/api/openai-realtime-token`).
