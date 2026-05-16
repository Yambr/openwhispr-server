# Phase 25 — SUMMARY (closed 2026-05-16)

**Status:** CLOSED. ROADMAP "Phase 25: G5 agent-stream NDJSON CJM" met.

## What landed

| Artefact | Description |
|---|---|
| `tests/e2e-cjm/features/agent-stream.feature` | `@cjm-12.1` (happy NDJSON sequence) + `@cjm-12.2` (negative twin, 401 before hijack) |
| `tests/e2e-cjm/steps/agent-stream.steps.ts` | Step bindings + exported `postAgentStream` + `parseNdjson` helpers |
| `tests/e2e-cjm/steps/__tests__/agent-stream.steps.test.ts` | 10 vitest cases covering parseNdjson edge cases + http-probe call shape |
| `docs/customer-journeys.md` | New "## 12. Agent stream — NDJSON wire shape" section |

## Phase 21 locker conformance

- `lint-gherkin-tags`: 16 / 24 anchors → PASS
- `lint-steps-have-unit-tests`: 14 step files / 6 unit tests / 10 allowlist → PASS
- `lint-cjm-doc`: anchors in sync

10/10 vitest GREEN. Phase 4 / Phase 08.2 already shipped the production code (sse-parser.ts + chatCompletionsStream); this phase is coverage closure, no production change.

## Phase status

```
status: CLOSED
closed: 2026-05-16
scenarios_added: 2 (@cjm-12.1, @cjm-12.2)
unit_tests_added: 10
allowlist_change: none
```
