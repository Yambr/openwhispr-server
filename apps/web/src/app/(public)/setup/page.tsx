// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 4 — /setup RSC entry.
//
// Conformance inventory: composes ui.jsx:AuthShell (L229-316) + ui.jsx:Field
// (L338-352) + ui.jsx:Btn (L326-336). NO /setup JSX oracle exists; this is
// a deliberate, documented design deviation per RESEARCH §16 / D-20 — the
// authoritative Phase-07 screens-user.jsx + ui.jsx pair never produced a
// dedicated `ScreenSetup` template. The single-page wizard semantics
// (Identity → Workspace → Review) are an ADMIN-02 invention.
//
// Setup-state guard (T-12.03-03): the page fetches the PUBLIC
// `/api/setup-state` endpoint (Plan 12-02 Task 5) — NOT the session-
// required tenant-capabilities endpoint (D-07), which would 401 for
// the anonymous /setup visitor. Branches on the `status` field
// returned by setup-state:
//   * pending          -> render <SetupForm />
//   * completed        -> redirect('/sign-in')
//   * skipped_legacy   -> redirect('/sign-in')
//   * fetch failed/503 -> render the "initializing" copy (T-12.03-06)
//
// Why server-side fetch + redirect (not client-side useEffect+router.push):
// the guard MUST run BEFORE the wizard renders, otherwise a completed
// install would briefly flash the form to the user. RSC fetch +
// `redirect('/sign-in')` is the canonical Next.js 15 pattern for this.
//
// Hardcoded /admin redirect target on submit lives in the Client form
// (SetupForm.tsx); the page itself never reads `?next=` (open-redirect
// guard, T-12.03-04 / RESEARCH §15(g)).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/screens/auth/SetupForm";
import { getServerI18n } from "@/lib/i18n";
// Phase 53 / Plan 53-28 — use the canonical internalApiUrl() helper
// (apps/web/src/lib/internal-api.ts) which resolves to
// `http://api:3000` inside compose. The prior ad-hoc resolver fell
// back to a relative `/api/setup-state` URL when neither
// `OPENWHISPR_API_URL` nor `NEXT_PUBLIC_API_BASE_URL` was set in the
// web container — and neither IS set in the web service env block
// (only the api service has OPENWHISPR_API_URL; web has
// INTERNAL_API_URL=http://api:3000). The RSC `fetch()` with a
// relative URL has no origin to resolve against and throws — every
// visit to /setup rendered the "initializing" error copy instead of
// the wizard. Caught by Phase 53 strict-diagnostics e2e sweep.
import { internalApiUrl } from "@/lib/internal-api";

interface SetupStateResponse {
  readonly status: "pending" | "completed" | "skipped_legacy";
}

export default async function SetupPage(): Promise<React.JSX.Element> {
  // Read the active locale negotiated by the edge middleware so the
  // "initializing" copy renders in the user's language.
  const requestHeaders = await headers();
  const lng = requestHeaders.get("x-locale") === "ru" ? "ru" : "en";

  let status: SetupStateResponse["status"] | "error" = "error";
  try {
    const res = await fetch(`${internalApiUrl()}/api/setup-state`, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as SetupStateResponse;
      status = body.status;
    }
  } catch {
    status = "error";
  }

  if (status === "completed" || status === "skipped_legacy") {
    redirect("/sign-in");
  }

  if (status === "error") {
    // Boot-race fallback (T-12.03-06): /api/setup-state returns 503
    // when migrations have not yet completed (Phase 13 /api/health
    // interop), or the API is unreachable. Render localized
    // "initializing" copy so the operator knows to retry.
    const i18n = await getServerI18n(lng, ["end-user", "common"]);
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {i18n.t("end-user:end-user.setup.initializing.text")}
      </p>
    );
  }

  // status === "pending" — render the wizard.
  return <SetupForm />;
}
