# Phase 28 — SUMMARY (closed 2026-05-16)

ROADMAP "Phase 28: G3 diarization round-trip CJM" met.

## What landed

- `tests/e2e-cjm/features/diarization.feature` — `@cjm-10.1 @after-docker-up @after-speaches-main` (wav round-trip → `{duration, segments[]}`) + `@cjm-10.2` (text/plain → 415 typed envelope)
- `tests/e2e-cjm/steps/diarization.steps.ts` — exports `postDiarizationMultipart`, `postDiarizationTextPlain`, `isDiarizationBody`
- `tests/e2e-cjm/steps/__tests__/diarization.steps.test.ts` — 9/9 vitest GREEN
- `docs/customer-journeys.md` — "## 10. Diarization — multi-speaker round-trip" section

Multi-speaker assertion (≥2 distinct labels) deferred until a 2-speaker fixture lands; single-speaker round-trip is sufficient to prove the wire shape end-to-end against the live Speaches main-branch upstream (Phase 08.6).

Phase 21 lockers: 19 features / 30 anchors / 17 step files / 9 unit tests / 10 allowlist → PASS.
