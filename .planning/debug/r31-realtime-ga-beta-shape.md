---
status: awaiting_human_verify
trigger: "R31 (client-filed blocker, reopened TWICE) — OpenAI Realtime via WSS /v1/realtime reverse-proxy fails with invalid_request_error.beta_api_shape_disabled in-band WS error event; transcription_session.created never arrives; WS closes 4000."
created: 2026-05-22T10:46:59Z
updated: 2026-05-22T11:10:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "OpenAI rejects with beta_api_shape_disabled because LiteLLM's litellm->OpenAI leg sends BOTH (a) ?intent=transcription query param and (b) a hardcoded OpenAI-Beta: realtime=v1 header. Our f41d29e2 header-strip was on the wrong leg (client->Fastify); LiteLLM regenerates the Beta header in OpenAIRealtime._get_additional_headers regardless. ?intent= is a Beta-only param; in GA the same URL with no intent + a session.update{type:transcription} frame is used."
  confirming_evidence:
    - "litellm OpenAIRealtime._get_additional_headers (handler.py) returns {'Authorization':..., 'OpenAI-Beta': 'realtime=v1'} HARDCODED — litellm always sends the Beta header to OpenAI"
    - "litellm OpenAIRealtime._construct_url does url.copy_with(params=query_params) — forwards all query params incl. intent verbatim"
    - "litellm realtime_websocket_endpoint reads intent as explicit fastapi.Query and builds query_params={'model':..,'intent':..} via _realtime_query_params_template"
    - "OpenAI 2026 GA docs: ?intent= is Beta-only, removed in GA; GA emits session.created (not transcription_session.created); GA uses session.update{type:transcription}; OpenAI-Beta header must be removed for GA"
    - "Our realtime.ts preHandler only .set()s ?user and ?model; ?intent passes through untouched"
  falsification_test: "If we strip ?intent= AND suppress the OpenAI-Beta header on the litellm->OpenAI leg, OpenAI should emit session.created and NOT beta_api_shape_disabled."
  fix_rationale: "Two server-side levers: (1) strip ?intent= in our Fastify preHandler so litellm never sees it -> query_params has no intent -> clean GA URL. (2) The OpenAI-Beta header is INSIDE litellm and we cannot strip it from our proxy — needs litellm config (litellm_settings or model api-base override) OR a litellm version/patch. Investigate whether litellm 1.83.14 has a knob."
  blind_spots: "Even with clean GA URL + no Beta header, the EVENT VOCABULARY gap remains: preconfigured client waits for transcription_session.created which GA never emits. That is an in-band frame problem a transparent passthrough cannot solve — may need checkpoint."

hypothesis: Strip ?intent= alone is insufficient — litellm hardcodes OpenAI-Beta header on its OWN leg to OpenAI
test: Inspect litellm 1.83.14 for a config knob to disable the OpenAI-Beta header; verify event vocabulary gap
expecting: Either a litellm config override OR confirmation that frame-aware proxy / litellm patch is required
next_action: Check litellm version + whether _get_additional_headers can be overridden via config/model params

## Symptoms

expected: Desktop client opens WS to ws://localhost:4000/v1/realtime?intent=transcription, proxy forwards to OpenAI, OpenAI emits transcription_session.created (or GA equivalent), transcription session works.
actual: WS upgrade succeeds (HTTP 101). OpenAI then sends in-band error event invalid_request_error.beta_api_shape_disabled ("The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API."). transcription_session.created never arrives. WS closes with code 4000.
errors: |
  litellm: WebSocket /v1/realtime?intent=transcription&user=...&model=realtime-default [accepted]
  LiteLLM:ERROR realtime_streaming.py:548 - Connection closed in backend to client send messages - received 4000 (private use) invalid_request_error.beta_api_shape_disabled
reproduction: Desktop client (immutable) opens WS to ws://localhost:4000/v1/realtime?intent=transcription against running docker compose stack.
started: After commit f41d29e2 stripped OpenAI-Beta header — that fixed the earlier 1011 close, but beta_api_shape_disabled in-band error persists.

## Eliminated

- hypothesis: The OpenAI-Beta: realtime=v1 HTTP header is the cause of beta semantics reaching OpenAI.
  evidence: Commit f41d29e2 already strips that header in buildRewriteRequestHeaders; the 1011 close went away but beta_api_shape_disabled still arrives in-band. So beta semantics reach OpenAI via a SECOND channel.
  timestamp: 2026-05-22T10:46:59Z (known-prior, carried into session)

## Evidence

- timestamp: 2026-05-22T10:46:59Z
  checked: Prior knowledge supplied with the bug report.
  found: f41d29e2 stripped OpenAI-Beta header (fixed 1011). URL carries ?intent=transcription (a Beta query param). Preconfigured client waits for transcription_session.created (Beta vocab); GA emits session.* not transcription_session.*.
  implication: Two candidate channels for Beta semantics — (a) ?intent= URL param, (b) event vocabulary gap that a transparent passthrough cannot bridge.

- timestamp: 2026-05-22T10:55:00Z
  checked: apps/api/src/routes/realtime.ts preHandler.
  found: preHandler only u.searchParams.set("user",...) and .set("model",...). ?intent passes through verbatim. Proxy is @fastify/http-proxy wsUpstream — transparent WS passthrough, payload-opaque by design (T-03-07). It cannot translate in-band WS frames.
  implication: DEFECT 1 (?intent forwarding) is fixable in our preHandler. In-band frame translation (DEFECT 3) is NOT possible with current proxy architecture.

- timestamp: 2026-05-22T10:58:00Z
  checked: litellm 1.83.14 inside openwhispr-litellm-1 — llms/openai/realtime/handler.py, realtime_api/main.py, proxy/proxy_server.py:8253.
  found: |
    (a) realtime_websocket_endpoint reads `intent` as explicit fastapi.Query; builds query_params={"model":..,"intent":..}.
    (b) OpenAIRealtime._construct_url does url.copy_with(params=query_params) -> forwards ?intent verbatim to wss://api.openai.com/v1/realtime.
    (c) OpenAIRealtime._get_additional_headers() HARDCODES {"Authorization":..,"OpenAI-Beta":"realtime=v1"}.
    (d) _arealtime dispatcher `elif _custom_llm_provider=="openai"` calls openai_realtime.async_realtime() which IGNORES kwargs headers/extra_headers — no path to override headers.
    (e) XAIRealtime subclass overrides _get_additional_headers to drop the Beta header; Azure has LITELLM_AZURE_REALTIME_PROTOCOL GA/beta switch — OpenAI provider has NEITHER.
  implication: DEFECT 2 — litellm always sends OpenAI-Beta:realtime=v1 to OpenAI for any openai/ realtime model. NOT fixable by litellm config or our Fastify proxy. f41d29e2's header strip on the client->Fastify leg was the WRONG leg — litellm regenerates the header.

- timestamp: 2026-05-22T11:00:00Z
  checked: compose/litellm/litellm_config.yaml.
  found: realtime-default model is `openai/gpt-realtime` mode:realtime -> provider "openai" -> always the hardcoded-Beta-header code path.
  implication: Confirms DEFECT 2 applies to the production bundled config.

- timestamp: 2026-05-22T11:03:00Z
  checked: litellm GitHub — search for GA switch / OpenAI-Beta removal for realtime.
  found: PR #18037 skips beta headers only for Vertex AI. No PR/issue removes the hardcoded OpenAI-Beta header for the OpenAI realtime WS provider. No GA switch exists in any litellm version.
  implication: DEFECT 2 cannot be resolved by a litellm version bump — needs a carried patch or a non-litellm mechanism.

- timestamp: 2026-05-22T11:06:00Z
  checked: tests/e2e/mock-realtime/server.ts + tests/e2e/realtime.e2e.test.ts.
  found: mock-realtime accepts ANY WS connection on /v1/realtime and unconditionally sends session.created — it never inspects the request URL query string or the OpenAI-Beta header. realtime.e2e.test.ts only asserts the auth gate (401 vs not-401).
  implication: This is exactly why R31 regressed twice — no test asserts GA-shape on the upstream leg. The mandatory regression test must make the mock upstream ASSERT (no ?intent=, no OpenAI-Beta header) and FAIL the connection if Beta shape is detected.

## Resolution

root_cause: |
  R31 has TWO independent server-side defects, BOTH on the litellm->OpenAI leg
  (not the client->Fastify leg that f41d29e2 touched):

  DEFECT 1 — ?intent=transcription forwarded verbatim to OpenAI.
    The immutable client opens ws://localhost:4000/v1/realtime?intent=transcription.
    Our Fastify preHandler (realtime.ts) only .set()s ?user and ?model — ?intent
    passes through. LiteLLM's realtime_websocket_endpoint (proxy_server.py:8253)
    reads `intent` as an explicit fastapi.Query and builds
    query_params={"model":..,"intent":"transcription"}. OpenAIRealtime._construct_url
    (llms/openai/realtime/handler.py) does url.copy_with(params=query_params),
    forwarding ?intent= verbatim to wss://api.openai.com/v1/realtime. ?intent is a
    Beta-only param removed in GA.

  DEFECT 2 — LiteLLM hardcodes the OpenAI-Beta: realtime=v1 header on its OWN leg.
    OpenAIRealtime._get_additional_headers() returns
    {"Authorization": ..., "OpenAI-Beta": "realtime=v1"} UNCONDITIONALLY. The
    _arealtime dispatcher (realtime_api/main.py, `elif _custom_llm_provider=="openai"`)
    calls openai_realtime.async_realtime() which IGNORES kwargs headers/extra_headers
    entirely — there is NO config knob, NO extra_headers path for the OpenAI realtime
    WS provider in litellm 1.83.14. (Contrast: XAIRealtime subclass overrides
    _get_additional_headers to drop it; Azure has LITELLM_AZURE_REALTIME_PROTOCOL
    GA/beta switch. OpenAI has neither.) Our model is `openai/gpt-realtime` ->
    provider "openai" -> always sends the Beta header.

  Either defect alone makes OpenAI route to the retired Beta API and emit
  invalid_request_error.beta_api_shape_disabled, closing 4000. f41d29e2 stripped
  the header from the desktop->Fastify request, but litellm REGENERATES it for the
  OpenAI connection — so f41d29e2 never affected the actual OpenAI leg. That is why
  R31 reopened twice on green unit tests: the header-strip unit test asserted the
  wrong leg.

  DEFECT 3 (event vocabulary) — even with a clean GA URL + no Beta header, the
  preconfigured client waits for `transcription_session.created` (Beta vocab) which
  GA never emits (GA emits `session.created`). A transparent payload-opaque
  passthrough (T-03-07) cannot bridge that. THIS REQUIRES AN ARCHITECTURAL DECISION
  — see checkpoint.

fix: |
  Defect 1 is fixable server-side in our proxy TODAY: strip ?intent= in the
  realtime.ts preHandler (u.searchParams.delete("intent")). That removes it before
  litellm ever sees it -> query_params has no intent -> clean GA URL.

  Defect 2 is NOT fixable in our Fastify proxy — the Beta header is generated INSIDE
  the litellm container. Options: (a) litellm config/version with a GA switch for
  OpenAI realtime (none exists in 1.83.14), (b) point the realtime-default model at
  a litellm-side patch / a custom api_base, (c) upgrade litellm to a version that
  drops the OpenAI-Beta header for GA, (d) carry a small litellm patch in our image.

  Defect 3 (transcription_session.* vs session.*) requires either a frame-aware
  proxy (breaks T-03-07 payload-opaque posture) or a litellm-side frame translation.

verification:
files_changed: []
