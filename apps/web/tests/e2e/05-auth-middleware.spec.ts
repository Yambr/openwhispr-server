// Phase 07.1 / Plan 05 — Playwright spec for the Edge middleware gate.
//
// Asserts the three behaviors that distinguish our cookie-presence gate
// (D-STACK-5 / RESEARCH Pattern 4) from a full session validator:
//
//  1. Signed-out request to `/app/*` is redirected to `/sign-in` with
//     `?from=<original>` (the redirect target Plan 07 will consume).
//  2. Signed-out request to `/admin/*` is NOT redirected by the web
//     middleware — Traefik basic-auth (D-ADMIN-1) terminates that surface
//     at the edge. The expected outcome here is 401 (Traefik) when the
//     compose stack is up, OR a passthrough/404 from Next.js if running
//     against a non-Traefik baseURL. Either way: NOT a 30x to /sign-in.
//  3. Visiting `/sign-in` while signed-out does not redirect (no loop).
import { expect, test } from "@playwright/test";

test.describe("Phase 07.1 / Plan 05 — middleware gate", () => {
  test("signed-out /app/* redirects to /sign-in with ?from=", async ({ request }) => {
    const res = await request.get("/app/usage", { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers().location ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("from=%2Fapp%2Fusage");
  });

  test("signed-out /admin/* does NOT redirect to /sign-in (Traefik gates admin)", async ({
    request,
  }) => {
    const res = await request.get("/admin/observability", { maxRedirects: 0 });
    // Either Traefik basic-auth returns 401 (when stack is up under
    // Traefik) or Next.js responds with a non-redirect status. The only
    // forbidden outcome is a 30x to /sign-in.
    const status = res.status();
    if ([301, 302, 307, 308].includes(status)) {
      const location = res.headers().location ?? "";
      expect(location).not.toContain("/sign-in");
    } else {
      expect(status).not.toBe(307);
    }
  });

  test("signed-out /sign-in renders the page (no redirect loop)", async ({ request }) => {
    const res = await request.get("/sign-in", { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(400);
    expect([301, 302, 307, 308]).not.toContain(res.status());
  });
});
