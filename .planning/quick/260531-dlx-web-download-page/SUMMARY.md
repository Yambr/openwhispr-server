---
slug: 260531-dlx-web-download-page
date: 2026-05-31
status: complete
commits: [b4769d03, 0e38dc68, 89c13f98]
branch: quick/web-download-page-and-dead-links
---

# Summary — Public /download page + dead-link & stale-version fixes

## What shipped

A public, no-auth **/download** page for the web console, plus two stale/broken
frontend references fixed. Three atomic TDD commits on
`quick/web-download-page-and-dead-links` (NOT pushed — user handles release).

### Commit 1 — `b4769d03` desktop-release pure logic
`apps/web/src/lib/desktop-release.ts` (+ 19 unit tests under
`tests/unit/lib/__tests__/`):
- `parseReleaseAssets(release, repoSlug)` — GitHub `releases/latest` JSON →
  normalized per-platform installer URLs (mac arm64/x64 `.dmg`, win Setup/portable
  `.exe`, linux AppImage/`.deb`/`.tar.gz`). `.blockmap`/`.yml` metadata ignored.
  `null` release → fallback pointing every slot at the `releases/latest` picker
  (no dead/blank button).
- `detectOs(ua)` — UA → `{os, arch}`; macOS defaults arm64 (no reliable UA arch
  token), Windows reads win64/x64, Linux excludes Android.
- `primaryAssetFor(detection, parsed)` — best single installer for the OS, or
  `null` (unknown → full chooser).
- `OPENWHISPR_DESKTOP_REPO = "Yambr/openwhispr"` (the desktop repo, not server).

### Commit 2 — `0e38dc68` /download page
- `app/(public)/download/page.tsx` — RSC; `fetch` GitHub releases/latest with 1h
  `revalidate`, try/catch → fallback (never crashes), reads request UA for the
  server-side primary CTA.
- `components/screens/download/DownloadView.tsx` — client view; re-detects OS on
  hydration to refine the highlighted CTA, but always renders every platform
  variant as a real href (works JS-disabled). Primary CTA omitted when OS unknown.
- `common.download.*` i18n keys in en + ru (russian parity gate stays green).
- 5 DownloadView unit tests + `tests/e2e/u-download.spec.ts` (anon 200, no
  /sign-in bounce, every link a real absolute href, zero browser errors).
- middleware only gates `/app/*` → /download reachable anonymously; `/` → `/app`
  307 unchanged.

### Commit 3 — `89c13f98` dead-link + stale-version fixes
- `ConfigClient.tsx`: `DOCS_HREF` `/docs/litellm-target-spec.md` (404, never
  served) → `https://github.com/Yambr/openwhispr-server/blob/main/docs/litellm-target-spec.md`.
  Href regression assertion added to the existing test.
- `AuthShell.tsx`: hardcoded `v1.0.4` → `NEXT_PUBLIC_APP_VERSION` (wired in
  `next.config.ts` env from `OPENWHISPR_IMAGE_TAG`, documented in
  `apps/web/.env.example`, defaults `0.0.0`). Env-stub test asserts the rendered
  value + absence of the literal.

## Verification (own-eyes)
- Web vitest full suite: **79 files / 1101 tests passed, 0 failed**.
- `tsc --noEmit`: exit 0.
- `pnpm --filter @openwhispr/web build`: success; `/download` in the route
  manifest. Only warning is pre-existing (`jose` CompressionStream / edge
  runtime, a Better Auth transitive dep — unrelated).
- 3 commits confirmed on HEAD; working tree clean; claimed edits grep-verified.

## Not done / deferred
- Not pushed, no release cut — per the task brief the user handles release.
- Asset names match v1.7.16; if the desktop build renames assets the regex slots
  fall back to the releases picker (no crash) until the patterns are updated.
