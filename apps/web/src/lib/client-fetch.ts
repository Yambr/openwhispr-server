// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 09 — Browser-side fetch wrapper for apps/api endpoints.
//
// Centralises three same-origin concerns:
//   1. JSON content-type default + automatic body serialisation
//      (JSON.stringify-as-string when `body` is an object).
//   2. Cookie-jar inclusion (`credentials: "include"`) — Better Auth's
//      session cookie is HttpOnly and same-origin, so we keep the default
//      `same-origin` semantics by always passing `credentials: "include"`.
//   3. HTTP error → thrown Error mapping (TanStack Query treats thrown
//      rejections as the error path).
//
// The web app and apps/api share the same Traefik origin (D-DEPLOY-1), so
// paths are always relative. Tests vi.mock this module at the boundary
// per D-TEST-3 (mock external HTTP only).

export interface ClientFetchInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Fetch a JSON endpoint on the same Traefik origin as the web app.
 *
 * @throws Error on non-2xx response, network failure, or non-JSON body.
 */
export async function clientFetch<T = unknown>(
  url: string,
  init: ClientFetchInit = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    accept: "application/json",
    ...init.headers,
  };
  let body: BodyInit | undefined;
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(init.body);
    }
  }
  const requestInit: RequestInit = {
    method,
    credentials: "include",
    headers,
  };
  if (body !== undefined) {
    requestInit.body = body;
  }
  if (init.signal !== undefined) {
    requestInit.signal = init.signal;
  }
  const res = await fetch(url, requestInit);
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `clientFetch ${method} ${url} failed: HTTP ${res.status}${detail ? ` body=${detail.slice(0, 200)}` : ""}`,
    );
  }
  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
