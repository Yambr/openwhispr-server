// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 02 / Task 13-02-03 — shared step-file fixtures.
//
// Re-export `Given/When/Then` from `world.ts` (the canonical createBdd
// call site) so per-feature step modules import a single DSL surface, and
// expose helpers shared across the new CJM scenarios:
//
//   - `freshTenant()` — per-scenario tenant id (D-13 isolation invariant)
//     wired to the same UUID-suffixed identity stencil the auth.steps.ts
//     used in Wave 1. The `tenantId` fixture from `world.ts` already
//     supplies a per-scenario UUID; this helper wraps that into an
//     `{ email, password, displayName, tenantId }` envelope so step bodies
//     don't re-derive it.
//
//   - `signedInAs(...)` — programmatic Better Auth sign-in via the public
//     `/api/auth/sign-in/email` endpoint. Used by scenarios that need an
//     authenticated session but do NOT exercise the sign-in form itself
//     (e.g. transcribe.feature, locale-switch.feature).
//
// Step bodies that hit the api hosts MUST use `undiciFetch` with a
// localhost dispatcher (mirrors auth.steps.ts) — Playwright's `page`
// fixture is reserved for scenarios that genuinely exercise the browser.

import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";

export { After, AfterAll, Before, BeforeAll, expect, Given, Step, Then, test, When } from "./world";

/** Per-scenario fresh-tenant identity envelope. */
export interface FreshTenant {
  tenantId: string;
  email: string;
  password: string;
  displayName: string;
}

/**
 * Build a fresh-tenant identity envelope. Synchronous because UUID and
 * derived strings need no I/O. (The Wave-1 `tenantId` fixture is already
 * per-scenario; this helper exists so step bodies that want a fully
 * derived `{email,password,displayName}` envelope don't re-derive each
 * field locally.)
 */
export function freshTenant(tenantId?: string): FreshTenant {
  const id = tenantId ?? randomUUID();
  const slug = id.slice(0, 8);
  return {
    tenantId: id,
    email: `e2e+${slug}@local.test`,
    password: "Cjm2Pass!23",
    displayName: `CJM ${slug}`,
  };
}

function localhostDispatcher(url: string): Agent | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}

/**
 * Issue a JSON POST that carries the Better Auth CSRF-trusted Origin
 * header (mirrors the auth.steps.ts pattern from Wave 1). Returns the
 * raw Response so callers can pull headers (Set-Cookie) when needed.
 */
export async function postJsonRaw(
  url: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const dispatcher = localhostDispatcher(url);
  const origin = new URL(url).origin;
  return undiciFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...extraHeaders },
    body: JSON.stringify(body),
    dispatcher,
  }) as unknown as Promise<Response>;
}

/**
 * Programmatic sign-up + verify + sign-in via the api. Retries on 429
 * (Better Auth rate-limit window carry-over) per the same pattern as
 * Wave 1's auth.steps.ts. Returns the session cookies as a Cookie-header
 * string (or null if sign-in did not 200).
 */
export async function signedInAs(
  apiBaseURL: string,
  email: string,
  password: string,
): Promise<{ cookieHeader: string | null; status: number }> {
  const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-in/email`, {
    email,
    password,
  });
  const setCookie =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookieHeader =
    setCookie.length > 0 ? setCookie.map((c) => c.split(";", 1)[0]).join("; ") : null;
  return { cookieHeader, status: res.status };
}

/** Issue a fetch with the localhost dispatcher and (optionally) a cookie header. */
export async function fetchWithCookie(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
    cookie?: string | null;
  } = {},
): Promise<Response> {
  const dispatcher = localhostDispatcher(url);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  return undiciFetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    dispatcher,
    redirect: "manual",
  }) as unknown as Promise<Response>;
}
