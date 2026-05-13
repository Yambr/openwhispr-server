// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 05 — RSC server-side session validation.
//
// Why HTTP instead of importing the apps/api Better Auth instance directly:
//   - `apps/web` is its own docker-compose service running `next start`;
//     the apps/api Better Auth instance is constructed at api boot with a
//     Drizzle adapter bound to the api's PgBouncer-pooled appDb. Importing
//     that instance into web would either (a) drag the full Drizzle +
//     Postgres client into the web bundle, breaking the deploy boundary,
//     or (b) require a non-trivial refactor of packages/auth to expose a
//     headless instance — and that instance would still need its own DB
//     handle, which web doesn't have.
//   - HTTP is the wire boundary apps/api already exposes via the catch-all
//     handler at `apps/api/src/routes/better-auth-handler.ts:61`
//     (`app.all("/api/auth/*", ...)`), specifically `/api/auth/get-session`
//     per Better Auth's documented RSC pattern.
//
// Cookie forwarding (Pitfall 2): RSC fetch does NOT inherit browser cookies.
// We must explicitly forward the `cookie` header from the incoming request
// (read via `next/headers`).
//
// Cookie cache caveat: apps/api/src/auth.ts currently enables
// `session.cookieCache.enabled = true` (line 212). RESEARCH § Pattern 2
// notes better-auth#7008 — cookie cache can return null in Next.js RSC.
// In practice the apps/api catch-all hits this endpoint over HTTP from
// web's RSC, which is a different request lifecycle than the in-process
// Better Auth call the issue describes; the cookie cache only affects the
// fast path inside the api process. Mitigation deferred — flag for the
// verifier and Plan 07 (sign-in flow) e2e.
import { headers } from "next/headers";

export interface ServerSession {
  session: {
    id: string;
    userId?: string;
    [key: string]: unknown;
  };
  user: {
    id: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    [key: string]: unknown;
  };
}

const DEFAULT_INTERNAL_API_URL = "http://api:3000";

function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}

/**
 * Resolve the current request's Better Auth session by calling
 * `GET /api/auth/get-session` on apps/api with the incoming Cookie header.
 *
 * Returns `null` on any of:
 *   - missing/empty cookie header (anonymous visit)
 *   - non-2xx upstream response (401, 5xx, etc.)
 *   - upstream fetch rejection (api unreachable / DNS / timeout)
 *   - empty / falsy JSON body (Better Auth's "no session" representation)
 *
 * Never throws — callers (e.g. `(auth)/layout.tsx`) treat null as
 * "redirect to /sign-in".
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  try {
    const res = await fetch(`${internalApiUrl()}/api/auth/get-session`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      // RSC must not cache auth-state across requests.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text === "null") return null;
    const parsed = JSON.parse(text) as ServerSession | null;
    if (!parsed || !parsed.session || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}
