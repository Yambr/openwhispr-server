# Phase 43 — SUMMARY (closed 2026-05-16, full-RED)

ROADMAP "Phase 43: G9 corporate LITELLM_BASE_URL override CJM" met as RED-only.

Both scenarios tagged `@expected-red @after-phase-44-MOCK-CORP-LITELLM` until a second mock-litellm container at a different port lands in compose overlays (so the api can boot with the env override pointing at it).

- `tests/e2e-cjm/features/byok-corporate-litellm.feature` — @cjm-byok-litellm.1 (happy, RED) + @cjm-byok-litellm.2 (negative twin, RED)
- `tests/e2e-cjm/steps/byok-corporate-litellm.steps.ts` — exports `postTranscribeWav`
- `__tests__/byok-corporate-litellm.steps.test.ts` — 4/4 vitest GREEN
- `docs/customer-journeys.md` — "## byok-litellm. Corporate LITELLM_BASE_URL override" section

Phase 21 lockers: 23 features / 34 anchors / 21 step files / 13 unit tests / 10 allowlist → PASS.
