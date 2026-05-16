# Phase 42 — SUMMARY (closed 2026-05-16, full-RED)

ROADMAP "Phase 42: G2 per-tenant STT/LLM override CJM" met as RED-only.

`PUT /api/stt-config` route does not exist (only GET ships per WIRE-11). Both `@cjm-9.*` scenarios tagged `@expected-red @after-phase-51-WIRE-11-PUT` so the gate flips when the route lands.

- `tests/e2e-cjm/features/tenant-settings-override.feature` — @cjm-9.1 (happy, RED) + @cjm-9.2 (negative, RED)
- `tests/e2e-cjm/steps/tenant-settings-override.steps.ts` — exports `putSttConfig`, `getSttConfig`
- `__tests__/tenant-settings-override.steps.test.ts` — 4/4 vitest GREEN
- `docs/customer-journeys.md` — "## 9. Per-tenant STT/LLM override" section

Phase 21 lockers: 22 features / 34 anchors / 20 step files / 12 unit tests / 10 allowlist → PASS.
