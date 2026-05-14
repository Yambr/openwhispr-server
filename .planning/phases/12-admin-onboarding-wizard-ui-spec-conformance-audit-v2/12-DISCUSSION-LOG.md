# Phase 12 Discussion Log

**Date:** 2026-05-14
**Mode:** advisor (4 parallel `gsd-advisor-researcher` agents)
**Outcome:** All 4 advisor recommendations LOCKED into CONTEXT.md without modification.

## Discussion Flow

User invoked `/gsd-discuss-phase 12`. Phase 12 requirements were already LOCKED by `.planning/REQUIREMENTS.md` (ADMIN-01..06 + UICONF-01..07, 13 line items). Discussion focused on HOW-to-implement gray areas only — WHAT to build was already fixed.

### Areas Selected for Discussion

User multi-selected 4 of 4 surfaced gray areas + requested "full advisor cycle, all stages, no skips":

1. ✅ setup_state state machine
2. ✅ /api/capabilities endpoint shape
3. ✅ Wizard form UX
4. ✅ UI-SPEC conformance test approach

### Area 1: setup_state storage

**Agent:** gsd-advisor-researcher (id: a98eaff7664025269)

**Options presented:**
- **A) Singleton `setup_state` table** (new table, `id SMALLINT CHECK (id=1)`, enum status)
- **B) Column on existing tenancy table** (would be `tenants` since no `workspaces` exists)
- **C) Redis/Valkey `SET … NX`** (zero migration, ephemeral)

**Recommendation:** A — Singleton table.

**Key finding:** Tenancy root in the schema is `tenants` (NOT `workspaces` as the question initially assumed). `setup_state` is operator-global; semantically wrong to colonize a per-tenant table.

**User decision:** Locked Option A → D-01..D-05.

### Area 2: /api/capabilities shape

**Agent:** gsd-advisor-researcher (id: a501813b344e86b0c)

**Options presented:**
- **A) Minimal `/api/auth/providers`** (auth-only, public)
- **B) Broad `/api/capabilities`** (single union endpoint, public)
- **C) Split — public `/api/auth/providers` + authed `/api/capabilities`**

**Recommendation:** C — Split.

**Key finding:** `BACKEND_SPEC.md` is NOT present in the tree; neither path is reserved. The repo already follows "conditionally register when env is present" pattern in `apps/api/src/routes/index.ts:119-152, 343-404`. Provider derivation lives in `apps/api/src/auth.ts:109-122` — zero-drift source.

**User decision:** Locked Option C → D-06..D-10.

### Area 3: Wizard form UX

**Agent:** gsd-advisor-researcher (id: abd2ad426f8564817)

**Options presented:**
- **A) True multi-step wizard (3-4 steps)** — separate sub-schemas, back/next state
- **B) Single-page form + shadcn-stepper visual progress** — one Zod schema, one submit
- **C) Single-page form, no Stepper** — violates ADMIN-02 wording

**Recommendation:** B — Single-page + Stepper progress.

**Sub-decisions:**
- Timezone picker: native `Intl.supportedValuesOf('timeZone')` (no dependency).
- Password strength meter: NONE (Zod policy is sufficient).

**Key finding:** shadcn/ui has NO official Stepper primitive (confirmed via shadcn-ui/ui discussion #1422); must vendor a community port. `design-canvas.jsx` onboarding section is stubbed (`…` placeholder) — gives no contradiction.

**User decision:** Locked Option B → D-11..D-17.

### Area 4: UI-SPEC conformance tests

**Agent:** gsd-advisor-researcher (id: ae61208f284873cf4)

**Options presented:**
- **A) Standalone Playwright at `tests/conformance/ui-spec/`** — slow, no coverage credit
- **B) Vitest + RTL conformance** — fast, fails UICONF-05 honestly (happy-dom)
- **C) Hybrid — Vitest+RTL structural + Playwright `@axe-core/playwright` a11y**

**Recommendation:** C — Hybrid.

**Key finding:** `design-canvas.jsx` is a Figma-canvas host (1437 LOC; `DC = bg/grid/postit wrapper`), STATIC oracle, NOT mountable production component. `@axe-core/playwright@4.11.2` already in `apps/web` devDeps (Phase 13 landed it). happy-dom cannot honestly evaluate contrast/focus-visible/landmark-unique rules → axe lane needs real Chromium.

**User decision:** Locked Option C → D-18..D-23.

## Cross-cutting locks carried forward

From Phase 13 (`13-CONTEXT.md`) + PROJECT.md:
- Strict TDD ≥ 90/90/90/90
- English-only sources
- No retry-on-flake in CI (Phase 13 D-12)
- No mocks of internal logic
- Each fix lands with tests in same atomic commit

## Scope creep redirected

None during this discussion. User stayed inside the 4 selected gray areas.

## Deferred ideas

- `/api/capabilities` BYOK/SLIM payload — Phase 14
- Password strength meter — revisit if UX requirement lands
- Multi-step wizard variant — refactor opportunity if onboarding UX surfaces friction
- `design-canvas.jsx` runnable conformance — future visual-regression phase
- "Resend verification" email-template copy review — Phase 18 i18n pass

## Next step

`/gsd-plan-phase 12`
