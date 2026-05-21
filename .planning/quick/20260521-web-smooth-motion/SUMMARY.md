---
slug: web-smooth-motion
date: 2026-05-21
status: complete
commit: edab550c,9c7e3e5e
branch: chore/web-smooth-motion
---

# apps/web smooth motion — SUMMARY

## Outcome

The web frontend now has restrained, fast motion (150-250ms, ease-out,
no bounce) — page transitions cross-fade, content fades in, interactions
respond smoothly. Zero new npm dependencies; `prefers-reduced-motion`
fully respected.

## Commit

`edab550c` on `chore/web-smooth-motion`, atomic — 10 files, all under
`apps/web/`, no `package.json` dependency change.

## What changed

- **`globals.css`** — `@theme` Motion section extended:
  `--duration-fast/base/slow` (150/200/250ms), `--ease-out`
  (`cubic-bezier(0.16,1,0.3,1)`), `--ease-in-out`. `@keyframes`
  `fade-in`, `fade-in-up` (opacity + 6px), `fade-in-scale`
  (opacity + 0.98→1). `.motion-fade-in*` utilities. A
  `prefers-reduced-motion: reduce` block neutralizing everything.
- **`next.config.ts`** — `experimental: { viewTransition: true }`;
  `::view-transition-old/new(root)` cross-fade (~200ms) in `globals.css`.
- **`fade-in.tsx`** (new) — `FadeIn` component with a 10-item-capped
  stagger helper.
- **Lists** — staggered `fade-in-up` on rows of `NotesListClient`,
  `TranscriptionsListClient`, `ConversationsListClient` (28ms step,
  capped at 10) + empty-state cards.
- **Usage dashboard** — 4 KPI cards stagger in.
- **Interactions** — `button.tsx` fast token + `active:scale-[0.98]`
  press; `card.tsx` `hover:shadow-md` lift; `input.tsx` focus transition.

## Verification (independently re-run)

- `pnpm --filter @openwhispr/web build` — succeeds, all 24 routes.
- `pnpm --filter @openwhispr/web test` — 73 files / 1036 tests pass.
- Lint at baseline (14 warnings / 0 errors, pre-existing).
- Motion is opacity + transform only (no layout shift); reduced-motion
  block confirmed present.

## Follow-up fix (9c7e3e5e)

Live browser testing caught that the `experimental.viewTransition`
config flag alone does NOT trigger `startViewTransition` on App Router
navigations (`vtCount: 0` after a route change). Fixed by adding a
client `RouteTransition` wrapper (`components/ui/route-transition.tsx`)
in the root layout — it calls `document.startViewTransition` on
pathname change (guards `startViewTransition` availability +
`prefers-reduced-motion`, skips first mount). Unused config flag removed.

## Live verification (browser, rebuilt web container)

- Route navigation `/sign-in ↔ /sign-up` — `startViewTransition` fires
  every time (`vtCount` 0→1→2). Cross-fade genuinely works.
- Motion tokens resolve live: `--duration-fast .15s`, `--ease-out
  cubic-bezier(.16,1,.3,1)`; button transition `0.15s` ease-out;
  `.motion-fade-in-up` → `fade-in-up` keyframe.
- `pnpm --filter @openwhispr/web build` succeeds; 74 files / 1040 tests
  pass; pages render clean.
