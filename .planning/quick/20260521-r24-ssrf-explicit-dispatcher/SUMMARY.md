---
slug: r24-ssrf-explicit-dispatcher
date: 2026-05-22
status: complete
commit: 730bd892, 06d0812a, 35d87d84
---

# R24/R25/R26 — Cloud-plane SSRF 500 blocker — SUMMARY

## Outcome

Production BLOCKER resolved. Every Cloud-plane route (/api/transcribe,
/api/reason, /api/agent/*) returned 500 with SsrfDispatcherNotInstalledError.
Root cause: the SSRF marker is a non-enumerable own property of the boot
Agent; any post-boot setGlobalDispatcher() drops it, and the litellm-client
assertSsrfInstalled() gate then rejects the first LiteLLM call.

Fix (Option a): the LiteLLM client is bound at boot to an explicit
SSRF-wrapped dispatcher via the buildLitellmClient opts.request seam, so it
never consults the mutable process-global dispatcher.

## Commits

- 730bd892 R24 core — buildSsrfDispatcher single construction site;
  installGlobalSSRF returns the Dispatcher; makeSsrfBoundRequest helper;
  index.ts binds LiteLLM request; litellm-client seam JSDoc; allowlist drift.
- 06d0812a R25 — GET /api/ready route (SSRF-marker + litellm-client +
  upstream checks); compose api healthcheck /api/health -> /api/ready;
  boot fail-fast; allowlist drift.
- 35d87d84 R26 — tests/e2e/cloud-plane.e2e.test.ts containerised
  regression; deferred-items entry for pre-existing harness breakage.

## Tests run

- litellm-client: vitest run r24-injected-request-seam + index — 53 passed.
- apps/api: vitest run bootstrap/readiness/litellm-ssrf-request/probes — 41 passed.
- make lint:lockers — exit 0.
- tsc --noEmit — no new errors in touched files.

## Live verification (docker compose up -d --build api, curl :4000)

- GET /api/ready -> 200 {status:ready}, all three checks ok.
- POST /api/reason -> 200; POST /api/agent/stream -> 200 NDJSON.
- POST /api/transcribe -> 502 (mock LiteLLM does not honor mock_response
  on the audio passthrough; the 502 — not 500 — proves the SSRF-wrapped
  client fired end-to-end).
- api container healthy via the new /api/ready healthcheck.
- 0 SsrfDispatcherNotInstalledError occurrences in api logs.

## Pre-existing issues (not regressions, out of scope)

1. tests/e2e/compose-helper.ts references a seed service absent from the
   post-megafile-split bare docker-compose.yml; make e2e-hermetic
   globalSetup fails with "no such service: seed". Logged to
   deferred-items.md. cloud-plane.e2e.test.ts verified manually instead.
2. Pre-existing tsc errors in routes/index.ts + tokens/{assemblyai,deepgram}.ts.
3. packages/auth + packages/i18n missing vitest.setup.ts.
4. lint-prod-readiness 286 pre-existing LOCKER-04 dead-export WARN findings.

## Self-Check: PASSED

Files exist on disk; commits 730bd892/06d0812a/35d87d84 on HEAD; live
verification confirmed against the running container.
