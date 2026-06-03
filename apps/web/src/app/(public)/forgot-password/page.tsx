// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a / Task 2 — /forgot-password RSC entry.
// Upstream #9 — server-side route guard: forgot-password is a LOCAL-login-only
// flow (it mints a password-reset email). When the operator disables local login
// (OPENWHISPR_DISABLE_LOCAL_LOGIN=1 → GET /api/auth/providers localLogin.enabled
// === false; the server also 403s /request-password-reset), the route must not
// be usable — redirect to /sign-in. This is the UI half of the server block.
//
// Default-safe / fail-open (mirrors the useAuthProviders client contract): only
// an EXPLICIT localLogin.enabled === false redirects. Absent field (old server
// ≤1.1.0), non-OK response, or a fetch error all FALL THROUGH and render the
// form exactly as before — a transient /api/auth/providers blip must never strand
// a user who legitimately needs to reset their password. The server reset
// endpoint is the source of truth (403s when disabled); this is defence-in-depth.
//
// Gating /forgot-password is necessary-and-sufficient: /reset-password is
// reachable only via an emailed token that a blocked /forgot-password can no
// longer mint (its token-missing branch handles the dead-link case), so it needs
// no separate guard.
//
// RSC fetch + redirect (not client useEffect+router.push) is the canonical
// Next.js 15 pattern — no form flash before the redirect resolves.
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/screens/auth/ForgotPasswordForm";
import { internalApiUrl } from "@/lib/internal-api";

interface AuthProvidersResponse {
  readonly localLogin?: { readonly enabled?: boolean };
}

export default async function ForgotPasswordPage(): Promise<React.JSX.Element> {
  let localLoginDisabled = false;
  try {
    const res = await fetch(`${internalApiUrl()}/api/auth/providers`, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as AuthProvidersResponse;
      // Only an explicit `false` disables. Absent ⇒ enabled (back-compat).
      localLoginDisabled = body.localLogin?.enabled === false;
    }
  } catch {
    // Fail-open: render the form (server reset endpoint is the source of truth).
    localLoginDisabled = false;
  }

  if (localLoginDisabled) {
    redirect("/sign-in");
  }

  return <ForgotPasswordForm />;
}
