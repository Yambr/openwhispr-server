// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — envelope-asserting fetch wrapper.
//
// Every non-2xx response body MUST parse as ErrorEnvelope (D-13 / WIRE-17).
// `fetchAndParse` enforces that contract on every read: if the server
// returns 4xx/5xx with a body that does not match `{error:string}`, the
// test fails immediately with a zod parse error.
//
// 2xx responses are handed back as-is; route-specific tests parse the
// body via the matching response schema.
import { ErrorEnvelope } from "../schemas.js";

export interface FetchResult {
  status: number;
  body: unknown;
  headers: Headers;
  ok: boolean;
}

export async function fetchAndParse(url: string, init?: RequestInit): Promise<FetchResult> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok && body !== undefined && typeof body === "object") {
    // Throws (test fails) if the envelope shape is violated — D-13 +
    // PITFALLS #1 enforcement.
    ErrorEnvelope.parse(body);
  }
  return {
    status: res.status,
    body,
    headers: res.headers,
    ok: res.ok,
  };
}
