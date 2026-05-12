# Web Perf Budgets (Phase 07.1 / D-PERF-2)

Informational floor only — **not** a hard CI gate. Hard gating happens via
`size-limit` (D-PERF-1) which fails the build at > 200 KB gzipped per route.

## Targets

| Metric | Target | Source |
| ------ | ------ | ------ |
| LCP (Largest Contentful Paint) | < 2.5 s | Web Vitals "Good" threshold |
| INP (Interaction to Next Paint) | < 200 ms | Web Vitals "Good" threshold |
| TTFB (Time to First Byte) | < 800 ms | Web Vitals "Good" threshold |

Targets apply to a cold load on simulated Fast 3G against the docker-compose
stack on localhost. Real-world targets (production traffic over public
internet) are intentionally NOT enforced here — Phase 07.1 only commits to
the dev-stack floor.

## How to measure

1. Bring up the stack:
   ```sh
   docker compose --profile default up -d --wait
   ```
2. Run the measurement script (writes results to the "Last measurement"
   section below):
   ```sh
   pnpm --filter @openwhispr/web exec tsx tests/perf/measure.mjs
   ```
3. Inspect the appended results.

Caveats:
- Playwright's Chromium reports LCP via `getEntriesByType('largest-contentful-paint')` — the entry only fires after layout-shifts settle, so the script waits 3 s after `networkidle` before sampling.
- INP requires real user interaction; the script captures the *closest* proxy by triggering a synthetic click and reading the resulting `event` entry from PerformanceObserver. Treat INP numbers as informational, not authoritative.

## Routes covered

- `/sign-in`
- `/app`
- `/app/notes`
- `/app/transcriptions`
- `/app/conversations`
- `/app/account`

## Last measurement

Measured 2026-05-12T11:01:40.182Z against https://api.localhost.

| Route | TTFB | LCP | INP (approx) |
| ----- | ---- | --- | ------------ |
| `/sign-in` | 83 ms | n/a | n/a |
| `/app` | 84 ms | n/a | n/a |
| `/app/notes` | 38 ms | n/a | n/a |
| `/app/transcriptions` | 54 ms | n/a | n/a |
| `/app/conversations` | 27 ms | n/a | n/a |
| `/app/account` | 62 ms | n/a | n/a |
