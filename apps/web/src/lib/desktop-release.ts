// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — pure logic backing the public /download page.
//
// The OpenWhispr desktop client ships its installers as GitHub release assets
// on the `Yambr/openwhispr` repo (NOT this server repo). This module turns a
// `releases/latest` API payload into the normalized per-platform download URLs
// the page renders, with a graceful fallback to the stable
// `releases/latest/download/<name>` redirect when the API is unreachable so no
// button ever renders dead/blank.
//
// Everything here is pure (no I/O) — the page owns the `fetch` boundary.

/** Desktop client release repo. Distinct from `Yambr/openwhispr-server`. */
export const OPENWHISPR_DESKTOP_REPO = "Yambr/openwhispr";

/** Subset of the GitHub `releases/latest` shape we consume. */
export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}
export interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: GithubReleaseAsset[];
}

export type OsKind = "mac" | "windows" | "linux" | "unknown";
export type ArchKind = "arm64" | "x64" | "unknown";

export interface OsDetection {
  os: OsKind;
  arch: ArchKind;
}

/** Normalized asset slots — one URL per concrete installer we surface. */
export interface ReleaseAssets {
  mac_arm64: string;
  mac_x64: string;
  win_installer: string;
  win_portable: string;
  linux_appimage: string;
  linux_deb: string;
  linux_targz: string;
}

export type AssetSlot = keyof ReleaseAssets;

export interface ParsedRelease {
  /** Release version without the leading `v` (e.g. "1.7.16"), or "latest". */
  version: string;
  assets: ReleaseAssets;
  /** Link to the human-browsable releases page (always safe). */
  releasesPageUrl: string;
  /** True when the API payload was missing → all URLs use the stable redirect. */
  fallback: boolean;
}

/**
 * Fallback URLs used when the GitHub API is unreachable. GitHub's
 * `releases/latest/download/<name>` redirect needs the EXACT version-bearing
 * filename, which we don't know without the API — so every slot points at the
 * `releases/latest` picker page instead. That keeps every href non-empty (no
 * dead buttons) and lands the user one click from the right installer. This is
 * the documented graceful-degradation path.
 */
function fallbackAssets(repoSlug: string): ReleaseAssets {
  const base = `https://github.com/${repoSlug}/releases/latest`;
  return {
    mac_arm64: base,
    mac_x64: base,
    win_installer: base,
    win_portable: base,
    linux_appimage: base,
    linux_deb: base,
    linux_targz: base,
  };
}

function pickUrl(
  assets: GithubReleaseAsset[],
  predicate: (name: string) => boolean,
  fallbackUrl: string,
): string {
  const hit = assets.find((a) => predicate(a.name));
  return hit ? hit.browser_download_url : fallbackUrl;
}

/** Reject the electron-updater metadata files (.blockmap, .yml). */
function isInstaller(name: string): boolean {
  return !name.endsWith(".blockmap") && !name.endsWith(".yml");
}

/**
 * Normalize a GitHub release (or `null` on fetch failure) into per-platform
 * download URLs. When `release` is null/empty, returns the fallback shape
 * pointing every slot at the releases page so the page never has a dead link.
 */
export function parseReleaseAssets(
  release: GithubRelease | null | undefined,
  repoSlug: string,
): ParsedRelease {
  const releasesPageUrl = `https://github.com/${repoSlug}/releases/latest`;

  if (!release || !Array.isArray(release.assets) || release.assets.length === 0) {
    return {
      version: "latest",
      assets: fallbackAssets(repoSlug),
      releasesPageUrl,
      fallback: true,
    };
  }

  const version = release.tag_name.replace(/^v/, "");
  const fb = fallbackAssets(repoSlug);
  const a = release.assets;

  const assets: ReleaseAssets = {
    // macOS arm64: "...-arm64.dmg"
    mac_arm64: pickUrl(a, (n) => isInstaller(n) && /-arm64\.dmg$/.test(n), fb.mac_arm64),
    // macOS Intel: the un-suffixed ".dmg" (no "-arm64")
    mac_x64: pickUrl(
      a,
      (n) => isInstaller(n) && /\.dmg$/.test(n) && !n.includes("arm64"),
      fb.mac_x64,
    ),
    // Windows NSIS installer: "OpenWhispr.Setup.<v>.exe"
    win_installer: pickUrl(
      a,
      (n) => isInstaller(n) && /\.Setup\..*\.exe$/.test(n),
      fb.win_installer,
    ),
    // Windows portable: "OpenWhispr.<v>.exe" (no ".Setup.")
    win_portable: pickUrl(
      a,
      (n) => isInstaller(n) && /\.exe$/.test(n) && !n.includes(".Setup."),
      fb.win_portable,
    ),
    linux_appimage: pickUrl(a, (n) => isInstaller(n) && /\.AppImage$/.test(n), fb.linux_appimage),
    linux_deb: pickUrl(a, (n) => isInstaller(n) && /\.deb$/.test(n), fb.linux_deb),
    linux_targz: pickUrl(a, (n) => isInstaller(n) && /\.tar\.gz$/.test(n), fb.linux_targz),
  };

  return { version, assets, releasesPageUrl, fallback: false };
}

/** Map a User-Agent string to an OS + best-effort arch. */
export function detectOs(userAgent: string): OsDetection {
  const ua = userAgent.toLowerCase();

  // Order matters: "macintosh" UAs also contain "intel"; Windows must win
  // its own branch; iOS/Android are treated as unknown (no desktop build).
  if (ua.includes("windows")) {
    const arch = ua.includes("win64") || ua.includes("x64") ? "x64" : "unknown";
    return { os: "windows", arch };
  }
  if (ua.includes("macintosh") || ua.includes("mac os x")) {
    // Browser UAs never reliably expose Apple Silicon; default to arm64 (all
    // currently shipping Macs) while the page still lists the Intel build.
    return { os: "mac", arch: "arm64" };
  }
  if (ua.includes("linux") && !ua.includes("android")) {
    return { os: "linux", arch: ua.includes("x86_64") || ua.includes("x64") ? "x64" : "unknown" };
  }
  return { os: "unknown", arch: "unknown" };
}

export interface PrimaryAsset {
  slot: AssetSlot;
  url: string;
}

/**
 * Pick the single best installer for the detected OS, or `null` when the OS
 * is unknown (the page then shows the full platform chooser).
 */
export function primaryAssetFor(
  detection: OsDetection,
  parsed: ParsedRelease,
): PrimaryAsset | null {
  switch (detection.os) {
    case "mac":
      return detection.arch === "x64"
        ? { slot: "mac_x64", url: parsed.assets.mac_x64 }
        : { slot: "mac_arm64", url: parsed.assets.mac_arm64 };
    case "windows":
      return { slot: "win_installer", url: parsed.assets.win_installer };
    case "linux":
      return { slot: "linux_appimage", url: parsed.assets.linux_appimage };
    default:
      return null;
  }
}
