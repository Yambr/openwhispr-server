// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-ui-spec.config.ts — Phase 07 / Plan 02 (D-ART7).
 *
 * Shared constants for the UI-SPEC linter (tools/lint-ui-spec.ts, landed by
 * Plan 03) and its test suite (tools/lint-ui-spec.test.ts).
 *
 * All values trace back to:
 *   - 07-CONTEXT.md § D-ART7 (linter rules)
 *   - 07-CONTEXT.md § D-ART4 (copy-key 5-level schema)
 *   - 07-PLAN-01 verified Better Auth catch-all API Reference table
 *   - apps/api/src/routes/better-auth-handler.ts (live catch-all source)
 */

// Historical SPEC text said "9" before shadcn primitives became a required subsection;
// canonical count is 10.
export const REQUIRED_SUBSECTIONS = [
  "Purpose",
  "Roles",
  "Route",
  "Data",
  "Actions",
  "States",
  "User journey",
  "Copy keys",
  "Wireframe",
  "shadcn primitives",
] as const;

// 5-level dotted hierarchy per D-ART4: {surface}.{screen}.{section}.{element}.{prop}.
// Each segment: lowercase letter then lowercase/digit/hyphen.
export const COPY_KEY_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){4}$/;

// Endpoint reference shape inside UI-SPEC inline code: "VERB /api/...".
export const ENDPOINT_REGEX = /^(GET|POST|PATCH|DELETE|PUT)\s+(\/api\/[a-zA-Z0-9/_:.*-]+)$/;

// Verified Plan 01: Better Auth's catch-all (app.all("/api/auth/*", ...))
// serves these method+path combinations. List merged from
// apps/api/src/routes/better-auth-handler.ts and better-auth library defaults.
export const BETTER_AUTH_PATHS: ReadonlyArray<string> = [
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-up/email",
  "POST /api/auth/sign-out",
  "POST /api/auth/verify-email",
  "POST /api/auth/send-verification-email",
  "POST /api/auth/forget-password",
  // Better Auth 1.6.9 registers `request-password-reset` (the
  // `forget-password` alias from older releases 404s). Both names are
  // listed so historical UI-SPEC references keep validating.
  "POST /api/auth/request-password-reset",
  "POST /api/auth/reset-password",
  "GET /api/auth/get-session",
  "GET /api/auth/list-sessions",
  "POST /api/auth/revoke-session",
  "POST /api/auth/revoke-other-sessions",
  "DELETE /api/auth/delete-account",
  "GET /api/auth/sign-in/social/google",
  "GET /api/auth/sign-in/social/github",
  // Generic OIDC provider (operator-configured upstream IdP — Better Auth
  // genericOAuth plugin). Identified by literal `oidc` in the catch-all URL.
  "GET /api/auth/sign-in/social/oidc",
  // Dynamic placeholder used in UI-SPEC prose when the provider is parametric
  // (`sign-in/social/[provider]`). Resolves through the same catch-all mount.
  "GET /api/auth/sign-in/social/:provider",
  "GET /api/auth/callback/google",
  "GET /api/auth/callback/github",
  "GET /api/auth/callback/oidc",
];

// Endpoints named by UI-SPEC but not yet implemented under apps/api/src/routes/.
// Linter must report these as warnings (severity: "warning"), not errors.
// MUST be empty before Phase 7 closes — Plan 07 verifier enforces this.
export const WIP_ENDPOINTS: ReadonlyArray<string> = [];

// Wireframe monospace tolerance: any non-empty line's length may deviate from
// the longest line in the same block by at most this many characters.
export const WIREFRAME_LENGTH_TOLERANCE = 2;

// Sentinel line accepted inside a Wireframe code block when ASCII rendering is
// impractical (e.g., dense pixel-perfect renders deferred to the See visual JSX).
export const WIREFRAME_VISUAL_ONLY_SENTINEL = "(visual-only — see See visual: line)";
