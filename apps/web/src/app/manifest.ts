// SPDX-License-Identifier: FSL-1.1-ALv2
// Web app PWA manifest. Next.js App Router auto-serves this at /manifest.webmanifest
// and injects <link rel="manifest"> into <head>. Pairs with `icon.svg` (auto-wired
// favicon) to give browsers a real tab icon, social-preview source, and PWA
// install entry. Brand color #2563eb matches `--color-accent` in globals.css.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenWhispr",
    short_name: "OpenWhispr",
    description: "OpenWhispr Server web console",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
