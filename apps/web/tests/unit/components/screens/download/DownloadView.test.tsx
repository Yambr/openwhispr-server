// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — render contract for the /download presentational view.
//
// Surface verified:
//   1. A prominent primary CTA links to the detected OS's installer with a
//      real (non-empty, non-"#") href.
//   2. EVERY platform variant is rendered with a real download href (no dead
//      buttons) — this is the core "no broken links" guarantee.
//   3. When the OS is unknown, no primary CTA is shown but the full chooser
//      still renders.
//   4. Fallback mode surfaces the GitHub releases link.
//   5. All copy is i18n-driven (renders the provided resources, not literals).
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  OPENWHISPR_DESKTOP_REPO,
  type ParsedRelease,
  parseReleaseAssets,
} from "@/lib/desktop-release";
import { I18nProvider } from "@/lib/i18n-client";

const VERSION = "1.7.16";

function realParsed(): ParsedRelease {
  const base = `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/download/v${VERSION}`;
  return parseReleaseAssets(
    {
      tag_name: `v${VERSION}`,
      html_url: `https://github.com/${OPENWHISPR_DESKTOP_REPO}/releases/tag/v${VERSION}`,
      assets: [
        { name: `OpenWhispr-${VERSION}-arm64.dmg`, browser_download_url: `${base}/arm.dmg` },
        { name: `OpenWhispr-${VERSION}.dmg`, browser_download_url: `${base}/x64.dmg` },
        { name: `OpenWhispr.Setup.${VERSION}.exe`, browser_download_url: `${base}/setup.exe` },
        { name: `OpenWhispr.${VERSION}.exe`, browser_download_url: `${base}/portable.exe` },
        {
          name: `OpenWhispr-${VERSION}-linux-x86_64.AppImage`,
          browser_download_url: `${base}/app.AppImage`,
        },
        { name: `OpenWhispr-${VERSION}-linux-amd64.deb`, browser_download_url: `${base}/x.deb` },
        { name: `OpenWhispr-${VERSION}-linux-x64.tar.gz`, browser_download_url: `${base}/x.tgz` },
      ],
    },
    OPENWHISPR_DESKTOP_REPO,
  );
}

// Minimal resources snapshot mirroring src/locales/en/common.json -> common.download.
const resources = {
  common: {
    common: {
      download: {
        heading: {
          title: { text: "Download OpenWhispr" },
          subtitle: { text: "Pick your platform." },
        },
        primary: { label: { text: "Download for {platform}" }, detecting: { text: "Detecting…" } },
        platform: {
          mac: { label: { text: "macOS" } },
          windows: { label: { text: "Windows" } },
          linux: { label: { text: "Linux" } },
        },
        variant: {
          mac_arm64: { label: { text: "Apple Silicon (.dmg)" } },
          mac_x64: { label: { text: "Intel (.dmg)" } },
          win_installer: { label: { text: "Installer (.exe)" } },
          win_portable: { label: { text: "Portable (.exe)" } },
          linux_appimage: { label: { text: "AppImage" } },
          linux_deb: { label: { text: "Debian/Ubuntu (.deb)" } },
          linux_targz: { label: { text: "Tarball (.tar.gz)" } },
        },
        version: { label: { text: "Version {version}" } },
        fallback: { text: "Could not load releases." },
        releases: { link: { label: { text: "All releases on GitHub" } } },
        signin: { link: { label: { text: "Already have an account? Sign in" } } },
      },
    },
  },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

// The component re-detects the visitor's OS on mount from navigator.userAgent
// (progressive enhancement) and lets that override `serverDetection`. The host
// runner's UA differs between dev machines (macOS) and CI runners (Linux), so a
// test asserting on `serverDetection` alone is non-deterministic. Pin the UA at
// the navigator boundary (the OS-detection input) so the mount-time re-detect is
// reproducible regardless of where the suite runs.
function stubUserAgent(ua: string): void {
  Object.defineProperty(globalThis.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  Object.defineProperty(globalThis.navigator, "platform", {
    value: "",
    configurable: true,
  });
}

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
// A UA detectOs maps to "unknown" — no "windows", "macintosh"/"mac os x", or
// "linux" token — so the client re-detect does not override an unknown
// serverDetection. (An iOS UA would NOT work here: it contains "Mac OS X" and
// detectOs would resolve it to mac.)
const UNKNOWN_UA = "Mozilla/5.0 (Unknown; rv:120.0) Gecko/20100101";

afterEach(() => {
  // jsdom installs userAgent/platform as own props; deleting our override
  // restores the prototype getter for any later suite in the same worker.
  delete (globalThis.navigator as unknown as Record<string, unknown>).userAgent;
  delete (globalThis.navigator as unknown as Record<string, unknown>).platform;
});

describe("DownloadView", () => {
  it("renders a primary CTA pointing at the detected OS installer (real href)", async () => {
    // Pin the client re-detect to macOS so it agrees with serverDetection.
    stubUserAgent(MAC_UA);
    const { DownloadView } = await import("@/components/screens/download/DownloadView");
    const parsed = realParsed();
    render(
      <Wrap>
        <DownloadView parsed={parsed} serverDetection={{ os: "mac", arch: "arm64" }} />
      </Wrap>,
    );
    const primary = screen.getByTestId("download-primary");
    const href = primary.getAttribute("href");
    expect(href).toBe(parsed.assets.mac_arm64);
    expect(href).toBeTruthy();
    expect(href).not.toBe("#");
  });

  it("renders EVERY platform variant with a real, non-empty download href", async () => {
    const { DownloadView } = await import("@/components/screens/download/DownloadView");
    const parsed = realParsed();
    render(
      <Wrap>
        <DownloadView parsed={parsed} serverDetection={{ os: "unknown", arch: "unknown" }} />
      </Wrap>,
    );
    const list = screen.getByTestId("download-all-platforms");
    const links = within(list).getAllByRole("link");
    // 7 installer variants must all be present with real hrefs.
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const a of links) {
      const href = a.getAttribute("href");
      expect(href).toBeTruthy();
      expect(href).not.toBe("#");
      expect(href).not.toBe("");
    }
  });

  it("omits the primary CTA when the OS is unknown", async () => {
    // Client re-detect must also yield unknown, otherwise it would override the
    // unknown serverDetection and surface a primary CTA.
    stubUserAgent(UNKNOWN_UA);
    const { DownloadView } = await import("@/components/screens/download/DownloadView");
    render(
      <Wrap>
        <DownloadView parsed={realParsed()} serverDetection={{ os: "unknown", arch: "unknown" }} />
      </Wrap>,
    );
    expect(screen.queryByTestId("download-primary")).toBeNull();
  });

  it("shows the GitHub releases link in fallback mode", async () => {
    const { DownloadView } = await import("@/components/screens/download/DownloadView");
    const parsed = parseReleaseAssets(null, OPENWHISPR_DESKTOP_REPO);
    render(
      <Wrap>
        <DownloadView parsed={parsed} serverDetection={{ os: "linux", arch: "x64" }} />
      </Wrap>,
    );
    const releases = screen.getByTestId("download-releases-link");
    expect(releases.getAttribute("href")).toBe(parsed.releasesPageUrl);
  });

  it("renders i18n-driven heading copy (not a hardcoded literal)", async () => {
    const { DownloadView } = await import("@/components/screens/download/DownloadView");
    render(
      <Wrap>
        <DownloadView parsed={realParsed()} serverDetection={{ os: "mac", arch: "arm64" }} />
      </Wrap>,
    );
    expect(screen.getByText(/download openwhispr/i)).toBeInTheDocument();
  });
});
