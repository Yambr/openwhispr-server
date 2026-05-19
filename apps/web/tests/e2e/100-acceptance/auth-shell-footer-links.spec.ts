// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-08 — Long-form acceptance: AuthShell footer links are live.
//
// Closes the BUG-55-AUTHSHELL-DEAD-LINKS UC from Phase 55 RESEARCH.md
// §"AuthShell footer dead links": prior to this commit the AuthShell
// side panel shipped THREE Link href="#" anchors (Status / Docs /
// GitHub) — clicking them did nothing in production. The fix points
// them at the canonical GitHub repo:
//   Status → /actions (CI dashboard)
//   Docs   → #readme
//   GitHub → repo root
//
// All three open in a new tab with rel="noopener noreferrer" per the
// safeExternalHref hygiene pattern used elsewhere in the codebase
// (ObservabilityClient.tsx:81-93).
//
// Slim-only. No fixture user (AuthShell is public). expectNoBrowserErrors
// at every step.

import { expect, test } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — AuthShell footer links (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-08 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
  });

  test("AuthShell footer Status + Docs + GitHub anchors point at the canonical GitHub repo with noopener noreferrer — zero browser errors", async ({
    page,
  }) => {
    // Visit /sign-in — AuthShell mounts on every public route. AuthShell
    // side panel only renders on the ≥lg viewport.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${WEB_BASE}/sign-in`);

    // Locate the three footer anchors by accessible-name (English labels
    // resolved from common.auth.shell.footer.{status,docs,github}.text).
    const status = page.getByRole("link", { name: /^Status$/i });
    const docs = page.getByRole("link", { name: /^Docs$/i });
    const github = page.getByRole("link", { name: /^GitHub$/i });

    for (const [name, anchor, expectedSuffix] of [
      ["status", status, "/actions"],
      ["docs", docs, "#readme"],
      ["github", github, "openwhispr-server"],
    ] as const) {
      await expect(anchor, `${name} anchor must be visible`).toBeVisible();
      const href = await anchor.getAttribute("href");
      expect(href, `${name} href must not be the dead "#" sentinel`).not.toBe("#");
      expect(href, `${name} href must contain "${expectedSuffix}"`).toContain(expectedSuffix);
      expect(href, `${name} href must point at the canonical openwhispr-server repo`).toMatch(
        /^https:\/\/github\.com\/openwhispr\/openwhispr-server/,
      );
      const target = await anchor.getAttribute("target");
      expect(target, `${name} must open in a new tab`).toBe("_blank");
      const rel = await anchor.getAttribute("rel");
      expect(rel, `${name} must have noopener + noreferrer`).toContain("noopener");
      expect(rel).toContain("noreferrer");
    }
    expectNoBrowserErrors(page);
  });
});
