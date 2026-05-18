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

// Phase 51 / Plan 51-04 (REVIEW CR-5) — Content-Security-Policy moved
// to middleware.ts so it can carry a per-request `nonce-<value>` in
// `script-src`. The old `'unsafe-inline'` allowance (rationale: Next 15
// emits an inline hydration bootstrap) is gone — Next 15 stamps the
// middleware-supplied nonce onto every script tag it emits when the
// `x-nonce` request header is set. `headers()` here continues to emit
// the constant security headers (HSTS, frame-options, referrer, etc.).
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
    // Phase 51 / Plan 51-04 — CSP now lives in middleware.ts (per-
    // request nonce). The constants below are the security headers
    // that don't vary per request.
    return [
      {
        source: "/:path*",
        headers: COMMON_HEADERS,
      },
    ];
  },
  async rewrites() {
    // Phase 53 / Plan 53-06 (DECISIONS §A) — proxy `/api/auth/*` and
    // other api-owned paths from the web origin to the Fastify backend
    // so Better Auth's same-origin client just works without CORS /
    // `SameSite=None` / cross-subdomain-cookie complications.
    //
    // The destination resolves from the build-arg env var
    // `NEXT_PUBLIC_API_URL` (Phase 07.1 / Plan 13.3 plumbing). Inside
    // docker-compose this is `http://api:3000` (docker-internal
    // hostname); on a non-docker dev box operators set
    // `NEXT_PUBLIC_API_URL=http://localhost:4000`. A safe default of
    // `http://api:3000` covers the canonical container case.
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://api:3000";
    return [
      // Better Auth canonical surface — sign-up / sign-in / providers /
      // verify-email / session / OIDC callbacks.
      { source: "/api/auth/:path*", destination: `${apiOrigin}/api/auth/:path*` },
      // Locale negotiation lives on api (Phase 10 / Plan 10-02). The
      // legacy /api/locale path is owned by api, not web.
      { source: "/api/locale", destination: `${apiOrigin}/api/locale` },
      { source: "/api/locale/:path*", destination: `${apiOrigin}/api/locale/:path*` },
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
