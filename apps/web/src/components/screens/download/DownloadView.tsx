// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — presentational view for the public /download page.
//
// Client component (it re-detects the visitor's OS on hydration to refine the
// highlighted primary CTA). All data arrives as props from the RSC page
// (`app/(public)/download/page.tsx`), which owns the GitHub fetch. Rendering
// here is side-effect-free apart from the optional client re-detect, which is
// pure progressive enhancement — every download link is a real href the moment
// the server HTML lands, so the page works with JS disabled.
"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  type AssetSlot,
  detectOs,
  type OsDetection,
  type OsKind,
  type ParsedRelease,
  primaryAssetFor,
} from "@/lib/desktop-release";

export interface DownloadViewProps {
  parsed: ParsedRelease;
  /** OS detected server-side from the request User-Agent. */
  serverDetection: OsDetection;
}

// Display grouping: which variant slots belong to which platform card.
const PLATFORM_SLOTS: Record<Exclude<OsKind, "unknown">, AssetSlot[]> = {
  mac: ["mac_arm64", "mac_x64"],
  windows: ["win_installer", "win_portable"],
  linux: ["linux_appimage", "linux_deb", "linux_targz"],
};

const PLATFORM_ORDER: Array<Exclude<OsKind, "unknown">> = ["mac", "windows", "linux"];

export function DownloadView({ parsed, serverDetection }: DownloadViewProps): React.JSX.Element {
  const { t } = useTranslation(["common"]);

  // Start from the server detection (so SSR and the first client paint agree),
  // then refine on mount from the richer client signals (userAgentData /
  // navigator.platform) — purely to highlight the right primary button.
  const [detection, setDetection] = useState<OsDetection>(serverDetection);
  useEffect(() => {
    const ua =
      typeof navigator !== "undefined" ? `${navigator.userAgent} ${navigator.platform ?? ""}` : "";
    const client = detectOs(ua);
    if (client.os !== "unknown") {
      setDetection(client);
    }
  }, []);

  const primary = primaryAssetFor(detection, parsed);
  const platformLabel = (os: OsKind): string =>
    os === "unknown" ? "" : t(`common.download.platform.${os}.label.text`);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-semibold text-3xl tracking-tight">
          {t("common.download.heading.title.text")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("common.download.heading.subtitle.text")}
        </p>
        {!parsed.fallback && (
          <p className="text-muted-foreground text-xs">
            {t("common.download.version.label.text", { version: parsed.version })}
          </p>
        )}
      </header>

      {primary && (
        <div className="flex justify-center">
          <Button asChild size="lg">
            <a data-testid="download-primary" href={primary.url}>
              {t("common.download.primary.label.text", { platform: platformLabel(detection.os) })}
            </a>
          </Button>
        </div>
      )}

      {parsed.fallback && (
        <p className="text-center text-muted-foreground text-sm">
          {t("common.download.fallback.text")}
        </p>
      )}

      <Separator />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="download-all-platforms">
        {PLATFORM_ORDER.map((os) => (
          <Card key={os}>
            <CardHeader>
              <CardTitle className="text-base">{platformLabel(os)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {PLATFORM_SLOTS[os].map((slot) => (
                <Button key={slot} asChild variant="outline" size="sm">
                  <a href={parsed.assets[slot]}>
                    {t(`common.download.variant.${slot}.label.text`)}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2 text-sm">
        <a
          data-testid="download-releases-link"
          href={parsed.releasesPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          {t("common.download.releases.link.label.text")}
        </a>
        <a href="/sign-in" className="text-muted-foreground hover:text-foreground">
          {t("common.download.signin.link.label.text")}
        </a>
      </div>
    </div>
  );
}
