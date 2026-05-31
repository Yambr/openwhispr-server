// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — public /download page (no auth).
//
// Fetches the latest OpenWhispr DESKTOP release from the GitHub API
// (`Yambr/openwhispr`, NOT this server repo), normalizes the assets into
// per-platform installer URLs, detects the visitor's OS from the request
// User-Agent for the primary CTA, and hands everything to the client
// <DownloadView/> for rendering.
//
// Reachability: this route lives in the (public) group; `src/middleware.ts`
// only auth-gates `/app` and `/app/*`, so /download is served to anonymous
// visitors. `/` stays a 307 redirect to /app (see app/page.tsx) — only this
// route is public marketing surface.
//
// Resilience: the GitHub fetch is wrapped so a network failure / rate-limit /
// non-200 NEVER crashes the page. parseReleaseAssets(null, …) returns a
// fallback that points every link at the releases picker, so the page always
// renders working download affordances.
import { headers } from "next/headers";
import { DownloadView } from "@/components/screens/download/DownloadView";
import {
  detectOs,
  type GithubRelease,
  OPENWHISPR_DESKTOP_REPO,
  parseReleaseAssets,
} from "@/lib/desktop-release";

// Cache the upstream release lookup for an hour so we don't hammer GitHub on
// every visit (and stay well under the unauthenticated rate limit).
const RELEASE_REVALIDATE_SECONDS = 3600;

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${OPENWHISPR_DESKTOP_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        next: { revalidate: RELEASE_REVALIDATE_SECONDS },
      },
    );
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as GithubRelease;
  } catch {
    return null;
  }
}

export default async function DownloadPage(): Promise<React.JSX.Element> {
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? "";

  const release = await fetchLatestRelease();
  const parsed = parseReleaseAssets(release, OPENWHISPR_DESKTOP_REPO);
  const serverDetection = detectOs(userAgent);

  return <DownloadView parsed={parsed} serverDetection={serverDetection} />;
}
