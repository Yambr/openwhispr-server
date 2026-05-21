// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — rewrite a Better Auth verification link's `callbackURL` query
// param to the server-controlled verify-email-complete route.
//
// Better Auth 1.6.9 builds the verification URL as
//   `${baseURL}/verify-email?token=<jwt>&callbackURL=<encoded value>`
// where `<encoded value>` is `encodeURIComponent(body.callbackURL ?? "/")`
// (vendored proof: `better-auth/dist/api/routes/sign-up.mjs` and
// `email-verification.mjs:28-29`). The slim OpenWhispr desktop client
// does NOT send a `callbackURL` at sign-up, so the default is `"/"`.
//
// On a successful `GET /verify-email`, Better Auth's handler
// `302`-redirects to whatever `callbackURL` the link carries
// (`email-verification.mjs:288` —
// `if (ctx.query.callbackURL) throw ctx.redirect(ctx.query.callbackURL)`).
// Its `originCheck` middleware admits ANY relative path
// (`allowRelativePaths: true`). So overriding `callbackURL` to a fixed
// RELATIVE server route makes the verify-email click 302 straight into
// our route — no client cooperation required.
//
// SECURITY — `VERIFY_EMAIL_COMPLETE_PATH` is a SERVER-FIXED relative
// literal. It is never attacker-influenced; there is no open-redirect
// surface. The rewrite is total: any inbound `callbackURL` (including
// the `/` default) is replaced, never appended to.

/**
 * The relative path of the R22 verify-email-complete route. Kept here as
 * the single source of truth shared between the `callbackURL` rewrite
 * and any caller that needs to reference the route path.
 */
export const VERIFY_EMAIL_COMPLETE_PATH = "/api/auth/verify-email-complete";

/**
 * Rewrite the `callbackURL` query parameter of a Better Auth
 * verification link to {@link VERIFY_EMAIL_COMPLETE_PATH}.
 *
 * Robust to malformed input: if `url` cannot be parsed as a URL the
 * original string is returned unchanged (the email still carries a
 * working verification link — it simply 302s to Better Auth's `/`
 * default on success, the pre-R22 behavior). The token query parameter
 * is preserved verbatim.
 */
export function rewriteVerificationCallbackUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("callbackURL", VERIFY_EMAIL_COMPLETE_PATH);
    return parsed.toString();
  } catch {
    // Non-absolute / malformed URL — return as-is rather than throwing
    // out of the sendVerificationEmail hook (which would leave the
    // account unverifiable). Better Auth always passes an absolute
    // `${baseURL}/verify-email?...` URL, so this branch is defensive.
    return url;
  }
}
