// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Next.js configuration for @openwhispr/web.
 *
 * Locked decisions enforced here:
 *   - D-DEPLOY-2: output: 'standalone' so the runtime image is ~150 MB.
 *   - Pitfall 10 (RESEARCH): outputFileTracingRoot points at the monorepo root
 *     so @vercel/nft follows pnpm workspace symlinks correctly.
 *   - D-SEC-1: CSP, HSTS, X-Frame-Options DENY, Referrer-Policy,
 *     Permissions-Policy emitted via headers(); auth pages get a stricter CSP
 *     that excludes third-party origins.
 *   - D-PERF-1: @next/bundle-analyzer wrapper, gated by ANALYZE=true. The
 *     wrapper is loaded only when analysis is requested so a missing optional
 *     dev dependency does not break the default build.
 */
import path from "node:path";
import type { NextConfig } from "next";

// Next.js 15 App Router emits inline <script> tags for RSC payload hydration
// (the `self.__next_f.push(...)` bootstrap). A `script-src 'self'` policy
// blocks every one of these, leaving the hydrated DOM empty even though the
// initial HTML rendered. We therefore allow 'unsafe-inline' for scripts in
// both CSP buckets. Long-term we should switch to per-request nonces via
// middleware (Next 15 supports this), but that requires a middleware-level
// rewrite that is outside Plan 13's scope (Phase 07.1 / Plan 13 deviation —
// Rule 1 fix: unblock hydration so e2e + cross-screen smoke can run).
//
// 'unsafe-eval' is NOT added — Next.js production builds do not use eval.
// 'unsafe-inline' for style-src remains (required for Tailwind/shadcn
// runtime style injection).
const STRICT_AUTH_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

const APP_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

const COMMON_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    // Two mutually exclusive source patterns so the auth bucket and the app
    // bucket never both match a single request. The auth bucket is exact-
    // matched on its three paths; the app bucket uses a regex negative
    // lookahead to exclude them. This keeps each response carrying exactly
    // one Content-Security-Policy header.
    return [
      {
        source: "/sign-in",
        headers: [...COMMON_HEADERS, { key: "Content-Security-Policy", value: STRICT_AUTH_CSP }],
      },
      {
        source: "/sign-up",
        headers: [...COMMON_HEADERS, { key: "Content-Security-Policy", value: STRICT_AUTH_CSP }],
      },
      {
        source: "/verify-email",
        headers: [...COMMON_HEADERS, { key: "Content-Security-Policy", value: STRICT_AUTH_CSP }],
      },
      {
        source: "/:path((?!sign-in$|sign-up$|verify-email$).*)",
        headers: [...COMMON_HEADERS, { key: "Content-Security-Policy", value: APP_CSP }],
      },
    ];
  },
};

// Bundle analyzer is opt-in via ANALYZE=true. Loaded lazily so a missing
// optional dev dependency in default workflows does not error the build.
const withBundleAnalyzer =
  process.env.ANALYZE === "true"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- next-config interop
      require("@next/bundle-analyzer")({ enabled: true })
    : (config: NextConfig) => config;

export default withBundleAnalyzer(nextConfig);
