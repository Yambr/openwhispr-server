# Phase 3 Wire Contracts (D-09)

**Status:** Locked source-of-truth for Phase 03 Plans 03..07.

**Authoritative upstream:** `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` (860 lines).
All shapes below are quoted from the upstream spec. Citations of the form
`BACKEND_SPEC.md:L<line>` point at the exact range that was extracted.

> **Contract rule (D-09):** every endpoint plan in Phase 03 (Plans 03 — `/api/transcribe`,
> 04 — `/api/reason`, 05 — agent stream / token-mint, 06 — diarization, 07 — realtime WSS)
> implements the schema defined in *this* document. If the upstream spec diverges from
> what is recorded here, this document is updated FIRST and the dependent plans rebase.

This document is **English-only** per CLAUDE.md.

---

## POST /api/transcribe

**Source:** `BACKEND_SPEC.md:L161-L213`.

**Purpose** (verbatim, `BACKEND_SPEC.md:L163`):

> Cloud Whisper transcription. Accepts a single audio chunk as multipart and returns
> transcribed text plus usage metadata.

**Request — `multipart/form-data` fields** (verbatim, `BACKEND_SPEC.md:L173-L186`):

```json
{
  "file": "<binary audio>; filename=audio.webm; Content-Type=audio/webm",
  "language": "en",                 // optional, only if explicitly set
  "prompt": "custom dictionary",    // optional
  "sendLogs": false,                 // optional, boolean as string
  "clientType": "desktop",
  "appVersion": "1.x.y",
  "clientVersion": "1.x.y",
  "sessionId": "<uuid>",
  "clientTranscriptionId": "<uuid v4>",
  "source": "file_upload"            // optional, only on file-upload path
}
```

**Multi-chunk note** (verbatim, `BACKEND_SPEC.md:L188`):

> For file-upload path the file name and Content-Type reflect the source extension
> (`AUDIO_MIME_TYPES` map). Files larger than `CLOUD_INLINE_LIMIT` are split client-side
> into ordered chunks via `chunkedCloudTranscribe()` and each chunk is POSTed separately
> to the same URL with chunk-coordination fields.

**Response body (success)** (verbatim, `BACKEND_SPEC.md:L192-L206`):

```json
{
  "text": "transcribed string",
  "wordsUsed": 1234,
  "wordsRemaining": 8766,
  "plan": "free",
  "limitReached": false,
  "sttProvider": "openai",
  "sttModel": "whisper-1",
  "sttProcessingMs": 412,
  "sttWordCount": 27,
  "sttLanguage": "en",
  "audioDurationMs": 6500
}
```

**Auth** (`BACKEND_SPEC.md:L167`): `Authorization: Bearer <token>` (cookie fallback).

**Error semantics** (verbatim, `BACKEND_SPEC.md:L210`):

> A `limitReached: true` payload at HTTP 200 means the user has exhausted their plan
> quota; the client surfaces a quota-exhaustion UI rather than a generic error.
> [...] 503 → `SERVER_ERROR` per global envelope.

**Multi-chunk client semantics** (verbatim, `BACKEND_SPEC.md:L212`):

> Multi-chunk uploads return per-chunk response objects; the client sums numeric fields
> (`sttProcessingMs`, `sttWordCount`, `audioDurationMs`) across chunks and uses the
> **last** chunk's `wordsUsed`/`wordsRemaining`/`plan`/`limitReached`.

### Decision: wordsUsed semantics

**Resolution of RESEARCH open questions A5/A6:** in v1 we record `wordsUsed` as the
**word count of the transcribed `text`** (server-derived, not client-asserted). The
upstream spec is silent on the unit; it does not commit to either "minutes-of-audio"
or "literal words". v1's quota system is OFF (`limitReached` is always `false`,
PROJECT.md WIRE-05) so the value is observability-only and the cheapest derivation
that matches the field name is the canonical interpretation.

- **Locked unit:** number of whitespace-separated tokens in the response `text`.
- **`wordsRemaining`:** always reported as a positive sentinel (`Number.MAX_SAFE_INTEGER`
  or a fixed `999_999_999`) in v1 to signal "unlimited" without breaking the response
  shape the desktop reads (`BACKEND_SPEC.md:L208`).
- **`plan`:** `"unlimited"` for every authenticated tenant in v1 (PROJECT.md DATA-03).
- **`limitReached`:** always `false` in v1.
- **v2 change-window:** revisit when per-user quota enforcement is implemented; if
  pricing moves to minutes-of-audio, the unit re-binds and the desktop reads no
  different fields.

This document is the canonical answer for Plan 03 and downstream contract tests.

---

## POST /api/reason

**Source:** `BACKEND_SPEC.md:L242-L296`.

**Purpose** (verbatim, `BACKEND_SPEC.md:L244`):

> Cloud reasoning — the OpenWhispr-hosted equivalent of "send the transcript to an LLM
> for cleanup / agent processing." Used by the `openwhispr` inference provider.

**Auth** (`BACKEND_SPEC.md:L248`): `Authorization: Bearer <token>` (cookie fallback).

**Request body** (verbatim, `BACKEND_SPEC.md:L252-L275`):

```json
{
  "text": "raw transcript",
  "model": "claude-sonnet-4-6",
  "agentName": "Claude",
  "customDictionary": ["Yambr", "Gizmo"],
  "customPrompt": "Optional user-provided cleanup prompt",
  "systemPrompt": "Optional system override",
  "language": "en",
  "locale": "en-US",
  "sessionId": "<uuid>",
  "clientType": "desktop",
  "appVersion": "1.x.y",
  "clientVersion": "1.x.y",
  "sttProvider": "openai",
  "sttModel": "whisper-1",
  "sttProcessingMs": 412,
  "sttWordCount": 27,
  "sttLanguage": "en",
  "audioDurationMs": 6500,
  "audioSizeBytes": 90123,
  "audioFormat": "webm",
  "clientTotalMs": 1200
}
```

**Field tolerance** (verbatim, `BACKEND_SPEC.md:L278`):

> All fields except `text` are conditional on the caller supplying them (`opts.*`).
> The server is expected to tolerate missing keys.

**Response body (success)** (verbatim, `BACKEND_SPEC.md:L282-L289`):

```json
{
  "text": "cleaned-up transcript",
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "promptMode": "cleanup",
  "matchType": "agent"
}
```

**Client read set** (verbatim, `BACKEND_SPEC.md:L292`):

> The client reads exactly these five fields.

**Error envelope** (verbatim, `BACKEND_SPEC.md:L294`):

> 401 → `{ success: false, error: "Session expired", code: "AUTH_EXPIRED" }`.
> 503 → `{ success: false, error: "Request timed out", code: "SERVER_ERROR" }`.
> Other non-2xx → reads `errorData.error` if present, else `API error: <status>`.

**Default model selection (Phase 03 binding):** when the desktop omits `model`, the
server resolves the default via the bundled LiteLLM `model_list` in
`compose/litellm/litellm_config.yaml` — `gpt-4o-mini` (D-10). Corporate operators set
their preferred default in their override LiteLLM config; no code change required
(LITELLM-05).

---

## Diarization

**Source:** the upstream `BACKEND_SPEC.md` does NOT enumerate a diarization endpoint
in its Cloud Endpoints section. Diarization is documented only in passing
(`BACKEND_SPEC.md:L801`):

> Diarization-per-realtime-session — Phase 05 keeps diarization local (sherpa-onnx).
> The backend's `/v1/audio/diarization` endpoint (Speaches+pyannote) is documented
> in upstream Speaches docs but not yet wired into the desktop client.

This text is verbatim from `BACKEND_SPEC.md:L801`. The desktop client therefore does
not currently call any server-side diarization route; the surface exists for future
desktop work and for non-desktop clients (web console, CLI) and for the Speaches
companion deployment described in `speaches-audio.md`.

```text
Quoted source: BACKEND_SPEC.md:L800-L802 (paraphrased here, verbatim above):
  "Out of scope for v1: Diarization-per-realtime-session ... The backend's
  /v1/audio/diarization endpoint (Speaches+pyannote) is documented in upstream
  Speaches docs but not yet wired into the desktop client."
```

### Decision: diarization mount

**Resolution of D-09 open question (mount path):**

- **Locked path:** `POST /v1/audio/diarization` (single canonical mount).
- **Rationale:** Speaches' OpenAI-compatible namespace already publishes
  `/v1/audio/diarization`; the upstream desktop spec references that exact path
  (`BACKEND_SPEC.md:L801`). Mounting under `/v1/audio/...` keeps the surface
  consistent with `/v1/audio/transcriptions` (Plan 03) and `/v1/realtime` (Plan 07),
  and it matches what corporate-override LiteLLM proxies serve when an operator points
  `LITELLM_BASE_URL` at their internal Speaches+pyannote stack.
- **No `/api/diarization` alias is shipped in v1.** A second mount-point would force
  every contract test, OIDC trusted-origin entry, and observability label to ship
  twice with no caller benefit. If a future desktop release calls `/api/diarization`
  the alias is added without breaking existing callers.

**Implementation owner (D-07 REVISED, 2026-05-10):** `apps/api/src/routes/diarization.ts`
(authored in Plan 06). The Fastify route orchestrates pyannote.ai's 4-step async API
(presigned upload → diarize → poll). LiteLLM `pass_through_endpoints` is single-hop
and cannot drive the flow, so `compose/litellm/litellm_config.yaml` deliberately
omits a pyannote pass-through entry. Corporate operators with their own single-hop
pyannote-compatible endpoint MAY add `pass_through_endpoints` in their override
LiteLLM config and route via `LITELLM_BASE_URL`, but bundled mode does not.

**Auth (Plan 06):** `Authorization: Bearer <token>` (cookie fallback) — symmetric
with `/api/transcribe` and `/api/reason`.

---

## WSS /v1/realtime

**Source:** `BACKEND_SPEC.md:L761-L803`.

**Endpoint** (verbatim, `BACKEND_SPEC.md:L763`):

> `WSS ${OPENWHISPR_REALTIME_WSS_URL}?intent=transcription` — defaults to
> `wss://${host(OPENWHISPR_BACKEND_URL)}/v1/realtime` derivation when only
> `OPENWHISPR_BACKEND_URL` is set at build time.

**Wire protocol** (verbatim, `BACKEND_SPEC.md:L765`):

> OpenAI Realtime API. The backend MUST implement the protocol byte-for-byte — the
> desktop client speaks the upstream OpenAI Realtime spec without modification.

**Auth** (verbatim, `BACKEND_SPEC.md:L767-L770`):

```text
- Authorization: Bearer <openai-api-key-or-realtime-token> HTTP header at WebSocket
  upgrade time.
- The apiKey parameter passed to OpenAIRealtimeStreaming.connect({ apiKey, model })
  is forwarded as the bearer token. For BYOK, this is the user's OpenAI API key.
  For cloud-token mode, this is a short-lived ephemeral token minted via
  POST /api/openai-realtime-token.
- Custom header: OpenAI-Beta: realtime=v1 is also sent — backends MAY ignore.
```

**Required server semantics** (verbatim event taxonomy, `BACKEND_SPEC.md:L774-L781`):

```text
| Server message type                                          | Client behavior                                                                                       |
| transcription_session.created                                | Either treat as ready (when preconfigured) or send transcription_session.update with PCM16/server-VAD. |
| transcription_session.updated                                | Treat as ready and resolve the connect promise.                                                        |
| conversation.item.input_audio_transcription.delta            | Streaming partial transcript — append event.delta to current partial.                                  |
| conversation.item.input_audio_transcription.completed        | Final segment — event.transcript is the completed turn text.                                           |
| input_audio_buffer.speech_started/...speech_stopped/...committed | Server-VAD signals; speech_started captures timestamp for ordering.                                |
| error                                                        | Surface event.error.message via onError. Empty-buffer errors are benign during disconnect.            |
```

**Client → server events** (verbatim, `BACKEND_SPEC.md:L783-L786`):

```text
- input_audio_buffer.append — base64-encoded PCM16 audio chunks (24kHz mono).
- input_audio_buffer.commit — sent at disconnect to flush remaining audio. Server
  should emit a final ...transcription.completed event in response.
- transcription_session.update — only when not preconfigured; sets
  input_audio_format: "pcm16", model, and turn-detection config.
```

**Timeouts and limits** (verbatim, `BACKEND_SPEC.md:L788-L791`):

> Connection timeout: client aborts if `transcription_session.created`/`updated` is
> not received within 15000 ms. Disconnect commit timeout: client waits up to 3000 ms
> after sending `input_audio_buffer.commit` for a final transcription before closing.
> Recommended server-side WebSocket idle timeouts: 3600 s read/send (per the Yambr
> nginx ingress / Speaches deployment reference). Shorter timeouts cause spurious
> mid-session disconnects on long dictations.

**Cold-start buffering** (verbatim, `BACKEND_SPEC.md:L793-L794`):

> The client buffers up to 3 seconds of PCM (pre-`OPEN`) and flushes it after the
> WebSocket reaches `OPEN`. This means the server may receive a burst of
> `input_audio_buffer.append` events at session start.

**Graceful unavailability** (verbatim, `BACKEND_SPEC.md:L798`):

> If the backend has not yet deployed `WSS /v1/realtime`, it SHOULD reject the
> WebSocket upgrade with HTTP `503 Service Unavailable`.

**Channel-scheme echo (cross-reference):** `BACKEND_SPEC.md:L806-L816` documents
the custom-protocol redirect after OAuth — orthogonal to the realtime WSS upgrade,
but the same `OPENWHISPR_PROTOCOL` env var governs both surfaces. Plan 07 references
this section when wiring `WSS` upgrades through Traefik.

**Phase 3 binding (Plan 07):** the bundled LiteLLM `model_list` ships three realtime
entries (D-12) — `gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview` — all
backed by OpenAI's Realtime API direct (`mode: realtime`). Corporate operators with
Speaches/Azure override via `LITELLM_BASE_URL`.

---

## Global error envelope

**Source:** `BACKEND_SPEC.md:L47-L78`. Every non-2xx response on every Phase 3 endpoint
returns `{ "error": "<human-readable string>" }` per the global envelope. WIRE-17 /
WIRE-18 from `PROJECT.md` apply unmodified.

## Source-of-truth pointer

This document is the canonical wire-contract reference for Phase 03 Plans 03..07.
Plans MUST quote the relevant section above in their `<context>` block. Updates to
upstream `BACKEND_SPEC.md` propagate here first; downstream plans rebase from this
file, never from the upstream directly.

*Last updated: 2026-05-10 (Phase 03 Plan 01 Task 1).*
