---
slug: web-smooth-motion
date: 2026-05-21
status: planned
branch: chore/web-smooth-motion
---

# apps/web — smooth, polished motion (eliminate the jerky feel)

## Goal

The web frontend feels abrupt — instant page swaps, content popping in,
flat interactions. Add **restrained, fast** motion (150-250ms, ease-out,
no bounce) so it feels smooth without slowing the user down. Zero new
npm dependencies — CSS + Tailwind 4 + the browser View Transitions API.
`prefers-reduced-motion` fully respected.

## Tech constraints

- Next.js 15 App Router + React 19 + Tailwind 4 + shadcn/ui.
- NO new dependencies (no framer-motion). CSS/Tailwind only.
- Design tokens live in `apps/web/src/app/globals.css` `@theme` block —
  it already has a `Motion` section (`--duration-progress`,
  `--duration-skeleton`). Extend it; do not invent a parallel system.
- All motion gated behind `motion-safe:` / wrapped so
  `@media (prefers-reduced-motion: reduce)` disables it.

## Scope — four areas

### 1. Motion design tokens (`globals.css` `@theme` Motion section)

Add canonical tokens so every animation references one source:
- durations: `--duration-fast: 150ms`, `--duration-base: 200ms`,
  `--duration-slow: 250ms` (keep existing progress/skeleton).
- easing: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (restrained,
  decelerating — no overshoot), `--ease-in-out` for symmetric moves.
- Add `@keyframes` for `fade-in`, `fade-in-up` (opacity + 6px translateY),
  `fade-in-scale` (opacity + 0.98→1 scale) in `globals.css`.
- A `@media (prefers-reduced-motion: reduce)` block that neutralizes
  every animation/transition (duration → 0.01ms, no transform).

### 2. Page transitions — View Transitions API

- Enable Next.js App Router view transitions. Next 15 supports the
  experimental `viewTransition` flag in `next.config.ts`
  (`experimental: { viewTransition: true }`) OR the
  `unstable_ViewTransition` component. Use the **config flag** route if
  stable enough in the installed Next version; otherwise wrap route
  content. Verify the installed Next version's support first — if the
  flag is not available, fall back to a CSS-only route-change fade on a
  client wrapper in the route-group layouts (`(auth)/layout.tsx`,
  `(public)/layout.tsx`, `(admin)/layout.tsx`).
- Define the `::view-transition-old/new` cross-fade in `globals.css`
  (short, ~200ms, ease-out). Respect reduced-motion.

### 3. Content entrance

- A small reusable utility class set (`.motion-fade-in`,
  `.motion-fade-in-up`) and/or a tiny `FadeIn` client component in
  `apps/web/src/components/ui/` that applies the entrance animation on
  mount. NO new dep — pure CSS animation triggered by a mount class.
- Apply to: notes list rows (`NotesListClient.tsx`), transcriptions
  list, conversations list, cards, stat panels, page headers. For
  lists, a **staggered** delay (CSS `animation-delay` via an index —
  e.g. `style={{ animationDelay: ... }}` capped so a 100-row list does
  not delay 5s; cap stagger at ~8-10 items then 0).
- No layout shift: entrance is opacity + small translate only, never
  height/width.

### 4. Interactive + loading states

- Buttons/inputs/cards: ensure `transition-colors` /
  `transition-[transform,box-shadow,background-color]` with
  `--duration-fast` on hover/active/focus. shadcn `button.tsx` already
  has `transition-all` — tune duration/easing via the token, add a
  subtle `active:` press (e.g. `active:scale-[0.98]` motion-safe).
- Cards: soft shadow lift on hover (`hover:shadow-md` + transition).
- Loading→content: skeletons already have `--duration-skeleton`. Make
  the skeleton→data swap a cross-fade (the new content fades in via
  `.motion-fade-in`). Ensure skeletons match final layout dimensions so
  there is no jump.

## Antipatterns to avoid

- ❌ Adding framer-motion / any npm dep.
- ❌ Animating layout properties (height/width/top) — only opacity +
  transform (compositor-friendly, no reflow).
- ❌ Long durations (>300ms) or bounce/spring — the user explicitly
  wants restrained & fast.
- ❌ Motion that ignores `prefers-reduced-motion`.
- ❌ A parallel motion-token system — extend the `@theme` Motion block.
- ❌ Unbounded stagger delay on long lists.

## Verification

- `pnpm --filter @openwhispr/web build` succeeds; `pnpm --filter
  @openwhispr/web lint` clean.
- Existing web tests (`vitest`) stay green.
- Manual: run the web app, confirm — route changes cross-fade; notes/
  transcriptions lists fade in (staggered, not all-at-once, not
  laggy); buttons/cards respond smoothly on hover/press; no layout
  shift on load; `prefers-reduced-motion: reduce` (OS setting) disables
  all of it.
- If a Playwright suite exists for web, it stays green.
