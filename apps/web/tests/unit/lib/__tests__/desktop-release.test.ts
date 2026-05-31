// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — pure logic for the public /download page.
//
// These are the byte-for-byte invariants the /download page relies on:
//   - asset-name → normalized-slot mapping (mac arm64/x64, win installer/
//     portable, linux appimage/deb/targz), with .blockmap/.yml IGNORED;
//   - graceful fallback to the stable releases/latest/download/<name> URL
//     when the GitHub API is unavailable (release == null) so NO button is
//     ever dead/blank;
//   - User-Agent → OS+arch detection;
//   - primary-asset selection for the detected OS.
//
// The HTTP boundary is NOT exercised here — these are pure functions. The
// page test (page.test.tsx) mocks `fetch`.
import { describe, expect, it } from "vitest";
import {
  detectOs,
  type GithubRelease,
  OPENWHISPR_DESKTOP_REPO,
  parseReleaseAssets,
  primaryAssetFor,
} from "@/lib/desktop-release";

const VERSION = "1.7.16";

// Mirror of the real v1.7.16 asset list (verified via `gh release view`),
// including the metadata files we must ignore.
function realRelease(): GithubRelease {
  const base = `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/download/v${VERSION}`;
  const names = [
    "latest-linux.yml",
    "latest-mac.yml",
    "latest-x64-mac.yml",
    "latest.yml",
    `OpenWhispr-${VERSION}-arm64-mac.zip`,
    `OpenWhispr-${VERSION}-arm64-mac.zip.blockmap`,
    `OpenWhispr-${VERSION}-arm64.dmg`,
    `OpenWhispr-${VERSION}-arm64.dmg.blockmap`,
    `OpenWhispr-${VERSION}-linux-amd64.deb`,
    `OpenWhispr-${VERSION}-linux-x64.tar.gz`,
    `OpenWhispr-${VERSION}-linux-x86_64.AppImage`,
    `OpenWhispr-${VERSION}-mac.zip`,
    `OpenWhispr-${VERSION}-mac.zip.blockmap`,
    `OpenWhispr-${VERSION}.dmg`,
    `OpenWhispr-${VERSION}.dmg.blockmap`,
    `OpenWhispr.${VERSION}.exe`,
    `OpenWhispr.Setup.${VERSION}.exe`,
    `OpenWhispr.Setup.${VERSION}.exe.blockmap`,
  ];
  return {
    tag_name: `v${VERSION}`,
    html_url: `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/tag/v${VERSION}`,
    assets: names.map((name) => ({ name, browser_download_url: `${base}/${name}` })),
  };
}

describe("OPENWHISPR_DESKTOP_REPO", () => {
  it("points at the desktop client repo (NOT the server)", () => {
    expect(OPENWHISPR_DESKTOP_REPO).toBe("Yambr/openwhispr");
  });
});

describe("parseReleaseAssets — real release", () => {
  const parsed = parseReleaseAssets(realRelease(), OPENWHISPR_DESKTOP_REPO);

  it("extracts the version from tag_name", () => {
    expect(parsed.version).toBe(VERSION);
  });

  it("maps macOS arm64 .dmg", () => {
    expect(parsed.assets.mac_arm64).toContain(`OpenWhispr-${VERSION}-arm64.dmg`);
    expect(parsed.assets.mac_arm64).not.toContain(".blockmap");
  });

  it("maps macOS Intel x64 .dmg (the un-suffixed dmg)", () => {
    expect(parsed.assets.mac_x64).toContain(`OpenWhispr-${VERSION}.dmg`);
    expect(parsed.assets.mac_x64).not.toContain("arm64");
    expect(parsed.assets.mac_x64).not.toContain(".blockmap");
  });

  it("maps Windows NSIS installer (Setup.exe) and portable exe distinctly", () => {
    expect(parsed.assets.win_installer).toContain(`OpenWhispr.Setup.${VERSION}.exe`);
    expect(parsed.assets.win_installer).not.toContain(".blockmap");
    expect(parsed.assets.win_portable).toContain(`OpenWhispr.${VERSION}.exe`);
    expect(parsed.assets.win_portable).not.toContain("Setup");
  });

  it("maps Linux AppImage / deb / tar.gz", () => {
    expect(parsed.assets.linux_appimage).toContain("x86_64.AppImage");
    expect(parsed.assets.linux_deb).toContain("amd64.deb");
    expect(parsed.assets.linux_targz).toContain("linux-x64.tar.gz");
  });

  it("never returns a .blockmap or .yml URL in any slot", () => {
    for (const url of Object.values(parsed.assets)) {
      expect(url).not.toMatch(/\.blockmap$/);
      expect(url).not.toMatch(/\.yml$/);
    }
  });

  it("is not in fallback mode when the API returned assets", () => {
    expect(parsed.fallback).toBe(false);
  });
});

describe("parseReleaseAssets — fallback (API unavailable / null)", () => {
  const parsed = parseReleaseAssets(null, OPENWHISPR_DESKTOP_REPO);

  it("flags fallback mode", () => {
    expect(parsed.fallback).toBe(true);
  });

  it("every slot is a non-empty stable URL (releases picker — no dead button)", () => {
    // Without the API payload we cannot know the version-bearing filename the
    // `releases/latest/download/<name>` redirect requires, so each slot points
    // at the releases-latest picker page — still a real, working link.
    const expected = `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/latest`;
    for (const url of Object.values(parsed.assets)) {
      expect(url).toBe(expected);
    }
  });

  it("exposes the releases page as a human fallback link", () => {
    expect(parsed.releasesPageUrl).toBe(
      `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/latest`,
    );
  });
});

describe("detectOs", () => {
  it("detects macOS (Apple Silicon defaults to arm64)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const d = detectOs(ua);
    expect(d.os).toBe("mac");
    expect(d.arch).toBe("arm64");
  });

  it("detects Windows x64", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
    const d = detectOs(ua);
    expect(d.os).toBe("windows");
    expect(d.arch).toBe("x64");
  });

  it("detects Linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
    expect(detectOs(ua).os).toBe("linux");
  });

  it("returns unknown for an empty/garbage UA", () => {
    expect(detectOs("").os).toBe("unknown");
    expect(detectOs("curl/8.4.0").os).toBe("unknown");
  });
});

describe("primaryAssetFor", () => {
  const parsed = parseReleaseAssets(realRelease(), OPENWHISPR_DESKTOP_REPO);

  it("mac → arm64 dmg", () => {
    const p = primaryAssetFor({ os: "mac", arch: "arm64" }, parsed);
    expect(p?.url).toBe(parsed.assets.mac_arm64);
    expect(p?.slot).toBe("mac_arm64");
  });

  it("windows → installer exe", () => {
    const p = primaryAssetFor({ os: "windows", arch: "x64" }, parsed);
    expect(p?.url).toBe(parsed.assets.win_installer);
  });

  it("linux → AppImage", () => {
    const p = primaryAssetFor({ os: "linux", arch: "x64" }, parsed);
    expect(p?.url).toBe(parsed.assets.linux_appimage);
  });

  it("unknown OS → null (page shows the full chooser)", () => {
    expect(primaryAssetFor({ os: "unknown", arch: "unknown" }, parsed)).toBeNull();
  });
});
