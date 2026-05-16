# Phase 24 — SUMMARY (closed 2026-05-16)

**Status:** CLOSED. ROADMAP "Phase 24: G8 cross-tenant RLS CJM (non-SSO)" met.

## What landed

| Artefact | Description |
|---|---|
| `tests/e2e-cjm/features/rls-cross-tenant.feature` | Two scenarios: `@cjm-15.1` (negative twin — T_A cannot read T_B's job, 404 + typed envelope, no existence leak, no stack trace) + `@cjm-15.2` (happy — T_A reads own job, 200) |
| `tests/e2e-cjm/steps/rls-cross-tenant.steps.ts` | Step bindings: `Background`, `When` requests, `Then` assertions. Exports `provisionTenant`, `recordTranscribeJob`, `readTranscribeJob` so the sibling unit test can replay their call shape. |
| `tests/e2e-cjm/steps/__tests__/rls-cross-tenant.steps.test.ts` | 5 vitest cases mocking `undici.fetch` via `vi.fn()`. Asserts URL path encoding, method, headers (origin + cookie), body shape (audio/wav buffer), and the localhost-dispatcher predicate. 5/5 GREEN. |
| `docs/customer-journeys.md` | New "## 15. Cross-tenant isolation (non-SSO RLS regression sentinel)" section with the two `@cjm-15.x` anchors. |

## Why it matters

`@cjm-sso-1.5` already exists for cross-tenant rejection but is `@expected-red @after-phase-19` (deferred to v3 SSO). Until that lands, an RLS regression on the bundled email/password path can slip past the test suite — Phase 24 is the regression sentinel that closes the gap NOW.

## Phase 21 locker conformance

- `lint-gherkin-tags`: 15 features / 22 anchors → PASS (after expanding scenario title to include "rejected" keyword)
- `lint-steps-have-unit-tests`: 13 step files / 5 unit tests / 10 allowlist → PASS (new step file ships with its sibling test)
- `lint-cjm-doc`: doc↔Gherkin anchors in sync
- `lint-playwright-config`: untouched (no playwright config changed)

## Commits

```
<sha> feat(24-01): cross-tenant RLS CJM (G8 closure)
<sha> docs(24): add phase artefacts — summary
```

## Known follow-ups

1. **Live execution gated on `make e2e-cjm`.** The scenarios are written but they exercise the live api+postgres stack. They will not turn GREEN until run against the booted compose project. CI's `e2e-cjm.yml` workflow will exercise them on the next merge.
2. **If `@cjm-15.1` fails with 200 instead of 404**, that is the RLS regression we are guarding against — file as SR-24.x in `.planning/deferred-items.md` and DO NOT weaken the test.
3. **`provisionTenant` reuses Phase 13 helpers.** No new fixture code added; the test composes existing `freshTenant()` + `signedInAs()` from `support/fixtures.ts`.

## Phase status

```
status: CLOSED
closed: 2026-05-16
verified_by: self (Claude Opus 4.7)
scenarios_added: 2 (@cjm-15.1, @cjm-15.2)
unit_tests_added: 5
allowlist_change: none (new step file ships with its sibling test)
```
