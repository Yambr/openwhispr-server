# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.2.11] - 2026-08-30

Two things: the wire contract the 1.9.x desktop actually speaks, and team spaces.

1.2.10 answered `GET /api/me/spaces` to unblock sign-in. That route is also the desktop's team-scope capability probe, so unblocking sign-in necessarily switched every note and folder call to the team-capable form — which this server then rejected. Sign-in worked and nothing synced. Accepting that form is not optional, and it is also the foundation team spaces needed.

### Added

- **Team spaces.** A space is a shared tree of notes and folders; a team is who may open it. Any employee may create either, and the creator manages what they created. Members read, write, edit, delete and SEARCH shared content; a colleague's personal notes stay untouchable throughout.
- Endpoints for spaces (create, rename, retire, assign/unassign a team, list who can open it), teams (create, list, roster, add/remove member, retire), and the workspace bootstrap (`/api/workspaces`, its member picker, `/api/me/joinable`).
- `teams.ad_group` and a `user_groups` table, created ahead of use so binding a team to a directory group needs no migration over live note data.

### Fixed

- **Delta sync had never worked.** The desktop advances its `?since=` cursor with the last row's `updated_at` while the server filtered and ordered by `created_at`, so an edit to an older note entered no delta window at all and never reached a second device. The delta axis is now `(updated_at, id) ASC`, with matching partial indexes.
- **List paths emitted non-ISO timestamps.** Rows read through raw SQL came back as Postgres text, so the same row serialized differently depending on which route produced it — and the client hands that value straight back as its cursor, where URL decoding turns the `+00` offset into a space and the next page 400s.
- **Batch pushes exceeded Fastify's 1 MiB default.** A handful of meeting transcripts clears it, and the desktop cannot split the chunk, so it retried the same oversized body forever. Raised on the batch routes only.
- **Agent conversations never synced.** Message metadata was a flat scalar map; the desktop stores an assistant turn's tool calls as nested structure. Metadata is now bounded by size and depth instead of value type.
- `?scope=all`, `before_id` and `since_id` are accepted on the note and folder listings, and `workspace_id`/`space_id` on every push.

### Security

- Row visibility for spaces lives in the query predicate, because RLS here is tenant-scoped only. Writing into a space you cannot reach is a 403, never a silent demotion to the personal tree.

## [1.2.10] - 2026-08-30

### Added

- **`GET /api/me/spaces`.** The desktop calls this on every sign-in, and not to
  render a list: `SyncService.verifyTeamSpacesForAccount` uses the answer to
  decide which locally cached team spaces the account may keep, destructively
  purging the rest so one account's content cannot survive into another's
  session. The check is deliberately fail-closed, so on a server without the
  route the 404 propagates, the session never validates, and the app hangs on
  its loading screen retrying every 30 seconds — which is what desktop 1.9.3
  did against 1.2.9. The route answers an empty list, which is the correct
  answer here rather than a placeholder: this deployment has no team spaces, so
  no account belongs to one. Anonymous callers get 401, not a well-formed
  answer.

### Fixed

- **Keep-alive now outlives the reverse proxy's.** Fastify defaults to a 72s
  `keepAliveTimeout` while the ingress pools idle upstream connections for
  300s, so nginx could hand a request to a socket Node had already begun
  closing — intermittent 502s with nothing in the application log to explain
  them. The server now holds 305s, above the proxy, so the proxy is always the
  side that closes first. `headersTimeout` moves with it: Fastify leaves that at
  Node's 60s default, which was already *below* the keep-alive it sets, so a
  socket mid-request could be reaped before it finished sending headers. Both
  values are pinned by `keepalive-proxy-alignment.test.ts`; change them and the
  ingress annotation together.

## [1.2.9] - 2026-08-29

### Fixed

- The realtime relay now runs its ping/pong heartbeat on the **upstream** leg as
  well as the client leg. 1.2.7 covered the client leg; the upstream leg kept
  nothing but `handshakeTimeout` — a ceiling on the handshake only, with no
  liveness check once the socket is open. That is the same hole on the other
  leg, and its symptom is worse because it is completely silent: when the path
  to the upstream dies WITHOUT a close frame (a proxy dropping the connection, a
  firewall losing state, a gateway pod evicted mid-session), the relay never
  learns the upstream is gone. It keeps forwarding audio into a black hole while
  its client leg stays perfectly healthy — the client really is alive and
  answers every ping — and the client cannot notice either, because its own
  keepalive pings are answered by the relay automatically, below the
  application. The user just sees the live transcript stop updating, with no
  error, no close and no reconnect. Both legs are now pinged on the same timer
  and torn down together when either peer stops answering, turning that silence
  into a definitive close the client can act on. Each leg is pinged
  independently (a leg that is not OPEN is skipped, never a reason to skip the
  other), and the upstream clock starts on its `open` event because the route
  dials and bridges in the same tick. A cleanly dying upstream was already
  handled — its close frame reaches `closeBoth`; this covers the case where no
  frame ever arrives.

## [1.2.8] - 2026-08-29

### Fixed

- The realtime relay (`/v1/realtime`) now normalizes a **Beta-speaking upstream**
  to GA before the frame reaches the desktop client, so realtime transcription
  starts at all against an upstream that answers in the retired vocabulary.
  Symptom: the client opened the WSS, the socket stayed OPEN, no server event
  was ever recognized, and the client rejected on its own 15s ceiling with
  `OpenAI Realtime connection timeout` (`audioBytesSent: 0`, `segments: 0`) —
  while the server logged the upgrade and nothing else, because nothing had
  failed. Cause: the relay FORCES `?intent=transcription` on the upstream URL
  (OpenAI GA needs it to open a transcription session at all), and on some
  OpenAI-compatible upstreams that same param ALSO switches the event
  vocabulary to Beta — measured on one stand, same audio: with the param
  `transcription_session.created`/`.updated`, without it
  `session.created`/`.updated`, byte-identical transcription either way.
  `translateUpstreamToClient` was an identity function, written when the
  shipping desktop client turned out to speak GA, on the unstated assumption
  that the upstream always does too; the client's switch table handles
  `session.created`/`session.updated` and has no `transcription_session.*`
  branch at all, so the Beta name resolved nothing. The translator now renames
  those two session events and returns every other frame by reference, making
  this a strict no-op for a genuinely GA upstream. Dropping the forced
  `?intent` would fix such a stand and break every operator whose upstream
  really is OpenAI GA, so the normalization lives at the dialect boundary the
  relay already claims to be.
- The relay's `session.updated` echo-swallow (R31 DEFECT 6) now runs AFTER the
  upstream→client translation. It keyed on the raw frame type, so against a
  Beta upstream it silently stopped matching and the relay's own self-injected
  `session.update` echo leaked to the client.

## [1.2.7] - 2026-08-29

### Fixed

- The realtime relay (`/v1/realtime`) no longer leaks an upstream session slot
  when a client dies without a FIN/RST (VPN drop, laptop sleep). Such a client
  leaves the TCP connection ESTABLISHED, so `clientSocket.on("close")` never
  fires, `closeBoth()` is never called, and the relay held its upstream leg —
  and the upstream's session slot — until the edge proxy's read timeout.
  The upstream's own keepalive could not detect this either: `ws` (and the
  Python `websockets` used by an intermediate proxy) answer ping frames
  automatically, below the application, so the upstream saw a healthy peer —
  the relay — while the real client was long gone. The relay now runs its own
  ping/pong heartbeat on the client leg (20s interval, 20s timeout, mirroring
  the usual uvicorn `ws_ping_interval`/`ws_ping_timeout`) and terminates BOTH
  legs when the pongs stop, so a dead client is detected in ~40s worst case
  and the slot is released through the normal path. `terminate` rather than
  `close`: a frozen peer never completes a closing handshake. The heartbeat
  timer is cleared in `closeBoth` and in every error/unexpected-response path.
  Tuning is injectable via `RealtimeDeps.heartbeat` (tests run it on
  millisecond timings); production uses the `DEFAULT_REALTIME_HEARTBEAT_*`
  constants.

## [1.2.6] - 2026-06-10

### Fixed

- `POST /api/reason` no longer returns HTTP 500 with `UND_ERR_HEADERS_TIMEOUT`
  (~30s) when the reasoning model thinks for longer than undici's 30s
  `headersTimeout` before emitting its first output token. The route now calls
  the upstream gateway with `stream: true` internally (via the existing
  `chatCompletionsStream`) so response headers and the first SSE token arrive
  promptly; the server accumulates the streamed deltas into the full text and
  returns the same single JSON body `{ text, model, provider, promptMode,
  matchType }`. The client wire surface is byte-identical — no client change is
  required. A mid-stream upstream failure that arrives after the 200 SSE
  headers is detected before any response is sent and surfaces as a clean
  `REASONING_UPSTREAM_FAILED` 5xx envelope, never a partial 200. `usage`
  accounting is preserved (reconstructed from the terminal SSE usage chunk).

## [1.2.5] - 2026-06-06

### Removed

- Server-side speaker diarization (`POST /v1/audio/diarization`) and all of its
  supporting code: the pyannote.ai async-orchestration client, the diarization
  idempotency cache, the diarization config resolver, and the
  `DiarizationResponse` wire schema. Diarization is client-local — the desktop
  performs speaker splitting offline and no client flow called the server route,
  so the endpoint had no consumer. The `PYANNOTE_*`, `SPEACHES_DIARIZATION_*`,
  and `MOCK_DIARIZATION` environment variables are dropped from the compose
  files, Helm chart, and `.env` examples.
- Dead `pyannote` provider plumbing from the LiteLLM client (provider-key
  mapping, known-provider prefix) and the now-orphaned `PYANNOTE_API_KEY` /
  `SPEACHES_DIARIZATION_API_KEY` log-redaction entries.

## [1.2.4] - 2026-06-05

### Fixed

- `/api/agent/stream` now normalizes the forwarded chat messages to exactly one
  system message at index 0, merging an optional `systemPrompt` and any in-array
  system messages into a single deduplicated block while preserving the order of
  all non-system messages. Previously a client that sent both `messages[0]` as a
  system message and a byte-identical `systemPrompt` produced two leading system
  messages, which strict gateway chat templates reject with HTTP 400.

## [1.2.3] - 2026-06-05

### Added

- Web download links on the login and post-login screens.
- `/api/embeddings` and `/api/rerank` operator-gateway passthrough endpoints,
  with `features.embeddings` / `features.rerank` capability flags.
- End-user email header on the diarization gateway branch.

## [1.2.2] - 2026-06-04

### Added

- End-user email forwarding to the operator gateway, configurable via
  `LITELLM_USER_HEADER_NAME`.
- `REALTIME_FORCE_TRANSCRIPTION_MODEL` realtime force-override.

### Changed

- Expanded operator documentation for the gateway and realtime overrides.

## [1.2.1] - 2026-06-04

### Changed

- Reason routing now treats an explicit `requestKind` body field as the primary
  router signal, with a weakened cleanup fallback for older clients that send no
  `requestKind`.

### Fixed

- Cleanup dictation made while an agent is configured now routes to the cleanup
  model with thinking disabled, closing a live cleanup-routing regression.
- Compose now projects `OPENWHISPR_DISABLE_LOCAL_LOGIN` into the API environment.
- Web auth screens are gated on `localLogin.enabled`.

## [1.2.0] - 2026-06-03

### Added

- Server-configurable disable-local-login, surfaced through
  `GET /api/auth/providers` as a `localLogin.enabled` capability field.

### Changed

- Operator-gateway boot guard now accepts a virtual key on the corporate-override
  path.
- `app.tenant_id` rolconfig is bound on a renamed managed application role.
- Desktop sign-in resolves the authorize URL from OIDC discovery.

## [1.1.0] - 2026-06-03

### Changed

- Realigned the chart version, appVersion, and image tag to a single shared
  number so `helm list` and `/api/health` report the same version.

### Fixed

- Fresh `migrate` now succeeds under a single non-bypass role: migrate-pool
  session options set the bypass and tenant context, and the base RLS policies
  are bypass-aware at creation.
- Web SSO now requests the `openid`/`email`/`profile` scopes (plus a just-in-time
  group), so the identity provider returns an id_token and web sign-in completes.

## [1.0.20] - 2026-06-02

### Fixed

- Managed-Postgres deploy compatibility: the worker boots without a separate
  gateway database URL, audit-log partitioning auto-detects its extension with a
  disable switch, and a claim-driven bypass path supports a single non-bypass
  application role.

## [1.0.19] - 2026-06-01

### Fixed

- Diarization requests to the speech backend now send an `Authorization` bearer,
  resolved from an optional override that falls back to the gateway key, fixing
  corporate-gateway 401s.

## [1.0.18] - 2026-05-31

### Added

- Public `/download` page.

### Fixed

- Dead-link and version-badge fixes; the web version badge now reflects the
  shipped tag via a build-time public version argument.

## [1.0.17] - 2026-05-31

### Changed

- Release images are now built on native per-architecture runners instead of a
  single emulated multi-arch build, eliminating the cold-cache arm64 stall while
  keeping both amd64 and arm64 coverage.

## [1.0.16] - 2026-05-30

### Added

- Server build shipping OIDC SSO just-in-time provisioning with a live identity
  provider end-to-end test.

## [1.0.15] - 2026-05-28

### Fixed

- Streaming now emits content chunks before surfacing an error.

## [1.0.14] - 2026-05-28

### Changed

- Pre-push test-evidence gate validates the tip commit only, keeping it
  compatible with the test-driven workflow.

[Unreleased]: https://github.com/Yambr/openwhispr-server/compare/v1.2.9...HEAD
[1.2.11]: https://github.com/Yambr/openwhispr-server/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/Yambr/openwhispr-server/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/Yambr/openwhispr-server/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/Yambr/openwhispr-server/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/Yambr/openwhispr-server/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/Yambr/openwhispr-server/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/Yambr/openwhispr-server/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/Yambr/openwhispr-server/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/Yambr/openwhispr-server/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/Yambr/openwhispr-server/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Yambr/openwhispr-server/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Yambr/openwhispr-server/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Yambr/openwhispr-server/compare/v1.0.20...v1.1.0
[1.0.20]: https://github.com/Yambr/openwhispr-server/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/Yambr/openwhispr-server/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/Yambr/openwhispr-server/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/Yambr/openwhispr-server/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/Yambr/openwhispr-server/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/Yambr/openwhispr-server/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/Yambr/openwhispr-server/releases/tag/v1.0.14
