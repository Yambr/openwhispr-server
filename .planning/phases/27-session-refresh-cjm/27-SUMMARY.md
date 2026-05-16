# Phase 27 — SUMMARY (closed 2026-05-16)

**Status:** CLOSED with partial-RED. ROADMAP "Phase 27: G7 session refresh / set-auth-token CJM" met for the happy path; negative twin parked behind `@expected-red @after-phase-28-SESSION-EXPIRY` pending a session-expiry helper.

## What landed

| Artefact | Description |
|---|---|
| `tests/e2e-cjm/features/session-refresh.feature` | `@cjm-14.1` (happy — set-auth-token emitted with fresh non-empty bearer) + `@cjm-14.2 @expected-red @after-phase-28-SESSION-EXPIRY` (negative — expired session → 401 + cleared cookie, no set-auth-token) |
| `tests/e2e-cjm/steps/session-refresh.steps.ts` | Steps + exported helpers `authenticatedGet`, `extractInboundToken`, `isSessionCookieCleared` |
| `tests/e2e-cjm/steps/__tests__/session-refresh.steps.test.ts` | 14 vitest cases covering both cookie helpers + call shape + invariants |
| `docs/customer-journeys.md` | "## 14. Session refresh — set-auth-token rotation" section |

## Known follow-up

The negative twin (`@cjm-14.2`) needs a `tools/expire-session.ts` helper that pokes the DB to age a session record so the api treats it as expired. Filed as the implicit Phase 28-SESSION-EXPIRY target referenced by the `@after-phase-28-SESSION-EXPIRY` tag.

Phase 21 lockers: 18 features / 28 anchors / 16 step files / 8 unit tests / 10 allowlist → PASS.

```
status: CLOSED (partial-RED — negative twin parked behind future helper)
scenarios_added: 2 (1 GREEN, 1 RED)
unit_tests_added: 14
```
