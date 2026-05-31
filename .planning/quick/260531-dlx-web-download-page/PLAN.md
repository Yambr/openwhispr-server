---
slug: 260531-dlx-web-download-page
created: 2026-05-31
status: in-progress
---

# Quick: Public /download page + dead-link & stale-version fixes (apps/web)

## Goal

Give unauthenticated visitors a public **/download** page that detects their OS and
links the right OpenWhispr desktop installer (from the `Yambr/openwhispr` GitHub
releases), and fix two stale/broken frontend references.

## Scope (3 atomic commits)

### Commit 1 — `lib/desktop-release.ts` pure logic + unit tests (RED→GREEN)
Pure, side-effect-free module (HTTP boundary injected, mocked in tests):
- `parseReleaseAssets(release, repoSlug)`: given a GitHub `releases/latest` JSON
  (or `null` on failure) + repo slug, return a normalized `{ version, assets:
  { mac_arm64, mac_x64, win_installer, win_portable, linux_appimage, linux_deb,
  linux_targz }, fallback }`. Ignores `.blockmap` / `.yml`. When `release` is
  `null`/missing assets, every URL falls back to the stable
  `github.com/Yambr/openwhispr/releases/latest/download/<name>` form so the page
  never renders a dead/blank button.
- `detectOs(userAgent)`: maps a UA string → `{ os: 'mac'|'windows'|'linux'|
  'unknown', arch: 'arm64'|'x64'|'unknown' }`. Apple Silicon detection: macOS UA
  has no reliable arch token, so default mac → arm64 (current shipping HW) but
  expose both in the full list.
- `primaryAssetFor(detection, parsed)`: pick the single best asset URL+label for
  the detected OS (mac→arm64 dmg, win→installer exe, linux→AppImage), or `null`
  when unknown (page then shows "choose your platform").
- Constant `OPENWHISPR_DESKTOP_REPO = 'Yambr/openwhispr'`.

Tests: `lib/__tests__/desktop-release.test.ts` — table-driven over the real
v1.7.16 asset names + UA fixtures (mac/win/linux/unknown), null-release fallback,
blockmap/yml exclusion.

### Commit 2 — `/download` page + client OS-detect component + i18n (RED→GREEN)
- `app/(public)/download/page.tsx`: async RSC. `fetch(GitHub latest, { next:
  { revalidate: 3600 } })` wrapped in try/catch → `parseReleaseAssets`. Reads UA
  from `headers()` for SSR primary-button pick. Renders via getServerI18n. Server
  picks primary from UA; a small `"use client"` `DownloadOsHint` re-detects via
  `navigator.userAgentData`/`platform` and adjusts the highlighted button on
  hydration (progressive enhancement — never required for the links to work).
- All copy via new `common.download.*` keys in en + ru `common.json`.
- Full platform list always rendered (every asset has a real href).
- Page is reachable unauthenticated: middleware only gates `/app/*`; `/download`
  is in `(public)` → no session check. (Verified: middleware matcher excludes it.)
- Tests: `app/(public)/download/__tests__/page.test.tsx` (render w/ mocked fetch +
  I18nProvider, assert primary button + all platform hrefs are non-empty real
  URLs) + `components/.../DownloadOsHint.test.tsx` for the client re-detect.
- E2E: `tests/e2e/u-download.spec.ts` — anonymous visit `/download` 200, primary
  CTA visible, every download link has an href (no `#`/empty), gated by E2E.

### Commit 3 — fix dead `/docs` link + stale `v1.0.4` version (RED→GREEN)
- `ConfigClient.tsx`: `DOCS_HREF` `/docs/litellm-target-spec.md` →
  `https://github.com/Yambr/openwhispr-server/blob/main/docs/litellm-target-spec.md`.
  Update/extend `ConfigClient.test.tsx` to assert the href is the GitHub blob URL
  (regression against the 404).
- `AuthShell.tsx`: replace hardcoded `v1.0.4` with
  `process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'` rendered as `v{version}`.
  Wire `NEXT_PUBLIC_APP_VERSION` in `next.config.ts` env + document in
  `apps/web/.env.example`. Extend `AuthShell.test.tsx` to assert it renders the
  env value (not a hardcoded literal).

## Constraints honored
- Strict TDD, tests + code in same commit, ≥90% diff coverage.
- Mock only the GitHub HTTP boundary; pure logic unmocked.
- English source, en+ru runtime i18n.
- No `as any`/`@ts-ignore`; no NODE_ENV branches; no hardcoded localhost/UUID.
- `/` stays a 307 → `/app`. Only `/download` added.
- No push/release — commits land locally on `quick/web-download-page-and-dead-links`.

## Verification
- `pnpm --filter @openwhispr/web test` for the three new/changed test files — read
  the "Test Files N passed" footer with own eyes.
- `pnpm --filter @openwhispr/web build` compiles.
- `git log --oneline -3` shows 3 atomic commits.
