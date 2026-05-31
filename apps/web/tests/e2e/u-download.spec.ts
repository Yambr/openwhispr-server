// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260531-dlx — public /download page e2e.
//
// Guards the "no broken links" + "reachable without auth" contract:
//   1. An anonymous visitor (no session cookie) reaches /download with a 200
//      — middleware only gates /app/*, so /download must NOT redirect to
//      /sign-in.
//   2. Every download affordance has a real, non-empty href (no "#"/empty) —
//      this is the regression sentinel against dead download buttons.
//   3. The page renders zero browser-side errors.
//
// The page fetches the GitHub releases API at request time; if GitHub is
// unreachable from the test runner the page falls back to the releases-picker
// links, which are still real hrefs — so this spec asserts the structural
// "every link works" invariant rather than a specific upstream version.
import { expect, test } from "./_diagnostics-fixture.js";
import { allowBrowserErrors, expectNoBrowserErrors } from "./support/browser-diagnostics.js";
import { getOrigins } from "./support/topology.js";

test.describe("@u-download — public download page", () => {
  test("anonymous visit renders 200 with real download hrefs, no broken links", async ({
    page,
  }, testInfo) => {
    // RSC pre-fetch aborts on navigation are expected and not user-visible.
    allowBrowserErrors(page, [/_rsc=.*FAILED: net::ERR_ABORTED/]);

    const webOrigin = getOrigins(testInfo).webOrigin;
    const response = await page.goto(`${webOrigin}/download`, { waitUntil: "networkidle" });

    // 1. Reachable without auth — 200, and we did NOT get bounced to /sign-in.
    expect(response?.status(), "GET /download status").toBe(200);
    expect(new URL(page.url()).pathname, "no redirect to /sign-in").toBe("/download");

    // 2. The heading renders.
    await expect(page.getByRole("heading", { name: /download openwhispr/i })).toBeVisible();

    // 3. EVERY download link in the all-platforms grid has a real href.
    const grid = page.getByTestId("download-all-platforms");
    await expect(grid).toBeVisible();
    const links = grid.getByRole("link");
    const count = await links.count();
    expect(count, "platform variant links present").toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      expect(href, `variant link #${i} href`).toBeTruthy();
      expect(href).not.toBe("#");
      expect(href).not.toBe("");
      expect(href?.startsWith("http"), `variant link #${i} is an absolute URL`).toBe(true);
    }

    // 4. The releases fallback link is a real GitHub URL.
    const releases = page.getByTestId("download-releases-link");
    const releasesHref = await releases.getAttribute("href");
    expect(releasesHref).toContain("github.com/Yambr/openwhispr/releases");

    // 5. Zero browser-side errors.
    expectNoBrowserErrors(page);
  });
});
